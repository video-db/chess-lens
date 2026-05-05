/**
 * Live Assist Service
 *
 * Runs every few seconds during recording, analyzes recent visual gameplay feed,
 * and generates contextual coaching (tips + analysis)
 * using an LLM.
 */

import { EventEmitter } from 'events';
import { logger } from '../lib/logger';
import { pipelineLatency } from '../lib/pipeline-latency';
import type { VoteMeta } from '../lib/pipeline-latency';
import { GPT_54_MODEL, getLLMService } from './llm.service';
import { getChessEngineService } from './chess-engine.service';
import type { LiveInsights } from '../../shared/types/live-assist.types';
import type { ProbingQuestion } from '../../shared/types/meeting-setup.types';
import {
  DEFAULT_GAME_ID,
  getGameVisualIndexTiming,
  getChessPersonality,
  type SupportedGameId,
} from '../../shared/config/game-coaching';

const log = logger.child({ module: 'live-assist' });

const TIP_VISIBLE_MS = 60000;
const TIP_REPLACE_COOLDOWN_MS = 5000;
const VISUAL_DUPLICATE_WINDOW_MS = 900;
/**
 * Hard ceiling on a single processTranscriptInner() execution.
 * The coaching LLM is now fire-and-forget so this only needs to cover
 * the engine API call (~2s) plus the immediate emit path.
 * Set to 10s — if processTranscriptInner itself hangs, release the lock.
 */
const PROCESS_TRANSCRIPT_TIMEOUT_MS = 10000;

const CHESS_SYSTEM_PROMPT = `You are a chess coach giving real-time guidance during a live game.
Respond with ONLY a raw JSON object — no markdown, no code fences, no explanation before or after.
Format: {"say_this":"<2-3 sentences>","ask_this":"<one short calculation drill>"}
Output rules (apply regardless of personality):
- The context specifies the player's color and whose turn it is. Follow those instructions exactly.
- When it is the PLAYER's turn: explain the engine's best move for the player with concrete board-specific reasons.
- When it is the OPPONENT's turn: explain what the opponent's best move threatens or achieves, so the player knows what to defend against.
- Use the required move exactly as given. Do NOT invent a different move.
- The context may include a "Moving piece:" line that tells you which piece is on the from-square. Use it exactly — do NOT contradict it.
- Only mention a piece being on a specific square if that square is confirmed by the FEN or the "Moving piece:" line. Never hallucinate piece locations.
- Mention at least one concrete chess detail: piece, square, file, diagonal, pawn break, threat, capture, king-safety issue, or development gain.
- Write complete sentences — never cut a sentence short.
- Do NOT use "..." chess move notation (e.g. "...e5"). Write "Black plays e5" or "Black's e5" instead.
- Keep say_this under 150 words.
- ask_this: one short follow-up calculation question about the next 1-2 moves, under 20 words.`;

export interface MeetingContext {
  name?: string;
  description?: string;
  gameId?: SupportedGameId;
  coachPersonalityId?: string;
  questions?: ProbingQuestion[];
  checklist?: string[];
}

interface TranscriptChunk {
  text: string;
  source: 'mic' | 'system_audio';
  timestamp: number;
}

interface VisualIndexChunk {
  text: string;
  timestamp: number;
}

interface ChessContextData {
  fen: string;
  engineSummary: string;
  engineSan?: string;        // best move SAN directly from the engine response
  engineEval?: number;       // centipawn eval (as float, e.g. -11.62) from the engine response
  engineMate?: number | null; // mate-in-N (null if no forced mate)
  playedMoveSan?: string;
  playedMoveUci?: string;
  board?: string;
  turn?: 'w' | 'b';
}

interface FenCandidate {
  fen: string;
  source: string;
}

interface CastlingRightsState {
  whiteKingside: boolean;
  whiteQueenside: boolean;
  blackKingside: boolean;
  blackQueenside: boolean;
}

const INITIAL_CHESS_BOARD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

class LiveAssistService extends EventEmitter {
  private intervalTimer: NodeJS.Timeout | null = null;
  private processTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private transcriptBuffer: TranscriptChunk[] = [];
  private visualIndexBuffer: VisualIndexChunk[] = [];
  private previousSayThis: Set<string> = new Set();
  private previousAskThis: Set<string> = new Set();
  private lastProcessedTimestamp = 0;
  private meetingContext: MeetingContext | null = null;
  private activeGameId: SupportedGameId = DEFAULT_GAME_ID;
  private activeCoachPersonalityId: string = 'default';
  private lastHardClearAt = 0;
  private pendingRoundEndAt: number | null = null;
  private roundStartClearTimer: NodeJS.Timeout | null = null;
  private roundTipVisible = false;
  private roundTipAutoClearAt: number | null = null;
  private currentVisibleTip: string | null = null;
  private lastInstructionSignature: string | null = null;
  private lastTipShownAt = 0;
  private lastVisualText: string | null = null;
  private lastVisualTextAt = 0;
  // Chess: dedupe tips by position signature (FEN + played move) so we update on moves, not on a timer.
  private lastChessSignature: string | null = null;
  private lastChessBoard: string | null = null;
  private lastChessTurn: 'w' | 'b' | null = null;
  private lastChessPerspective: 'white' | 'black' = 'white';
  // Last engine result — carried on every fen event so the widget always has the current move/eval.
  private lastEngineSan: string | undefined = undefined;
  private lastEngineEval: number | undefined = undefined;
  private lastEngineMate: number | null | undefined = undefined;
  private castlingRights: CastlingRightsState = {
    whiteKingside: false,
    whiteQueenside: false,
    blackKingside: false,
    blackQueenside: false,
  };
  private hasSeenInitialChessPosition = false;
  private pendingChessSignature: string | null = null;
  private pendingChessSignatureCount = 0;
  private isProcessing = false; // guard against concurrent processTranscript calls
  /** Pipeline latency cycle ID propagated from ChessScreenshotService. */
  private currentCycleId: number | undefined = undefined;
  /** Vote-read-1 metadata for the current cycle — used to compute phase latency. */
  private currentVoteMeta: VoteMeta | undefined = undefined;
  /** True when runCoachingLLM has been fired for currentCycleId and hasn't
   *  finished yet — prevents signatureUnchanged from closing the cycle early. */
  private coachingInFlight = false;

  private getTipLengthLimits(): { maxSayWords: number; maxAskWords: number; maxFinalSayCount: number; maxFinalAskCount: number } {
    return { maxSayWords: 20, maxAskWords: 16, maxFinalSayCount: 2, maxFinalAskCount: 2 };
  }

  private truncateTo3Words(text: string): string {
    const words = text.split(/\s+/);
    if (words.length <= 10) return text;
    return words.slice(0, 8).join(' ');
  }

  private truncateToShortTip(text: string, maxWords?: number): string {
    const cleaned = this.sanitizeInsightText(text);
    if (!cleaned) return '';
    const limits = this.getTipLengthLimits();
    const limit = maxWords ?? limits.maxAskWords;
    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length <= limit) return cleaned;
    return words.slice(0, limit).join(' ');
  }

  private scheduleProcessing(): void {
    if (!this.isRunning) return;

    if (this.processTimer) {
      clearTimeout(this.processTimer);
    }

    this.processTimer = setTimeout(() => {
      this.processTimer = null;
      void this.processTranscript();
    }, 250);
  }

  private getInstructionSignature(sayThis: string[], askThis: string[]): string {
    const normalize = (text: string): string => this.sanitizeInsightText(text).toLowerCase();
    return [...sayThis.map(normalize), '::', ...askThis.map(normalize)].join(' | ').trim();
  }

  private isGenericTip(text: string): boolean {
    const low = text.toLowerCase().trim();
    if (!low) return true;
    return /^(improve aim|use cover|practice more|play better|focus up|be careful|good job|nice|keep trying)\b/.test(low)
      || /^(improve|practice|focus)\b/.test(low);
  }

  private isSpecificChessTip(text: string, requiredMove?: string | null): boolean {
    const low = text.toLowerCase().trim();
    if (!low || this.isGenericTip(low)) return false;

    const mentionsMove = !requiredMove || low.includes(requiredMove.toLowerCase());
    const hasConcreteSignal = /\b(center|file|diagonal|square|bishop|knight|rook|queen|king|pawn|attack|attacks|defend|defends|pressure|fork|pin|skewer|tempo|develop|development|castle|mate|threat|weak|open|opens|capture|recapture|initiative)\b/.test(low);
    return mentionsMove && hasConcreteSignal;
  }

  private sanitizeInsightText(text: string): string {
    return text
      .replace(/\*\*/g, '')
      .replace(/__+/g, '')
      .replace(/`+/g, '')
      .replace(/^\s*[-*•]\s*/g, '')
      .replace(/^\s*(say|ask)\s*:\s*/i, '')
      .replace(/\s*(say|ask)\s*:\s*/gi, ' ')
      // Convert chess "...Move" notation (Black's move) to plain English to avoid "…" visual breaks
      .replace(/\.{3}([NBRQK]?[a-h]?[1-8]?x?[a-h][1-8](?:=[NBRQ])?[+#]?)/g, 'Black\'s $1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeFenText(text: string): string {
    return this.sanitizeInsightText(text)
      .replace(/[\u2018\u2019\u201c\u201d]/g, '')
      .replace(/[.,;:]+$/g, '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  private isValidFenBoard(board: string): boolean {
    const ranks = board.split('/');
    if (ranks.length !== 8) return false;

    let whiteKings = 0;
    let blackKings = 0;

    for (const rank of ranks) {
      let squares = 0;
      for (const char of rank) {
        if (/^[1-8]$/.test(char)) {
          squares += Number(char);
          continue;
        }

        if (!/^[prnbqkPRNBQK]$/.test(char)) {
          return false;
        }

        squares += 1;
        if (char === 'K') whiteKings += 1;
        if (char === 'k') blackKings += 1;
      }

      if (squares !== 8) return false;
    }

    // Enforce king counts: each side must have exactly 0 or 1 king,
    // and there must be at least 1 king total (to reject empty/garbage boards).
    // The RTStream board_mapping sometimes produces boards with 2+ kings
    // (OCR confusion between K and other pieces) — these cause engine rejections.
    if (whiteKings > 1 || blackKings > 1) return false;
    return whiteKings + blackKings >= 1;
  }

  private isSemanticFenValid(board: string): boolean {
    // Additional semantic validation for chess positions.
    // Checks pawn placement, castling plausibility, promotion state.
    let whitePawns = 0;
    let blackPawns = 0;
    let whiteTotal = 0;
    let blackTotal = 0;

    const ranks = board.split('/');
    for (let rankIdx = 0; rankIdx < ranks.length; rankIdx++) {
      const rank = ranks[rankIdx];
      for (const char of rank) {
        if (/^[1-8]$/.test(char)) continue;

        if (char === 'P') {
          whitePawns++;
          // Pawns cannot be on rank 1 or 8 (indices 7 or 0)
          if (rankIdx === 0 || rankIdx === 7) return false;
        } else if (char === 'p') {
          blackPawns++;
          // Pawns cannot be on rank 1 or 8 (indices 7 or 0)
          if (rankIdx === 0 || rankIdx === 7) return false;
        }

        if (/^[PRNBQK]$/.test(char)) whiteTotal++;
        if (/^[prnbqk]$/.test(char)) blackTotal++;
      }
    }

    // Pawn count sanity check: at most 8 per side (no more than starting count)
    if (whitePawns > 8 || blackPawns > 8) return false;

    // Total piece count sanity: at most 16 per side (starting) minus promotions is rare but allowed
    if (whiteTotal > 16 || blackTotal > 16) return false;

    return true;
  }

  private parseFenCandidate(candidate: string): string | null {
    const fen = this.normalizeFenText(candidate);
    if (!fen) return null;

    const parts = fen.split(' ');
    if (parts.length !== 6) return null;

    const [board, sideToMove, castling, enPassant, halfmoveClock, fullmoveNumber] = parts;

    if (!this.isValidFenBoard(board)) return null;
    if (!this.isSemanticFenValid(board)) return null;
    if (!/^[wb]$/.test(sideToMove)) return null;
    if (!/^(?:-|[KQkq]{1,4})$/.test(castling)) return null;
    if (!/^(?:-|[a-h][36])$/.test(enPassant)) return null;
    if (!/^\d+$/.test(halfmoveClock) || !/^\d+$/.test(fullmoveNumber)) return null;
    if (Number(fullmoveNumber) < 1) return null;

    return fen;
  }

  private validateBoardMath(board: string): boolean {
    const rows = board.split('/');
    if (rows.length !== 8) return false;

    for (const row of rows) {
      let squareCount = 0;
      for (const char of row) {
        if (/^[1-8]$/.test(char)) {
          squareCount += Number(char);
          continue;
        }
        if (/^[prnbqkPRNBQK]$/.test(char)) {
          squareCount += 1;
          continue;
        }
        return false;
      }
      if (squareCount !== 8) return false;
    }

    return true;
  }

  private transformRawBoardToWhitePerspective(rawBoard: string, perspective: 'white' | 'black'): string {
    if (perspective === 'white') return rawBoard;

    const rows = rawBoard.split('/');
    rows.reverse();
    return rows.map((row) => row.split('').reverse().join('')).join('/');
  }

  /**
   * Build a FEN string for display on the overlay board.
   *
   * The engine always receives a white-perspective FEN.  For the overlay we
   * want to show the board as the player sees it on screen (i.e. reversed
   * when they are playing Black).  This method applies the inverse transform:
   * if the original perspective was black, rotate the board 180° back so it
   * looks like the captured screenshot.
   *
   * @param whitePerspectiveFen - Full FEN in white's perspective (engine FEN)
   * @param perspective         - Original player perspective from the screenshot
   */
  private buildDisplayFen(whitePerspectiveFen: string, perspective: 'white' | 'black'): string {
    if (perspective === 'white') return whitePerspectiveFen;

    // Split the FEN into board part and the rest (turn, castling, etc.)
    const spaceIdx = whitePerspectiveFen.indexOf(' ');
    const boardPart = spaceIdx === -1 ? whitePerspectiveFen : whitePerspectiveFen.slice(0, spaceIdx);
    const rest = spaceIdx === -1 ? '' : whitePerspectiveFen.slice(spaceIdx);

    // Rotate 180°: reverse rank order AND mirror each rank's files
    const rows = boardPart.split('/');
    rows.reverse();
    const displayBoard = rows.map((row) => row.split('').reverse().join('')).join('/');

    return `${displayBoard}${rest}`;
  }

  private extractFenFromTaggedChessOutput(text: string): string | null {
    const perspectiveMatch = text.match(/<perspective>\s*([\s\S]*?)\s*<\/perspective>/i);
    const rawBoardMatches = [...text.matchAll(/<raw_board>\s*([\s\S]*?)\s*<\/raw_board>/gi)];

    if (!rawBoardMatches.length) return null;

    const perspectiveRaw = perspectiveMatch?.[1]?.toLowerCase() || '';
    const perspective: 'white' | 'black' = perspectiveRaw.includes('black') ? 'black' : 'white';
    if (!perspectiveMatch) {
      log.warn('[LiveAssist] extractFenFromTaggedChessOutput: <perspective> tag missing — defaulting to white. Board may be silently flipped if player is Black.');
    }
    const rawBoard = rawBoardMatches[rawBoardMatches.length - 1]?.[1]?.replace(/\s+/g, '') || '';
    if (!rawBoard) return null;
    if (!this.validateBoardMath(rawBoard)) return null;

    const board = this.transformRawBoardToWhitePerspective(rawBoard, perspective);
    // Side/castling/en-passant counters are unavailable from a single frame.
    const syntheticFen = `${board} w - - 0 1`;
    return this.parseFenCandidate(syntheticFen);
  }

  private extractFenFromBoardMappingStrings(text: string): string | null {
    const perspectiveMatch = text.match(/<perspective>\s*([\s\S]*?)\s*<\/perspective>/i);
    const perspectiveRaw = perspectiveMatch?.[1]?.toLowerCase() || '';
    const perspective: 'white' | 'black' = perspectiveRaw.includes('black') ? 'black' : 'white';

    // Fallback when <raw_board> is missing: parse "(String: ...)" tokens from <board_mapping>.
    const matches = [...text.matchAll(/\(\s*String\s*:\s*([prnbqkPRNBQK1-8]+)\s*\)/gi)];
    if (matches.length < 8) return null;

    const rows = matches.slice(0, 8).map((m) => (m[1] || '').trim());
    if (rows.some((r) => !r)) return null;

    const rawBoard = rows.join('/');
    if (!this.validateBoardMath(rawBoard)) return null;

    const board = this.transformRawBoardToWhitePerspective(rawBoard, perspective);
    const syntheticFen = `${board} w - - 0 1`;
    return this.parseFenCandidate(syntheticFen);
  }

  private extractFenCandidates(text: string): FenCandidate[] {
    const candidates: FenCandidate[] = [];
    const normalizedText = this.normalizeFenText(text);

    const taggedFen = this.extractFenFromTaggedChessOutput(text);
    if (taggedFen) {
      candidates.push({ fen: taggedFen, source: 'tagged_raw_board' });
    }

    const mappingFen = this.extractFenFromBoardMappingStrings(text);
    if (mappingFen) {
      candidates.push({ fen: mappingFen, source: 'board_mapping_string_rows' });
    }

    const explicitFenRegex = /(?:^|[|\n\r\s])(?:fen)\s*[:=]\s*([^|\n\r]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = explicitFenRegex.exec(normalizedText)) !== null) {
      const fen = this.parseFenCandidate(match[1]);
      if (fen) {
        candidates.push({ fen, source: 'explicit' });
      }
    }

    const rawFenRegex = /([prnbqkPRNBQK1-8\/]+\s+[wb]\s+(?:-|[KQkq]{1,4})\s+(?:-|[a-h][36])\s+\d+\s+\d+)/g;
    while ((match = rawFenRegex.exec(normalizedText)) !== null) {
      const fen = this.parseFenCandidate(match[1]);
      if (fen) {
        candidates.push({ fen, source: 'raw' });
      }
    }

    const boardOnlyRegex = /([prnbqkPRNBQK1-8]+(?:\/[prnbqkPRNBQK1-8]+){7})/g;
    while ((match = boardOnlyRegex.exec(normalizedText)) !== null) {
      const board = match[1];
      if (!this.validateBoardMath(board)) continue;
      const fen = this.parseFenCandidate(`${board} w - - 0 1`);
      if (fen) {
        candidates.push({ fen, source: 'board_only' });
      }
    }

    if (this.activeGameId === 'chess') {
      log.debug(
        {
          candidateCount: candidates.length,
          candidateSources: candidates.map((c) => c.source),
          firstFen: candidates[0]?.fen,
          preview: text.substring(0, 180),
        },
        '[LiveAssist] Chess FEN candidate extraction'
      );
    }

    return candidates;
  }

  private isNonActionableVisualText(text: string): boolean {
    return /no actionable gameplay (?:moment|context)(?: is available| in this frame)?\.?/i.test(text.trim());
  }

  private extractFenFromText(text: string): string | null {
    const candidates = this.extractFenCandidates(text);
    if (candidates.length === 0) return null;
    return candidates[0].fen;
  }

  private extractLatestFen(visuals: VisualIndexChunk[]): string | null {
    // Preference order: items injected by the screenshot path carry a
    // <source>screenshot</source> tag — these are validated, voted, and
    // normalised to white's perspective. Always prefer them over RTStream
    // board_mapping items which are often noisy or incorrectly normalised.
    //
    // Pass 1: screenshot-path items only (tagged_raw_board + screenshot source tag).
    for (let i = visuals.length - 1; i >= 0; i--) {
      if (!visuals[i].text.includes('<source>') || !visuals[i].text.includes('screenshot')) continue;
      const candidates = this.extractFenCandidates(visuals[i].text);
      const preferred = candidates.find((c) => c.source === 'tagged_raw_board');
      if (preferred) {
        log.debug(
          { source: 'screenshot_raw_board', fen: preferred.fen },
          '[LiveAssist] Selected latest chess FEN (screenshot path)'
        );
        return preferred.fen;
      }
    }

    // Pass 2: any tagged_raw_board (RTStream may also produce these).
    for (let i = visuals.length - 1; i >= 0; i--) {
      const candidates = this.extractFenCandidates(visuals[i].text);
      const preferred = candidates.find((c) => c.source === 'tagged_raw_board');
      if (preferred) {
        log.debug(
          { source: preferred.source, fen: preferred.fen },
          '[LiveAssist] Selected latest chess FEN (tagged_raw_board fallback)'
        );
        return preferred.fen;
      }
    }

    // Pass 3: fall back to any valid FEN source.
    for (let i = visuals.length - 1; i >= 0; i--) {
      const candidates = this.extractFenCandidates(visuals[i].text);
      if (candidates.length > 0) {
        log.debug(
          { source: candidates[0].source, fen: candidates[0].fen },
          '[LiveAssist] Selected latest chess FEN (any source fallback)'
        );
        return candidates[0].fen;
      }
    }

    const windowFen = this.extractFenFromBoardMappingWindow(visuals);
    if (windowFen) {
      log.debug({ source: 'board_mapping_window', fen: windowFen }, '[LiveAssist] Selected latest chess FEN');
      return windowFen;
    }
    log.debug(
      { visualCount: visuals.length, sample: visuals.slice(-2).map((v) => v.text.substring(0, 160)) },
      '[LiveAssist] No valid chess FEN extracted from current window'
    );
    return null;
  }

  /**
   * Count pieces for each side in a FEN board string.
   * Returns { white, black, total } piece counts (not square counts).
   */
  private countPieces(board: string): { white: number; black: number; total: number } {
    let white = 0;
    let black = 0;
    for (const ch of board) {
      if (/^[PRNBQK]$/.test(ch)) white++;
      else if (/^[prnbqk]$/.test(ch)) black++;
    }
    return { white, black, total: white + black };
  }

  /**
   * Determine whose turn it is by comparing the previous board with the current board.
   *
   * Algorithm:
   *  1. Count white and black pieces in both boards.
   *  2. If white's count dropped  → black just captured a white piece  → it's white's turn.
   *  3. If black's count dropped  → white just captured a black piece  → it's black's turn.
   *  4. If both counts are equal but the board changed → a quiet move was played
   *     → flip from the last known turn.
   *  5. If the board is unchanged → no move detected → keep the last known turn.
   *  6. If there is no previous board → fall back to the last known turn or 'w'.
   */
  private inferTurnFromBoards(
    prevBoard: string | null,
    currBoard: string,
    lastKnownTurn: 'w' | 'b' | null
  ): 'w' | 'b' {
    if (!prevBoard || prevBoard === currBoard) {
      // No change detected (or cold start) — use lastKnownTurn if available.
      // IMPORTANT: if lastKnownTurn is null it means we have no history yet
      // (e.g. "Live assist already running" path where start() returned early
      // and state wasn't fully reset). Always use the caller's seed in this case
      // rather than blindly defaulting to 'w'.
      return lastKnownTurn ?? 'w';
    }

    const prev = this.countPieces(prevBoard);
    const curr = this.countPieces(currBoard);

    const whiteLost = prev.white - curr.white;
    const blackLost = prev.black - curr.black;

    if (whiteLost > 0 && blackLost === 0) {
      // Black captured a white piece → white pieces decreased → it's white's turn now
      log.debug({ whiteLost, prevBoard: prevBoard.substring(0, 30), currBoard: currBoard.substring(0, 30) },
        '[TurnDetect] White piece captured by black → white to move');
      return 'w';
    }

    if (blackLost > 0 && whiteLost === 0) {
      // White captured a black piece → black pieces decreased → it's black's turn now
      log.debug({ blackLost, prevBoard: prevBoard.substring(0, 30), currBoard: currBoard.substring(0, 30) },
        '[TurnDetect] Black piece captured by white → black to move');
      return 'b';
    }

    if (whiteLost > 0 && blackLost > 0) {
      // Both sides lost pieces (promotion+capture or OCR noise) — flip from last known
      log.debug({ whiteLost, blackLost }, '[TurnDetect] Both sides lost pieces — flipping turn');
      return lastKnownTurn === 'w' ? 'b' : 'w';
    }

    // Quiet move — board changed but no captures. Flip from last known turn.
    const flipped = lastKnownTurn === 'w' ? 'b' : 'w';
    log.debug({ prevBoard: prevBoard.substring(0, 30), currBoard: currBoard.substring(0, 30), flipped },
      '[TurnDetect] Quiet move detected → flipping turn');
    return flipped;
  }

  private resetChessSessionState(): void {
    this.lastChessSignature = null;
    this.lastChessBoard = null;
    this.lastChessTurn = null;
    this.lastChessPerspective = 'white';
    this.lastEngineSan = undefined;
    this.lastEngineEval = undefined;
    this.lastEngineMate = undefined;
    this.pendingChessSignature = null;
    this.pendingChessSignatureCount = 0;
    this.castlingRights = {
      whiteKingside: false,
      whiteQueenside: false,
      blackKingside: false,
      blackQueenside: false,
    };
    this.hasSeenInitialChessPosition = false;
  }

  private isInitialChessBoard(board: string): boolean {
    return board === INITIAL_CHESS_BOARD;
  }

  private getCastlingRightsString(): string {
    const rights = [
      this.castlingRights.whiteKingside ? 'K' : '',
      this.castlingRights.whiteQueenside ? 'Q' : '',
      this.castlingRights.blackKingside ? 'k' : '',
      this.castlingRights.blackQueenside ? 'q' : '',
    ].join('');
    return rights || '-';
  }

  private hasPieceAt(board: string, square: string, piece: string): boolean {
    const files = 'abcdefgh';
    const fileIndex = files.indexOf(square[0] || '');
    const rank = Number(square[1]);
    if (fileIndex < 0 || !Number.isInteger(rank) || rank < 1 || rank > 8) return false;

    const rows = board.split('/');
    const row = rows[8 - rank];
    if (!row) return false;

    let fileCursor = 0;
    for (const ch of row) {
      if (/^[1-8]$/.test(ch)) {
        fileCursor += Number(ch);
        continue;
      }
      if (fileCursor === fileIndex) return ch === piece;
      fileCursor += 1;
    }
    return false;
  }

  private updateCastlingRightsFromBoard(board: string): void {
    // Always reseed when the starting position is detected — this handles both
    // the very first game of a session AND new games starting mid-session.
    // Without this, the screenshot service's lastConfirmedFen dedup skips
    // pushing the initial board a second time, so rights would never be seeded
    // for game 2+ within the same session.
    if (this.isInitialChessBoard(board)) {
      this.castlingRights = {
        whiteKingside: true,
        whiteQueenside: true,
        blackKingside: true,
        blackQueenside: true,
      };
      this.hasSeenInitialChessPosition = true;
      log.debug('[LiveAssist] Initial chess board detected — castling rights (re)seeded to KQkq');
      return;
    }

    if (!this.hasSeenInitialChessPosition) {
      // Haven't seen the starting position yet; can't infer rights — leave as-is.
      return;
    }

    if (!this.hasPieceAt(board, 'e1', 'K')) {
      this.castlingRights.whiteKingside = false;
      this.castlingRights.whiteQueenside = false;
    }
    if (!this.hasPieceAt(board, 'e8', 'k')) {
      this.castlingRights.blackKingside = false;
      this.castlingRights.blackQueenside = false;
    }
    if (!this.hasPieceAt(board, 'h1', 'R')) this.castlingRights.whiteKingside = false;
    if (!this.hasPieceAt(board, 'a1', 'R')) this.castlingRights.whiteQueenside = false;
    if (!this.hasPieceAt(board, 'h8', 'r')) this.castlingRights.blackKingside = false;
    if (!this.hasPieceAt(board, 'a8', 'r')) this.castlingRights.blackQueenside = false;
  }

  private applyNextTurnToFen(fen: string, visuals?: VisualIndexChunk[]): { fen: string; board: string; turn: 'w' | 'b' } {
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 4) {
      return { fen, board: fen.split(' ')[0] || fen, turn: this.lastChessTurn ?? 'w' };
    }

    const [board, , , enPassant, halfmove = '0', fullmove = '1'] = parts;

    // Use the player's color (perspective) as the side to move.
    // This matches what injectConfirmedFen sets, so lastChessTurn is always
    // the player's color once a screenshot-path FEN has been confirmed.
    let inferredTurn: 'w' | 'b';
    if (this.lastChessTurn !== null) {
      inferredTurn = this.lastChessTurn;
    } else {
      // Cold start before the first screenshot-path FEN: derive from perspective.
      inferredTurn = this.lastChessPerspective === 'black' ? 'b' : 'w';
    }

    const castling = this.getCastlingRightsString();
    const nextFen = `${board} ${inferredTurn} ${castling} ${enPassant} ${halfmove} ${fullmove}`;
    log.debug(
      { board: board.slice(0, 30), inferredTurn, perspective: this.lastChessPerspective, castling },
      '[LiveAssist] applyNextTurnToFen: turn determined'
    );
    return { fen: nextFen, board, turn: inferredTurn };
  }

  private extractFenFromBoardMappingWindow(visuals: VisualIndexChunk[]): string | null {
    if (visuals.length === 0) return null;

    const rowMap = new Map<number, string>();
    let perspective: 'white' | 'black' = 'white';

    for (let i = visuals.length - 1; i >= 0; i--) {
      const text = visuals[i].text;
      const perspectiveMatch = text.match(/<perspective>\s*([\s\S]*?)\s*<\/perspective>/i);
      if (perspectiveMatch?.[1]) {
        const low = perspectiveMatch[1].toLowerCase();
        perspective = low.includes('black') ? 'black' : 'white';
      }

      const matches = [...text.matchAll(/Visual Row\s+(\d+).*?\(\s*String\s*:\s*([prnbqkPRNBQK1-8]+)\s*\)/gi)];
      for (const match of matches) {
        const rowIndex = Number(match[1]);
        const rowValue = (match[2] || '').trim();
        if (!rowValue || Number.isNaN(rowIndex)) continue;
        if (!rowMap.has(rowIndex)) {
          rowMap.set(rowIndex, rowValue);
        }
      }
    }

    if (rowMap.size < 8) return null;

    const rows: string[] = [];
    for (let i = 1; i <= 8; i++) {
      const row = rowMap.get(i);
      if (!row) return null;
      rows.push(row);
    }

    const rawBoard = rows.join('/');
    if (!this.validateBoardMath(rawBoard)) return null;

    const board = this.transformRawBoardToWhitePerspective(rawBoard, perspective);
    const syntheticFen = `${board} w - - 0 1`;
    return this.parseFenCandidate(syntheticFen);
  }

  private extractLatestChessMove(visuals: VisualIndexChunk[]): { san?: string; uci?: string } {
    for (let i = visuals.length - 1; i >= 0; i--) {
      const text = visuals[i].text;
      const sanMatch = text.match(/\bSAN\s*:\s*([^|\n]+)/i);
      const moveMatch = text.match(/\bMove\s*:\s*([a-h][1-8][a-h][1-8][qrbn]?)/i);
      if (sanMatch?.[1] || moveMatch?.[1]) {
        return {
          san: sanMatch?.[1]?.trim(),
          uci: moveMatch?.[1]?.trim(),
        };
      }
    }
    return {};
  }

  private async buildChessContext(visuals: VisualIndexChunk[], fenOverride?: string, cycleId?: number): Promise<ChessContextData | null> {
    if (this.activeGameId !== 'chess') {
      log.debug(
        { activeGameId: this.activeGameId, visualCount: visuals.length },
        '[LiveAssist] Skipping chess engine request because active game is not chess'
      );
      return null;
    }

    const fen = fenOverride || this.extractLatestFen(visuals);
    if (!fen) {
      log.debug(
        {
          visualCount: visuals.length,
          sample: visuals.slice(-3).map((item) => item.text.substring(0, 160)),
        },
        '[LiveAssist] No valid FEN found for chess engine request'
      );
      return null;
    }
    const resolvedFen = this.applyNextTurnToFen(fen, visuals);
    const latestMove = this.extractLatestChessMove(visuals);

    const engine = getChessEngineService();
    log.info(
      {
        rawFen: fen,
        resolvedFen: resolvedFen.fen,
        inferredTurn: resolvedFen.turn,
        playedMoveSan: latestMove.san,
        playedMoveUci: latestMove.uci,
      },
      '[LiveAssist] Sending chess engine request'
    );
    // Pass the turn-corrected FEN so the engine analyses the right side to move.
    if (cycleId !== undefined) pipelineLatency.startStep(cycleId, 'engineCall');
    const result = await engine.analyzeByFen(resolvedFen.fen, {
      variants: 5,
      depth: 12,
      maxThinkingTime: 50,
    });

    if (!result) {
      if (cycleId !== undefined) pipelineLatency.endStep(cycleId, 'engineCall', 'no analysis');
      log.warn({ resolvedFen: resolvedFen.fen, inferredTurn: resolvedFen.turn }, '[LiveAssist] Chess engine returned no analysis — skipping tip for this position');
      return null;
    }
    if (cycleId !== undefined) pipelineLatency.endStep(cycleId, 'engineCall');

    return {
      fen: resolvedFen.fen,
      engineSummary: engine.summarize(result),
      engineSan: result.san,
      engineEval: typeof result.eval === 'number' ? result.eval : undefined,
      engineMate: result.mate ?? null,
      playedMoveSan: latestMove.san,
      playedMoveUci: latestMove.uci,
      board: resolvedFen.board,
      turn: resolvedFen.turn,
    };
  }

  /**
   * Format engine analysis as a readable coaching sentence for the overlay.
   * Extracts the best move (SAN), evaluation, and side to move to produce
   * a clear one-line tip instead of a raw engine dump.
   */
  private formatEngineAsTip(ctx: ChessContextData): string {
    const summary = ctx.engineSummary || '';
    const turn = ctx.turn === 'b' ? 'Black' : 'White';

    // Extract SAN from the summary text (e.g. "Best move SAN: Nf6")
    const sanMatch = summary.match(/Best move SAN:\s*(\S+)/i);
    const san = sanMatch?.[1] ?? null;

    // Extract evaluation (e.g. "Eval: -0.33" or "Mate: -3")
    const mateMatch = summary.match(/Mate:\s*(-?\d+)/i);
    const evalMatch = summary.match(/Eval:\s*(-?[\d.]+)/i);

    let evalStr = '';
    if (mateMatch) {
      const m = parseInt(mateMatch[1], 10);
      evalStr = m < 0
        ? `Mate in ${Math.abs(m)} for ${turn === 'White' ? 'Black' : 'White'}`
        : `Mate in ${m} for ${turn}`;
    } else if (evalMatch) {
      const e = parseFloat(evalMatch[1]);
      const adv = Math.abs(e) < 0.3 ? 'equal' : e > 0 ? 'White is better' : 'Black is better';
      evalStr = `${adv} (${e > 0 ? '+' : ''}${e.toFixed(2)})`;
    }

    if (san) {
      const parts = [`${turn} to move: play ${san}`];
      if (evalStr) parts.push(evalStr);
      return parts.join(' — ');
    }

    // No SAN available — fall back to a cleaned summary
    return this.sanitizeInsightText(summary).split('\n')[0].slice(0, 200);
  }

  /**
   * Given a FEN board string and a LAN move (e.g. "g1f3"), returns a human-readable
   * description of the moving piece and its from-square, e.g. "Knight on g1".
   * This is injected into the coaching prompt so the LLM cannot hallucinate piece positions.
   */
  private describeMovingPiece(fenBoard: string, lanMove: string): string | null {
    if (!fenBoard || !lanMove || lanMove.length < 4) return null;

    const fromFile = lanMove[0]; // 'a'–'h'
    const fromRank = lanMove[1]; // '1'–'8'
    if (!fromFile || !fromRank) return null;

    const fileIdx = fromFile.charCodeAt(0) - 'a'.charCodeAt(0); // 0–7
    const rankIdx = 8 - parseInt(fromRank, 10);                  // 0 = rank 8, 7 = rank 1

    if (fileIdx < 0 || fileIdx > 7 || rankIdx < 0 || rankIdx > 7) return null;

    const ranks = fenBoard.split('/');
    const rankStr = ranks[rankIdx];
    if (!rankStr) return null;

    // Expand the rank string into an array of 8 piece chars ('' = empty)
    const cells: string[] = [];
    for (const ch of rankStr) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < parseInt(ch, 10); i++) cells.push('');
      } else {
        cells.push(ch);
      }
    }

    const piece = cells[fileIdx];
    if (!piece) return null;

    const pieceNames: Record<string, string> = {
      P: 'White Pawn', N: 'White Knight', B: 'White Bishop',
      R: 'White Rook',  Q: 'White Queen',  K: 'White King',
      p: 'Black Pawn',  n: 'Black Knight', b: 'Black Bishop',
      r: 'Black Rook',  q: 'Black Queen',  k: 'Black King',
    };

    const pieceName = pieceNames[piece];
    if (!pieceName) return null;

    return `${pieceName} on ${fromFile}${fromRank}`;
  }

  private stripNonActionableVisualText(text: string): string {
    const parts = text
      .split(/\|\|\||\n+/)
      .map((part) => this.sanitizeInsightText(part))
      .filter(Boolean)
      .filter((part) => !this.isNonActionableVisualText(part));
    return parts.join(' ').trim();
  }

  private rankInsightPriority(_text: string): number {
    return 0;
  }

  private isLikelyGameplayFeed(texts: string[]): boolean {
    const haystack = texts.join(' ').toLowerCase();
    const gameplaySignals = [
      'chess', 'board', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king',
      'check', 'checkmate', 'castle', 'en passant', 'fianchetto', 'opening', 'fen'
    ];
    return gameplaySignals.some((signal) => haystack.includes(signal));
  }

  /**
   * Start the live assist loop
   */
  start(context?: MeetingContext): void {
    if (this.isRunning) {
      log.warn('Live assist already running');
      return;
    }

    log.info(
      {
        context: context ? { name: context.name, hasDescription: !!context.description, gameId: context.gameId } : null,
      },
      'Starting live assist service'
    );
    this.isRunning = true;
    this.transcriptBuffer = [];
    this.visualIndexBuffer = [];
    this.previousSayThis.clear();
    this.previousAskThis.clear();
    this.lastProcessedTimestamp = 0;
    this.meetingContext = context || null;
    this.activeGameId = context?.gameId || DEFAULT_GAME_ID;
    this.activeCoachPersonalityId = context?.coachPersonalityId || 'default';
    this.resetChessSessionState();
    this.pendingRoundEndAt = null;
    this.roundTipVisible = false;
    this.roundTipAutoClearAt = null;
    this.currentVisibleTip = null;
    this.lastInstructionSignature = null;
    this.lastTipShownAt = 0;
    const timingProfile = getGameVisualIndexTiming(this.activeGameId);
    if (this.roundStartClearTimer) {
      clearTimeout(this.roundStartClearTimer);
      this.roundStartClearTimer = null;
    }

    // Run immediately, then on the active game's cadence
    this.processTranscript();
    this.intervalTimer = setInterval(() => {
      this.processTranscript();
    }, timingProfile.liveAssistIntervalMs);
  }

  /**
   * Stop the live assist loop
   */
  stop(): void {
    if (!this.isRunning) return;

    log.info('Stopping live assist service');
    this.isRunning = false;

    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }

    if (this.processTimer) {
      clearTimeout(this.processTimer);
      this.processTimer = null;
    }

    this.transcriptBuffer = [];
    this.visualIndexBuffer = [];
    this.previousSayThis.clear();
    this.previousAskThis.clear();
    this.meetingContext = null;
    this.activeGameId = DEFAULT_GAME_ID;
    this.activeCoachPersonalityId = 'default';
    this.pendingRoundEndAt = null;
    this.roundTipVisible = false;
    this.roundTipAutoClearAt = null;
    this.currentVisibleTip = null;
    this.lastInstructionSignature = null;
    this.lastTipShownAt = 0;
    this.resetChessSessionState();
    this.isProcessing = false;
    if (this.roundStartClearTimer) {
      clearTimeout(this.roundStartClearTimer);
      this.roundStartClearTimer = null;
    }
    if (this.processTimer) {
      clearTimeout(this.processTimer);
      this.processTimer = null;
    }
  }

  /**
   * Add a transcript segment to the buffer
   */
  addTranscript(text: string, source: 'mic' | 'system_audio'): void {
    // Intentionally ignored: live tips are visual/action based, not audio based.
    void text;
    void source;
  }

  /**
   * Answer a player's question about a coaching tip or the current position.
   *
   * @param question   The player's free-text question.
   * @param tipContext Optional: the specific tip/analysis text the player is asking about.
   * @returns The assistant's reply as a plain string.
   */
  async chat(question: string, tipContext?: string): Promise<string> {
    const llm = getLLMService();

    // Build full FEN so the coach knows side-to-move, castling, etc.
    // applyNextTurnToFen returns { fen, board, turn } — extract the string.
    const fullFen = this.lastChessBoard
      ? this.applyNextTurnToFen(this.lastChessBoard).fen
      : null;

    const fenLine = fullFen
      ? `Current position (FEN): ${fullFen}`
      : '';
    const perspLine = `Player is: ${this.lastChessPerspective === 'black' ? 'Black' : 'White'}`;
    const gameGoals = this.meetingContext?.description?.trim()
      ? `Player's game goals: ${this.meetingContext.description.trim()}`
      : '';

    // Include the most recent coaching tip shown to the player so the coach
    // has context about what was just discussed (e.g. "these moves").
    const recentTips = Array.from(this.previousSayThis).slice(-3);
    const recentTipsLine = recentTips.length > 0
      ? `Recent coaching tips shown to player:\n${recentTips.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
      : '';

    const tipLine = tipContext?.trim()
      ? `The player is asking about this specific tip/analysis:\n"${tipContext.trim()}"`
      : '';

    const contextBlock = [fenLine, perspLine, gameGoals, recentTipsLine, tipLine]
      .filter(Boolean)
      .join('\n');

    const personality = getChessPersonality(this.activeCoachPersonalityId);
    const formatRule = 'Be concise, concrete, and chess-specific. Reference the actual position and recent moves when relevant. Keep answers under 120 words. Respond in plain text (not JSON).';
    const systemPrompt = personality.id !== 'default'
      ? `${personality.promptStyle}\n\n${formatRule}`
      : `You are a strong chess coach answering a player's question during a live game. ${formatRule}`;

    const userPrompt = contextBlock
      ? `${contextBlock}\n\nPlayer's question: ${question}`
      : `Player's question: ${question}`;

    log.info({ questionLength: question.length, hasTipContext: !!tipContext, hasFen: !!fullFen, recentTipCount: recentTips.length }, '[LiveAssist] Chat question received');

    const response = await llm.complete(userPrompt, systemPrompt, 30000, GPT_54_MODEL);

    if (!response.success || !response.content) {
      log.warn({ error: response.error }, '[LiveAssist] Chat LLM failed');
      throw new Error(response.error || 'Failed to get a response');
    }

    return response.content.trim();
  }

  /**
   * Add a raw screenshot frame to be processed for FEN extraction.
   *
   * When a LiteLLM key is configured this sends the image directly to gpt-5.4
   * using the same retry logic as the Python benchmark script, then injects
   * the result into the visual buffer as tagged text identical to what the
   * VideoDB WebSocket produces.
   *
   * When no LiteLLM key is configured this is a no-op — the existing
   * addVisualIndex() path via the VideoDB WebSocket is used instead.
   */
  async addVisualFrame(
    imageBuffer: Buffer,
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp',
    indexingPrompt: string
  ): Promise<void> {
    await this.addVisualFrameWithResult(imageBuffer, mimeType, indexingPrompt);
  }

  /**
   * Same as addVisualFrame but returns the extracted FEN board string (or null).
   *
   * ChessScreenshotService uses the returned value to:
   *   - detect consecutive null streaks → invalidate board-region cache
   *   - detect a new FEN → trigger burst confirmation captures
   */
  async addVisualFrameWithResult(
    imageBuffer: Buffer,
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp',
    indexingPrompt: string
  ): Promise<{ fenBoard: string; perspective: 'white' | 'black' } | null> {
    if (!this.isRunning) return null;

    const llm = getLLMService();

    log.debug({ mimeType }, '[LiveAssist] addVisualFrame: extracting FEN via VideoDB');

    const result = await llm.extractFenFromImage(imageBuffer, mimeType, indexingPrompt);
    if (!result) {
      log.debug('[LiveAssist] addVisualFrame: FEN extraction returned null, skipping');
      return null;
    }

    const { fenBoard, perspective } = result;

    // Reconstruct a synthetic tagged text identical to what the VideoDB WebSocket
    // produces so the existing FEN parsing pipeline needs no changes.
    // The pipeline always works in white's perspective internally.
    const syntheticText = `<perspective>\nwhite\n</perspective>\n\n<raw_board>\n${fenBoard}\n</raw_board>`;
    this.addVisualIndex(syntheticText);
    return { fenBoard, perspective };
  }

  /**
   * Accept a pre-extracted, majority-voted FEN board string and inject it
   * directly into the visual index buffer as synthetic tagged text.
   *
   * Called by ChessScreenshotService after the vote window has produced a
   * consensus FEN — the LLM extraction step has already happened upstream,
   * so this method skips it entirely and goes straight to addVisualIndex().
   *
   * @param fenBoard     - Board string already normalised to white's perspective
   * @param perspective  - Original perspective detected in the image. Stored so
   *                       the overlay can display the board as the player sees it.
   * @param reportedTurn - Whose turn it is as reported directly by the LLM from
   *                       UI turn indicators (clocks, active-player highlights).
   *                       When non-null this is the authoritative seed used
   *                       instead of the perspective-derived fallback, giving
   *                       accurate turn detection for mid-game sessions and for
   *                       players viewing the board from Black's perspective.
   *                       Null means the LLM couldn't see a turn indicator and
   *                       the heuristic fallback is used.
   *
   * Returns true if the FEN was accepted into the buffer, false if the
   * service is not running.
   */
  injectConfirmedFen(fenBoard: string, perspective: 'white' | 'black' = 'white', reportedTurn: 'w' | 'b' | null = null, cycleId?: number, voteMeta?: VoteMeta): boolean {
    if (!this.isRunning) return false;

    // Store cycle ID and vote metadata so downstream steps can continue tracking.
    if (cycleId !== undefined) {
      this.currentCycleId = cycleId;
      this.currentVoteMeta = voteMeta;
      // Attach vote-read-1 metadata to the confirming cycle immediately so
      // the tracker can compute the fenStabilization phase.
      if (voteMeta !== undefined) {
        pipelineLatency.setVoteMeta(cycleId, voteMeta);
      }
    }

    // If lastChessTurn is null it means this is the first FEN of a new game
    // (state was reset by start() or we're on a fresh session). In this case
    // also reset lastChessBoard so we don't inherit a stale board from a
    // previous game — which would cause prevBoard===currBoard to keep the
    // wrong turn even though we have a fresh perspective seed.
    if (this.lastChessTurn === null) {
      this.lastChessBoard = null;
    }

    // Prefer the turn reported directly by the indexing LLM from UI indicators
    // (highlighted move, clocks, active-player styling). When the highlight was
    // missed (both vote frames captured after the highlight faded), fall back to
    // the board-diff heuristic which compares piece counts between the previous
    // confirmed board and the new one. Only use the perspective seed as a last
    // resort when there is genuinely no board history to diff against.
    const inferredTurn: 'w' | 'b' =
      reportedTurn ??
      (this.lastChessBoard && this.lastChessBoard !== fenBoard
        ? this.inferTurnFromBoards(this.lastChessBoard, fenBoard, this.lastChessTurn)
        : null) ??
      (perspective === 'black' ? 'b' : 'w');

    // Update castling rights from this confirmed board before updating other state.
    // This ensures getCastlingRightsString() is accurate when we build the FEN below.
    this.updateCastlingRightsFromBoard(fenBoard);

    // Update tracked state immediately so processTranscriptInner uses the
    // correct turn even before a coaching tip is generated.
    this.lastChessTurn = inferredTurn;
    this.lastChessBoard = fenBoard;

    const castling = this.getCastlingRightsString();
    log.debug(
      { fenBoard: fenBoard.slice(0, 30), perspective, reportedTurn, inferredTurn, castling },
      '[LiveAssist] injectConfirmedFen: turn and castling rights updated'
    );

    // Store the perspective so we can emit it with the 'fen' event
    this.lastChessPerspective = perspective;

    // Emit 'fen' immediately so the overlay board updates the moment a new
    // confirmed position is available — even if the coaching LLM call
    // fails/times out later. This decouples board display from tip generation.
    // Clear engine fields so the overlay doesn't show stale move/eval for the new position.
    this.lastEngineSan = undefined;
    this.lastEngineEval = undefined;
    this.lastEngineMate = undefined;
    const whitePerspectiveFen = `${fenBoard} ${inferredTurn} ${castling} - 0 1`;
    const displayFen = this.buildDisplayFen(whitePerspectiveFen, perspective);
    this.emit('fen', {
      fen: whitePerspectiveFen,
      displayFen,
      board: fenBoard,
      turn: inferredTurn,
      engineSan: undefined,
      engineEval: undefined,
      engineMate: undefined,
    });

    // The pipeline always works in white's perspective.
    // The <source>screenshot</source> tag marks this as coming from the
    // validated screenshot path so extractLatestFen can prefer it over
    // RTStream board_mapping items which may be noisy or incorrectly normalised.
    const syntheticText = `<source>\nscreenshot\n</source>\n\n<perspective>\nwhite\n</perspective>\n\n<raw_board>\n${fenBoard}\n</raw_board>`;
    this.addVisualIndex(syntheticText);
    return true;
  }

  /**
   * Add a visual index event to the buffer
   */
  addVisualIndex(text: string): void {
    if (!this.isRunning) return;

    const normalizedText = this.sanitizeInsightText(text);
    const actionableText = this.stripNonActionableVisualText(normalizedText || text);
    if (!actionableText) {
      log.debug({ preview: normalizedText.substring(0, 120) }, '[LiveAssist] Ignoring non-actionable visual feed item');
      return;
    }

    const now = Date.now();
    const isLikelyDuplicate =
      !!actionableText &&
      this.lastVisualText === actionableText &&
      (now - this.lastVisualTextAt) <= VISUAL_DUPLICATE_WINDOW_MS;

    if (isLikelyDuplicate) {
      log.debug({ preview: normalizedText.substring(0, 120) }, '[LiveAssist] Skipping duplicate visual feed item');
      return;
    }

    this.lastVisualText = actionableText;
    this.lastVisualTextAt = now;

    log.debug(
      {
        preview: actionableText.substring(0, 140),
        length: text.length,
        bufferSizeBefore: this.visualIndexBuffer.length,
      },
      '[LiveAssist] Visual feed item received'
    );

    const low = actionableText.toLowerCase();

    this.visualIndexBuffer.push({
      text: actionableText,
      timestamp: now,
    });

    this.scheduleProcessing();

    const timingProfile = getGameVisualIndexTiming(this.activeGameId);

    // Keep only the active game's visual context for processing
    const cutoff = now - timingProfile.visualContextWindowMs;
    this.visualIndexBuffer = this.visualIndexBuffer.filter(v => v.timestamp > cutoff);

    log.debug({ bufferSizeAfter: this.visualIndexBuffer.length }, '[LiveAssist] Visual feed buffered');
  }

  /**
   * Build gameplay action section for prompt (only if recent visual data exists)
   */
  private buildVisualIndexSection(cutoff: number): string {
    const recentVisuals = this.visualIndexBuffer.filter(v => v.timestamp > cutoff);
    if (recentVisuals.length === 0) return '';

    const visualText = recentVisuals.map(v => v.text).join('\n');
    return `## GAMEPLAY ACTION FEED\n${visualText}\n\n---\n\n`;
  }

  /**
   * Process transcript and generate assists
   */
  private async processTranscript(): Promise<void> {
    if (!this.isRunning) return;

    // Prevent concurrent runs: if a previous LLM call is still in flight,
    // skip this tick rather than firing a duplicate request.
    if (this.isProcessing) {
      log.debug('processTranscript: skipping tick, previous call still in flight');
      return;
    }

    this.isProcessing = true;
    try {
      // Race the inner call against a hard timeout so isProcessing is always
      // released even if the OpenAI SDK's own timeout doesn't fire.
      await Promise.race([
        this.processTranscriptInner(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('processTranscript timed out')), PROCESS_TRANSCRIPT_TIMEOUT_MS)
        ),
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ error: msg }, 'processTranscript: inner call failed or timed out — releasing isProcessing lock');
    } finally {
      this.isProcessing = false;
    }
  }

  private async processTranscriptInner(): Promise<void> {
    if (!this.isRunning) return;
    const trackedCycleId = this.currentCycleId;

    // Convenience wrapper — only calls endCycle when a screenshot-path cycle
    // is active AND coaching is not still running in the background.
    // If coachingInFlight is true, runCoachingLLM owns the cycle close.
    // Clears currentCycleId after closing so the same cycle cannot be
    // re-closed by a later processTranscriptInner call.
    const endCycleIfTracked = (reason: string) => {
      if (this.currentCycleId !== undefined && !this.coachingInFlight) {
        pipelineLatency.endCycle(this.currentCycleId, reason);
        this.currentCycleId = undefined;
        this.currentVoteMeta = undefined;
      }
    };

    const now = Date.now();

    // Only run when fresh gameplay visuals have arrived since last processing
    const newVisuals = this.visualIndexBuffer.filter(v => v.timestamp > this.lastProcessedTimestamp);
    if (newVisuals.length === 0) {
      log.debug('No new gameplay action feed to process');
        endCycleIfTracked('noNewVisuals');
      return;
    }

    const freshGameplayVisuals = newVisuals.filter((v) => !this.isNonActionableVisualText(v.text));
    if (freshGameplayVisuals.length === 0) {
      this.lastProcessedTimestamp = now;
      log.debug('Only non-actionable visual frames in latest batch; skipping update');
        endCycleIfTracked('nonActionableVisuals');
      return;
    }

    const timingProfile = getGameVisualIndexTiming(this.activeGameId);

    // Build prompt context from a wider recent window to reduce sparse-feed dropouts
    const cutoff = now - timingProfile.visualContextWindowMs;
    const recentVisuals = this.visualIndexBuffer.filter(v => v.timestamp > cutoff);
    const focusedVisuals = this.visualIndexBuffer.filter(v => v.timestamp > (now - timingProfile.visualRecencyFocusMs));
    const filteredRecentVisuals = recentVisuals.filter((v) => !this.isNonActionableVisualText(v.text));
    const filteredFocusedVisuals = focusedVisuals.filter((v) => !this.isNonActionableVisualText(v.text));
    const promptVisuals = filteredFocusedVisuals.length > 0 ? filteredFocusedVisuals : filteredRecentVisuals.slice(-10);

    if (promptVisuals.length === 0) {
      this.lastProcessedTimestamp = now;
      log.debug('No recent gameplay action feed to process');
        endCycleIfTracked('noRecentVisuals');
      return;
    }

    const newContext = freshGameplayVisuals.map((v) => v.text).join(' ');
    void newContext; // no round-state tracking needed for chess

    const recentTexts = promptVisuals.map(v => v.text);
    if (!this.isLikelyGameplayFeed(recentTexts)) {
      log.debug(
        {
          newVisualCount: newVisuals.length,
          recentVisualCount: promptVisuals.length,
          sample: recentTexts.slice(-3),
        },
        'Skipping live assist: visuals are not recognized as gameplay feed'
      );
      this.lastProcessedTimestamp = now;
        endCycleIfTracked('notGameplayFeed');
      // Do not emit instructional noise while waiting for valid gameplay context.
      return;
    }

    // Chess: only generate a new tip when a valid recent FEN changes.
    // If no FEN is visible in the current window, skip the update entirely.
    const latestFen = this.activeGameId === 'chess' ? this.extractLatestFen(promptVisuals) : null;
    const chessSignature = (() => {
      if (this.activeGameId !== 'chess') return null;
      if (!latestFen) return null;
      return latestFen.split(' ')[0] || latestFen;
    })();
    if (this.activeGameId === 'chess' && !chessSignature) {
      log.debug('Skipping chess tip: no valid FEN visible in current window');
      this.lastProcessedTimestamp = now;
        endCycleIfTracked('noFenInWindow');
      return;
    }

    // Chess: the FEN reaching live-assist has already been majority-voted by
    // ChessScreenshotService (the vote buffer requires matching readings before
    // the FEN is injected). No additional stabilization wait is needed here —
    // on a new signature, proceed straight to the engine + coaching pipeline.
    if (this.activeGameId === 'chess' && chessSignature) {
      if (chessSignature === this.pendingChessSignature) {
        this.pendingChessSignatureCount++;
      } else {
        this.pendingChessSignature = chessSignature;
        this.pendingChessSignatureCount = 1;
      }
    }

    if (this.activeGameId === 'chess' && chessSignature === this.lastChessSignature) {
      log.debug({ chessSignature }, '[LiveAssist] Skipping chess tip: position signature unchanged');
      this.lastProcessedTimestamp = now;
      // Only close the cycle if coaching is not still running in the background.
      // If coachingInFlight is true, runCoachingLLM will close it when it finishes.
      if (!this.coachingInFlight) {
        endCycleIfTracked('signatureUnchanged');
      }
      return;
    }

    // Chess latency is tracked from the screenshot-confirmed FEN pipeline.
    // Raw websocket visual-index frames can arrive earlier with the same board,
    // but they do not carry a cycleId, so using them would generate valid tips
    // that cannot be attributed to the real measured pipeline.
    //
    // Fallback: if the screenshot vote has been inconclusive for 3+ consecutive
    // websocket frames with the same FEN, allow tip generation anyway so the
    // player is never left without coaching when the screenshot path is flaky.
    const WEBSOCKET_FALLBACK_THRESHOLD = 3;
    const websocketFallbackAllowed =
      this.activeGameId === 'chess' &&
      trackedCycleId === undefined &&
      this.pendingChessSignatureCount >= WEBSOCKET_FALLBACK_THRESHOLD;

    if (this.activeGameId === 'chess' && trackedCycleId === undefined && !websocketFallbackAllowed) {
      this.lastProcessedTimestamp = now;
      log.debug({ chessSignature, pendingCount: this.pendingChessSignatureCount }, '[LiveAssist] Waiting for screenshot-confirmed chess cycle before generating tip');
      return;
    }

    if (websocketFallbackAllowed) {
      log.info({ chessSignature, pendingCount: this.pendingChessSignatureCount }, '[LiveAssist] Using websocket-only FEN fallback — screenshot vote inconclusive');
      // Reset so we don't continuously re-trigger on each subsequent websocket frame
      this.pendingChessSignatureCount = 0;
    }

    log.debug(
      {
        activeGameId: this.activeGameId,
        promptVisualCount: promptVisuals.length,
      },
      '[LiveAssist] Evaluating chess engine path'
    );

    const chessContext = await this.buildChessContext(promptVisuals, latestFen || undefined, trackedCycleId);

    // If this pass started from the websocket path with no screenshot cycle, but a
    // tracked screenshot cycle arrived while the engine request was in flight, let
    // that newer cycle own latency + signature state instead of mixing phases.
    if (trackedCycleId === undefined && this.currentCycleId !== undefined) {
      log.debug({ adoptedCycleId: this.currentCycleId, chessSignature }, '[LiveAssist] Skipping untracked result because a tracked screenshot cycle arrived');
      return;
    }

    // If the engine rejected the FEN or returned no analysis, skip the LLM call entirely.
    // Without engine data the LLM would hallucinate moves — better to show nothing.
    if (this.activeGameId === 'chess' && !chessContext) {
      log.warn({ chessSignature }, '[LiveAssist] No engine analysis for this position — skipping LLM tip');
      this.lastProcessedTimestamp = now;
      endCycleIfTracked('noEngineAnalysis');
      // Invalidate the pending signature so we retry when a new (valid) FEN arrives.
      this.pendingChessSignature = null;
      this.pendingChessSignatureCount = 0;
      return;
    }

    // Determine the player's color from perspective, and the side currently to move.
    // lastChessPerspective = which side the player is playing as (board orientation).
    // chessContext.turn   = whose turn it actually is right now in the position.
    const playerColor: 'w' | 'b' = this.lastChessPerspective === 'black' ? 'b' : 'w';
    const sideToMove: 'w' | 'b' = chessContext?.turn ?? playerColor;
    const isPlayerTurn = sideToMove === playerColor;
    const playerColorLabel = playerColor === 'b' ? 'Black' : 'White';
    const opponentColorLabel = playerColor === 'b' ? 'White' : 'Black';

    // If it is the opponent's turn, run a threat-analysis LLM call:
    // explain what the opponent's best move threatens and what the player must watch out for.
    if (!isPlayerTurn) {
      const bestOppMoveSan = (() => {
        const summary = chessContext?.engineSummary || '';
        const m = summary.match(/Best move SAN:\s*(\S+)/i);
        return m?.[1] ?? null;
      })();

      // Immediate engine-only fallback shown while LLM runs
      if (this.activeGameId === 'chess' && chessContext?.engineSummary) {
        if (trackedCycleId !== undefined) pipelineLatency.startStep(trackedCycleId, 'engineTip');
        const evalLine = this.formatEngineAsTip(chessContext);
        this.emit('insights', {
          insights: { say_this: [`${opponentColorLabel} to move — ${evalLine}`], ask_this: [] },
          processedAt: Date.now(),
          clearExisting: true,
        });
        if (trackedCycleId !== undefined) pipelineLatency.endStep(trackedCycleId, 'engineTip');
      }

      // Update state and emit FEN
      if (this.activeGameId === 'chess' && chessSignature) {
        this.lastChessSignature = chessSignature;
        this.lastChessBoard = chessContext?.board || chessSignature;
        this.lastChessTurn = sideToMove;
        // Store engine result on instance so subsequent fen emits carry it too.
        this.lastEngineSan = chessContext?.engineSan;
        this.lastEngineEval = chessContext?.engineEval;
        this.lastEngineMate = chessContext?.engineMate;
        this.pendingChessSignature = null;
        this.pendingChessSignatureCount = 0;
        const whitePerspFen = chessContext?.fen || `${chessSignature} ${sideToMove} - - 0 1`;
        const dFen = this.buildDisplayFen(whitePerspFen, this.lastChessPerspective);
        this.emit('fen', {
          fen: whitePerspFen,
          displayFen: dFen,
          board: this.lastChessBoard,
          turn: sideToMove,
          engineSan: this.lastEngineSan,
          engineEval: this.lastEngineEval,
          engineMate: this.lastEngineMate,
        });
      }
      this.lastProcessedTimestamp = now;

      // Fire threat-analysis LLM in the background so the player sees WHY the
      // opponent's best move is dangerous and what to watch out for next turn.
      if (chessContext && bestOppMoveSan) {
        const gameContextSection = this.meetingContext?.description?.trim()
          ? `## PLAYER'S GAME GOALS\n${this.meetingContext.description.trim()}\n\n`
          : '';
        // Decode the LAN move to anchor which piece the opponent is moving
        const bestOppMoveLan = (() => {
          const m = (chessContext.engineSummary || '').match(/Best move LAN:\s*(\S+)/i);
          return m?.[1] ?? null;
        })();
        const oppPieceDesc = (chessContext.board && bestOppMoveLan)
          ? this.describeMovingPiece(chessContext.board, bestOppMoveLan)
          : null;
        const oppPieceAnchor = oppPieceDesc
          ? `Moving piece: ${oppPieceDesc} (confirmed from FEN — do NOT contradict this).`
          : '';
        const threatPrompt = `${gameContextSection}## CHESS POSITION CONTEXT\nFEN: ${chessContext.fen}\nYou are coaching ${playerColorLabel}. It is currently ${opponentColorLabel}'s turn.\n${chessContext.engineSummary ? `Engine summary:\n${chessContext.engineSummary}\n` : ''}\n---\n\n## OPPONENT'S BEST MOVE: ${bestOppMoveSan}\n${oppPieceAnchor}\nThe engine says ${opponentColorLabel}'s best move is ${bestOppMoveSan}.\nExplain to ${playerColorLabel} what this move threatens or achieves, and what ${playerColorLabel} must prepare or watch out for.\nOnly mention piece positions that are confirmed by the FEN. Do not invent piece locations.\nFor say_this: describe the concrete threat or idea behind ${bestOppMoveSan} — what it attacks, pins, opens, or prepares — so ${playerColorLabel} knows what to defend against.\nFor ask_this: ask what ${playerColorLabel}'s best defensive or counter response would be.\nRespond with ONLY a raw JSON object: {"say_this":"...","ask_this":"..."}`;

        this.coachingInFlight = true;
        void this.runCoachingLLM(chessContext, chessSignature, threatPrompt, bestOppMoveSan, trackedCycleId);
      } else {
        endCycleIfTracked('opponentTurnNoMove');
      }
      return;
    }

    const chessSection = chessContext
      ? `## CHESS POSITION CONTEXT\nFEN: ${chessContext.fen}\nPlayer is: ${playerColorLabel} (generate the tip for ${playerColorLabel}'s best move)\n${chessContext.playedMoveSan ? `Played SAN: ${chessContext.playedMoveSan}\n` : ''}${chessContext.playedMoveUci ? `Played UCI: ${chessContext.playedMoveUci}\n` : ''}${chessContext.engineSummary ? `Engine summary:\n${chessContext.engineSummary}\n` : ''}\n---\n\n`
      : '';

    // If the player provided a game description (goals, opening, context), prepend it
    // so the coaching LLM can tailor its explanations to the player's stated objectives.
    const gameContextSection = this.meetingContext?.description?.trim()
      ? `## PLAYER'S GAME GOALS\n${this.meetingContext.description.trim()}\n\n`
      : '';

    // Emit an immediate engine-only tip so the user sees something instantly.
    if (this.activeGameId === 'chess' && chessContext?.engineSummary) {
      if (trackedCycleId !== undefined) pipelineLatency.startStep(trackedCycleId, 'engineTip');
      const engineFallback = this.formatEngineAsTip(chessContext);
      this.emit('insights', {
        insights: { say_this: [engineFallback], ask_this: [] },
        processedAt: Date.now(),
        clearExisting: true,
      });
      if (trackedCycleId !== undefined) pipelineLatency.endStep(trackedCycleId, 'engineTip');
      log.debug({ chessSignature }, '[LiveAssist] Emitted immediate engine-only tip while coaching LLM runs');
    }

    // Extract the engine's best move SAN and LAN so we can hard-anchor the coaching prompt.
    // Parse both from the summary to guarantee the model explains THIS move.
    const bestMoveSan = (() => {
      const summary = chessContext?.engineSummary || '';
      const m = summary.match(/Best move SAN:\s*(\S+)/i);
      return m?.[1] ?? null;
    })();
    const bestMoveLan = (() => {
      const summary = chessContext?.engineSummary || '';
      const m = summary.match(/Best move LAN:\s*(\S+)/i);
      return m?.[1] ?? null;
    })();

    // Decode which piece is on the from-square so the LLM cannot hallucinate it.
    const movingPieceDesc = (chessContext?.board && bestMoveLan)
      ? this.describeMovingPiece(chessContext.board, bestMoveLan)
      : null;

    const pieceAnchor = movingPieceDesc
      ? `Moving piece: ${movingPieceDesc} (confirmed from FEN — do NOT contradict this).`
      : '';

    // Full coaching prompt — flat single string for generateText (no role separation).
    // gamePrompt is intentionally excluded: it told the LLM to "use the chess engine API"
    // (self-analysis), which caused it to invent moves instead of explaining the engine's move.
    // The best move SAN is embedded directly so the model cannot substitute its own.
    const bestMoveInstruction = bestMoveSan
      ? `## REQUIRED MOVE: ${bestMoveSan}\nYou MUST use "${bestMoveSan}" as the move in say_this. Do not suggest any other move.\n${pieceAnchor}`
      : '## TASK\nUse the best move from the engine summary above.';

    const userPrompt = `${gameContextSection}${chessSection}${bestMoveInstruction}
Explain why ${bestMoveSan ?? 'the engine move'} is best in this exact position.
For say_this, include:
1. what changes immediately on the board,
2. the concrete tactical or positional point,
3. the piece, square, file, diagonal, pawn break, or threat that matters.
Only mention piece positions that are confirmed by the FEN. Do not invent piece locations.
Avoid generic advice.
For ask_this, write one short calculation question about the next move or likely response.
Respond with ONLY a raw JSON object: {"say_this":"...","ask_this":"..."}`;
    log.info({ visualCount: promptVisuals.length, hasVisual: !!chessSection }, 'Processing gameplay feed for live assist');

    // Mark this position as processed immediately so isProcessing is released.
    // The coaching LLM fires in the background and upgrades the engine tip when ready.
    if (this.activeGameId === 'chess' && chessSignature) {
      this.lastChessSignature = chessSignature;
      this.lastChessBoard = chessContext?.board || chessSignature;
      this.lastChessTurn = chessContext?.turn || this.lastChessTurn;
      // Store engine result on instance so subsequent fen emits carry it too.
      this.lastEngineSan = chessContext?.engineSan;
      this.lastEngineEval = chessContext?.engineEval;
      this.lastEngineMate = chessContext?.engineMate;
      this.pendingChessSignature = null;
      this.pendingChessSignatureCount = 0;
      const whitePerspFen = chessContext?.fen || `${chessSignature} ${this.lastChessTurn || 'w'} - - 0 1`;
      const dFen = this.buildDisplayFen(whitePerspFen, this.lastChessPerspective);
      this.emit('fen', {
        fen: whitePerspFen,
        displayFen: dFen,
        board: this.lastChessBoard,
        turn: this.lastChessTurn,
        engineSan: this.lastEngineSan,
        engineEval: this.lastEngineEval,
        engineMate: this.lastEngineMate,
      });
    }
    this.lastProcessedTimestamp = now;

    // Fire coaching LLM as fire-and-forget — it will upgrade the engine tip
    // when it completes. isProcessing is released immediately after this return.
    this.coachingInFlight = true;
    void this.runCoachingLLM(chessContext, chessSignature, userPrompt, bestMoveSan, trackedCycleId);
  }

  /**
   * Fire-and-forget coaching LLM call.
   * Runs after isProcessing has been released so new moves are never blocked.
   * Upgrades the engine-only tip with a full coaching explanation when it resolves.
   */
  private async runCoachingLLM(
    chessContext: ChessContextData | null,
    chessSignature: string | null,
    userPrompt: string,
    bestMoveSan: string | null,
    cycleId?: number
  ): Promise<void> {
    const hasLatency = cycleId !== undefined;

    // Convenience wrappers — no-op when cycleId is unavailable.
    const startStep = (step: Parameters<typeof pipelineLatency.startStep>[1]) => {
      if (hasLatency) pipelineLatency.startStep(cycleId!, step);
    };
    const endStep = (step: Parameters<typeof pipelineLatency.endStep>[1], err?: string) => {
      if (hasLatency) pipelineLatency.endStep(cycleId!, step, err);
    };
    const endCycle = (reason: string) => {
      if (hasLatency) {
        pipelineLatency.endCycle(cycleId!, reason);
        // Clear currentCycleId so this cycle cannot be re-closed by a
        // subsequent visual-index-path processTranscriptInner call.
        if (this.currentCycleId === cycleId) {
          this.currentCycleId = undefined;
          this.currentVoteMeta = undefined;
        }
      }
    };

    try {
      // Build the system prompt: personality character sheet (identity) first,
      // then the output format rules. For the default coach the format rules alone suffice.
      const personality = getChessPersonality(this.activeCoachPersonalityId);
      const activeSystemPrompt = personality.id !== 'default'
        ? `${personality.promptStyle}\n\n${CHESS_SYSTEM_PROMPT}`
        : CHESS_SYSTEM_PROMPT;
      const fullPrompt = [activeSystemPrompt, userPrompt].join('\n\n');

      log.info(
        { promptTokensEstimate: Math.ceil(fullPrompt.length / 4), model: GPT_54_MODEL },
        '[LiveAssist] Requesting coaching tip via gpt-5.4 [background]',
      );

      // Coaching now uses the same direct gpt-5.4 path as FEN extraction instead of
      // VideoDB generateText('pro'), so analysis and tip generation stay on one model.
      const llm = getLLMService();
      startStep('coachingLLM');
      const response = await llm.complete(fullPrompt, undefined, 45000, GPT_54_MODEL);
      endStep('coachingLLM');
      const rawText = response.success ? response.content : null;

      if (!response.success) {
        log.warn({ error: response.error }, '[LiveAssist] Background coaching (gpt-5.4) failed — engine tip stays');
      }

      // Discard if position has moved on
      if (chessSignature && chessSignature !== this.lastChessSignature) {
        endCycle('coachingStale');
        log.debug({ chessSignature }, '[LiveAssist] Coaching response stale — position changed, discarding');
        return;
      }

      // Measure the full post-LLM tip generation path: JSON cleanup, parsing,
      // filtering, dedupe/cooldown checks, and the final emit if one occurs.
      startStep('coachingTip');

      const parseCoachingJson = (text: string | null): LiveInsights | null => {
        if (!text) return null;
        let s = text.trim();
        const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fenceMatch) s = fenceMatch[1].trim();
        else s = s.replace(/^```(?:json)?\s*/i, '').trim();
        const j0 = s.indexOf('{'), j1 = s.lastIndexOf('}');
        if (j0 !== -1 && j1 > j0) s = s.slice(j0, j1 + 1);
        try {
          const raw = JSON.parse(s) as Record<string, unknown>;
          // The VideoDB SDK converts snake_case response keys to camelCase
          // (sayThis, askThis) but LiveInsights expects snake_case (say_this,
          // ask_this). Accept both forms so the tip is never silently dropped.
          return {
            say_this: (raw.say_this ?? raw.sayThis ?? []) as string[],
            ask_this: (raw.ask_this ?? raw.askThis ?? []) as string[],
          } as LiveInsights;
        }
        catch { return null; }
      };

      let parsed: LiveInsights | null = parseCoachingJson(rawText);

      log.debug(
        {
          hasData: !!parsed,
          rawPreview: (rawText ?? '').slice(0, 300),
          say_this: String(parsed?.say_this ?? '').slice(0, 80),
        },
        '[LiveAssist] Background coaching response received',
      );

      const normalizeInsights = (value: unknown): string[] => {
        if (!value) return [];
        if (Array.isArray(value)) return (value as unknown[]).filter((i): i is string => typeof i === 'string');
        if (typeof value === 'string') return [value];
        return [];
      };

      const maybeRepairGenericTip = async (current: LiveInsights | null): Promise<LiveInsights | null> => {
        if (!current) return current;
        const currentSay = normalizeInsights(current.say_this)
          .map(item => this.sanitizeInsightText(item))
          .find(Boolean) || '';

        if (this.isSpecificChessTip(currentSay, bestMoveSan)) return current;

        const repairPrompt = `${userPrompt}

Previous draft was too generic:
${currentSay || '(empty)'}

Rewrite it so say_this is more position-specific. Name the required move, explain the immediate board effect, and mention the exact threat, square, line, or piece activity that improves. Return ONLY raw JSON.`;

        const repairResponse = await llm.complete(repairPrompt, activeSystemPrompt, 15000, GPT_54_MODEL);
        if (!repairResponse.success || !repairResponse.content) return current;

        const repaired = parseCoachingJson(repairResponse.content);
        const repairedSay = normalizeInsights(repaired?.say_this)
          .map(item => this.sanitizeInsightText(item))
          .find(Boolean) || '';

        return this.isSpecificChessTip(repairedSay, bestMoveSan) ? repaired : current;
      };

      parsed = await maybeRepairGenericTip(parsed);

      if (!parsed) {
        endStep('coachingTip', 'null response');
        endCycle('coachingNullResponse');
        log.warn('[LiveAssist] Coaching response null — keeping engine fallback');
        return;
      }

      const sayValue = String(parsed.say_this ?? '');
      if (sayValue.trim().length <= 10) {
        endStep('coachingTip', 'short response');
        endCycle('coachingShortResponse');
        log.warn('[LiveAssist] Coaching response empty/short — keeping engine fallback');
        return;
      }

      const sayThisList = normalizeInsights(parsed.say_this)
        .map(item => this.sanitizeInsightText(item))
        .filter(Boolean)
        .filter(item => !this.previousSayThis.has(item.toLowerCase()))
        .slice(0, 3);
      const askThisList = normalizeInsights(parsed.ask_this)
        .map(item => this.sanitizeInsightText(item))
        .filter(Boolean)
        .filter(item => !this.previousAskThis.has(item.toLowerCase()))
        .slice(0, 3);

      let finalSayThis: string[] = [];
      let finalAskThis: string[] = [];

      // Build the full coaching output — paragraph tip + engine line + drill
      const paragraph = sayThisList.find(Boolean) || '';
      const maxParagraphChars = 1500; // 150-word cap ≈ ~900 chars; 1500 is a safe ceiling
      const trimmedParagraph = paragraph.length > maxParagraphChars
        ? paragraph.slice(0, maxParagraphChars).trim() : paragraph;
      if (trimmedParagraph) {
        const looksLikeFullFen = /[prnbqkPRNBQK1-8\/]+\s+[wb]\s+(?:-|[KQkq]{1,4})\s+(?:-|[a-h][36])\s+\d+\s+\d+/.test(trimmedParagraph);
        const looksLikeBoardOnly = /^[prnbqkPRNBQK1-8]+(?:\/[prnbqkPRNBQK1-8]+){7}$/.test(trimmedParagraph);
        if (!looksLikeFullFen && !looksLikeBoardOnly) {
          finalSayThis.push(trimmedParagraph);
        }
      }

      // Compact engine snippet
      const engineCompact = (() => {
        const raw = chessContext?.engineSummary || '';
        if (!raw) return '';
        const lines = raw.split('\n').map(l => this.sanitizeInsightText(l)).filter(Boolean);
        const pick = (prefix: string) => lines.find(l => l.toLowerCase().startsWith(prefix)) || '';
        const best = pick('best move') || pick('best');
        const evalLine = pick('eval') || pick('mate');
        const top = pick('top lines') || pick('top');
        const parts = [best, evalLine, top].filter(Boolean);
        const combined = (parts.length > 0 ? parts.join(' | ') : lines.slice(0, 2).join(' | ')).trim();
        return combined.length > 220 ? combined.slice(0, 220).trim() : combined;
      })();
      if (engineCompact) finalSayThis.push(`Engine: ${engineCompact}`);

      const drill = askThisList.find(Boolean) || '';
      if (drill) {
        const trimmedDrill = drill.length > 160 ? drill.slice(0, 160).trim() : drill;
        finalAskThis.push(/^drill:/i.test(trimmedDrill) ? trimmedDrill : `Drill: ${trimmedDrill}`);
      }

      if (finalSayThis.length === 0 && finalAskThis.length === 0) {
        endStep('coachingTip', 'empty output');
        endCycle('coachingEmptyOutput');
        return;
      }

      // Cooldown check — don't replace a fresh tip
      const nowMs = Date.now();
      const nextTipNormalized = finalSayThis[0]?.toLowerCase().trim() || null;
      const isSameTip = !!nextTipNormalized && nextTipNormalized === this.currentVisibleTip;
      const nextInstructionSignature = this.getInstructionSignature(finalSayThis, finalAskThis);
      const isSameInstruction = !!nextInstructionSignature && nextInstructionSignature === this.lastInstructionSignature;
      const withinReplaceCooldown = this.roundTipVisible && (nowMs - this.lastTipShownAt) < TIP_REPLACE_COOLDOWN_MS;
      if (isSameTip || isSameInstruction) {
        endStep('coachingTip', 'identical tip');
        endCycle('coachingIdenticalTip');
        log.debug('Skipping identical tip refresh');
        return;
      }
      if (withinReplaceCooldown) {
        endStep('coachingTip', 'cooldown');
        endCycle('coachingCooldown');
        log.debug('Skipping tip replacement during cooldown');
        return;
      }

      // Track to avoid repetition
      finalSayThis.forEach(item => this.previousSayThis.add(item.toLowerCase()));
      finalAskThis.forEach(item => this.previousAskThis.add(item.toLowerCase()));
      if (this.previousSayThis.size > 20) this.previousSayThis = new Set(Array.from(this.previousSayThis).slice(-20));
      if (this.previousAskThis.size > 20) this.previousAskThis = new Set(Array.from(this.previousAskThis).slice(-20));

      log.info({ sayCount: finalSayThis.length, askCount: finalAskThis.length }, '[LiveAssist] Coaching tip ready — upgrading engine fallback');

      this.emit('insights', {
        insights: { say_this: finalSayThis, ask_this: finalAskThis },
        processedAt: Date.now(),
        clearExisting: true,
      });
      endStep('coachingTip');
      endCycle('coachingTip');
      this.roundTipVisible = finalSayThis.length > 0;
      this.roundTipAutoClearAt = this.roundTipVisible ? Date.now() + TIP_VISIBLE_MS : null;
      this.currentVisibleTip = finalSayThis[0]?.toLowerCase().trim() || null;
      this.lastInstructionSignature = nextInstructionSignature || null;
      this.lastTipShownAt = Date.now();
      this.pendingRoundEndAt = null;

    } catch (error) {
      endStep('coachingTip', error instanceof Error ? error.message.slice(0, 80) : String(error).slice(0, 80));
      endCycle('coachingException');
      log.warn({ error: error instanceof Error ? error.message : String(error) }, '[LiveAssist] Background coaching (generateText) failed — engine tip stays');
    } finally {
      this.coachingInFlight = false;
    }
  }

  /**
   * Clear all state
   */
  clear(): void {
    this.transcriptBuffer = [];
    this.visualIndexBuffer = [];
    this.previousSayThis.clear();
    this.previousAskThis.clear();
    this.meetingContext = null;
    this.pendingRoundEndAt = null;
    this.roundTipVisible = false;
    this.roundTipAutoClearAt = null;
    this.currentVisibleTip = null;
    this.lastVisualText = null;
    this.lastVisualTextAt = 0;
    this.lastTipShownAt = 0;
    this.resetChessSessionState();
    this.isProcessing = false;
    this.coachingInFlight = false;
    if (this.roundStartClearTimer) {
      clearTimeout(this.roundStartClearTimer);
      this.roundStartClearTimer = null;
    }
  }
}

// Singleton instance
let instance: LiveAssistService | null = null;

export function getLiveAssistService(): LiveAssistService {
  if (!instance) {
    instance = new LiveAssistService();
  }
  return instance;
}

export function resetLiveAssistService(): void {
  if (instance) {
    instance.stop();
    instance.removeAllListeners();
    instance = null;
  }
}

export { LiveAssistService };
export type { TranscriptChunk };
