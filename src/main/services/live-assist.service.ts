/**
 * Live Assist Service
 *
 * Runs every few seconds during recording, analyzes recent visual gameplay feed,
 * and generates contextual coaching (tips + analysis)
 * using an LLM.
 */

import { EventEmitter } from 'events';
import { logger } from '../lib/logger';
import { getLLMService } from './llm.service';
import { getChessEngineService } from './chess-engine.service';
import type { LiveInsights } from '../../shared/types/live-assist.types';
import type { ProbingQuestion } from '../../shared/types/meeting-setup.types';
import {
  DEFAULT_GAME_ID,
  getGameVisualIndexTiming,
  getGameLiveAssistPrompt,
  type SupportedGameId,
} from '../../shared/config/game-coaching';

const log = logger.child({ module: 'live-assist' });

const TIP_VISIBLE_MS = 60000;
const TIP_REPLACE_COOLDOWN_MS = 10000;
const VISUAL_DUPLICATE_WINDOW_MS = 900;

const CHESS_SYSTEM_PROMPT = `ROLE
You are a chess coach focused on the current board only.

SOURCE RESTRICTIONS
- Use only the provided current visual board/FEN context and chess engine output.
- Do not use transcript/audio.

STRICT RULES
- Return ONLY JSON with keys say_this and ask_this.
- say_this: exactly one clear paragraph explaining the best move and why it is best in this position.
- ask_this: exactly one short drill sentence.
- Prioritize concrete tactical/positional reasons (threats, king safety, piece activity, pawn structure, forcing lines).
- If engine details are present, use them directly.
- Do not output markdown.`;

export interface MeetingContext {
  name?: string;
  description?: string;
  gameId?: SupportedGameId;
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
  playedMoveSan?: string;
  playedMoveUci?: string;
  board?: string;
  turn?: 'w' | 'b';
}

interface FenCandidate {
  fen: string;
  source: string;
}

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
  private pendingChessSignature: string | null = null;
  private pendingChessSignatureCount = 0;
  private isProcessing = false; // guard against concurrent processTranscript calls

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

  private sanitizeInsightText(text: string): string {
    return text
      .replace(/\*\*/g, '')
      .replace(/__+/g, '')
      .replace(/`+/g, '')
      .replace(/^\s*[-*•]\s*/g, '')
      .replace(/^\s*(say|ask)\s*:\s*/i, '')
      .replace(/\s*(say|ask)\s*:\s*/gi, ' ')
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

    // Require at least one king total — endgame positions or partially-visible
    // boards may show only one side's king; rejecting them causes persistent
    // FEN extraction failures on real games.
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

  private extractFenFromTaggedChessOutput(text: string): string | null {
    const perspectiveMatch = text.match(/<perspective>\s*([\s\S]*?)\s*<\/perspective>/i);
    const rawBoardMatches = [...text.matchAll(/<raw_board>\s*([\s\S]*?)\s*<\/raw_board>/gi)];

    if (!rawBoardMatches.length) return null;

    const perspectiveRaw = perspectiveMatch?.[1]?.toLowerCase() || '';
    const perspective: 'white' | 'black' = perspectiveRaw.includes('black') ? 'black' : 'white';
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
    // Chess should only advance when a valid recent FEN is visible.
    // Scan the current prompt window from newest to oldest, but only within
    // the fresh visuals that are already being processed.
    for (let i = visuals.length - 1; i >= 0; i--) {
      const candidates = this.extractFenCandidates(visuals[i].text);
      if (candidates.length > 0) {
        log.debug(
          { source: candidates[0].source, fen: candidates[0].fen },
          '[LiveAssist] Selected latest chess FEN'
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
      // No change detected — keep whatever we knew
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

  private applyNextTurnToFen(fen: string): { fen: string; board: string; turn: 'w' | 'b' } {
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 4) {
      return { fen, board: fen.split(' ')[0] || fen, turn: 'w' };
    }

    const [board, , castling, enPassant, halfmove = '0', fullmove = '1'] = parts;

    // Use piece-count comparison to determine whose turn it actually is
    const inferredTurn = this.inferTurnFromBoards(this.lastChessBoard, board, this.lastChessTurn);

    const nextFen = `${board} ${inferredTurn} ${castling} ${enPassant} ${halfmove} ${fullmove}`;
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

  private async buildChessContext(visuals: VisualIndexChunk[], fenOverride?: string): Promise<ChessContextData | null> {
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
    const resolvedFen = this.applyNextTurnToFen(fen);
    const latestMove = this.extractLatestChessMove(visuals);

    const engine = getChessEngineService();
    log.info(
      {
        fen,
        playedMoveSan: latestMove.san,
        playedMoveUci: latestMove.uci,
      },
      '[LiveAssist] Sending chess engine request'
    );
    const result = await engine.analyzeByFen(fen, {
      variants: 5,
      depth: 12,
      maxThinkingTime: 50,
    });

    if (!result) {
      // Engine had no analysis (invalid FEN, network error, etc.).
      // Return null so the caller skips the LLM tip — a tip without engine
      // backing would be hallucinated and potentially wrong.
      log.warn({ fen }, '[LiveAssist] Chess engine returned no analysis — skipping tip for this position');
      return null;
    }

    return {
      fen: resolvedFen.fen,
      engineSummary: engine.summarize(result),
      playedMoveSan: latestMove.san,
      playedMoveUci: latestMove.uci,
      board: resolvedFen.board,
      turn: resolvedFen.turn,
    };
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
    this.lastChessSignature = null;
    this.lastChessBoard = null;
    this.lastChessTurn = null;
    this.pendingChessSignature = null;
    this.pendingChessSignatureCount = 0;
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
    this.pendingRoundEndAt = null;
    this.roundTipVisible = false;
    this.roundTipAutoClearAt = null;
    this.currentVisibleTip = null;
    this.lastInstructionSignature = null;
    this.lastTipShownAt = 0;
    this.pendingChessSignature = null;
    this.pendingChessSignatureCount = 0;
    this.lastChessSignature = null;
    this.lastChessBoard = null;
    this.lastChessTurn = null;
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
    if (!this.isRunning) return;

    const llm = getLLMService();
    if (!llm.hasLitellmClient) {
      // No LiteLLM key — fall back to the VideoDB WebSocket path (addVisualIndex)
      return;
    }

    log.debug({ mimeType }, '[LiveAssist] addVisualFrame: extracting FEN via LiteLLM');

    const fenBoard = await llm.extractFenFromImage(imageBuffer, mimeType, indexingPrompt);
    if (!fenBoard) {
      log.debug('[LiveAssist] addVisualFrame: FEN extraction returned null, skipping');
      return;
    }

    // Reconstruct a synthetic tagged text identical to what the VideoDB WebSocket
    // produces so the existing FEN parsing pipeline needs no changes.
    const syntheticText = `<perspective>\nwhite\n</perspective>\n\n<raw_board>\n${fenBoard}\n</raw_board>`;
    this.addVisualIndex(syntheticText);
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
      await this.processTranscriptInner();
    } finally {
      this.isProcessing = false;
    }
  }

  private async processTranscriptInner(): Promise<void> {
    if (!this.isRunning) return;

    const now = Date.now();

    // Only run when fresh gameplay visuals have arrived since last processing
    const newVisuals = this.visualIndexBuffer.filter(v => v.timestamp > this.lastProcessedTimestamp);
    if (newVisuals.length === 0) {
      log.debug('No new gameplay action feed to process');
      return;
    }

    const freshGameplayVisuals = newVisuals.filter((v) => !this.isNonActionableVisualText(v.text));
    if (freshGameplayVisuals.length === 0) {
      this.lastProcessedTimestamp = now;
      log.debug('Only non-actionable visual frames in latest batch; skipping update');
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
      return;
    }

    if (this.activeGameId === 'chess' && chessSignature && chessSignature !== this.lastChessSignature) {
      if (this.pendingChessSignature !== chessSignature) {
        this.pendingChessSignature = chessSignature;
        this.pendingChessSignatureCount = 1;
        log.debug({ chessSignature }, '[LiveAssist] Waiting for chess FEN to stabilize');
        this.scheduleProcessing();
        return;
      }

      this.pendingChessSignatureCount += 1;
      if (this.pendingChessSignatureCount < 2) {
        log.debug(
          { chessSignature, pendingCount: this.pendingChessSignatureCount },
          '[LiveAssist] Waiting for repeated chess FEN before updating'
        );
        this.scheduleProcessing();
        return;
      }
    }

    if (this.activeGameId === 'chess' && chessSignature) {
      this.pendingChessSignature = chessSignature;
      this.pendingChessSignatureCount = Math.max(this.pendingChessSignatureCount, 2);
    }

    if (this.activeGameId === 'chess' && chessSignature === this.lastChessSignature) {
      log.debug({ chessSignature }, '[LiveAssist] Skipping chess tip: position signature unchanged');
      this.lastProcessedTimestamp = now;
      return;
    }

    // Build context sections (only included if they have content)
    const visualIndexSection = `## RECENT GAMEPLAY ACTION FEED (latest first, focus here)\n${promptVisuals
      .slice()
      .reverse()
      .map((v) => v.text)
      .join('\n')}\n\n---\n\n`;

    log.debug(
      {
        activeGameId: this.activeGameId,
        promptVisualCount: promptVisuals.length,
      },
      '[LiveAssist] Evaluating chess engine path'
    );

    const chessContext = await this.buildChessContext(promptVisuals, latestFen || undefined);

    // If the engine rejected the FEN or returned no analysis, skip the LLM call entirely.
    // Without engine data the LLM would hallucinate moves — better to show nothing.
    if (this.activeGameId === 'chess' && !chessContext) {
      log.warn({ chessSignature }, '[LiveAssist] No engine analysis for this position — skipping LLM tip');
      this.lastProcessedTimestamp = now;
      // Invalidate the pending signature so we retry when a new (valid) FEN arrives.
      this.pendingChessSignature = null;
      this.pendingChessSignatureCount = 0;
      return;
    }

    const chessSection = chessContext
      ? `## CHESS POSITION CONTEXT\nFEN: ${chessContext.fen}\n${chessContext.playedMoveSan ? `Played SAN: ${chessContext.playedMoveSan}\n` : ''}${chessContext.playedMoveUci ? `Played UCI: ${chessContext.playedMoveUci}\n` : ''}${chessContext.engineSummary ? `Engine summary:\n${chessContext.engineSummary}\n` : ''}\n---\n\n`
      : '';

    const userPrompt = `${visualIndexSection}${chessSection}## TASK\nGenerate exactly one coaching tip for the CURRENT moment. Hard recency rule: prioritize the latest 5-8 seconds; if an older location conflicts with a newer one, trust the newest visual evidence only. The tip must include: (1) context-specific mistake, (2) exact next action, (3) measurable success check. Also return one short fix drill. Avoid generic advice.`;
  const gamePrompt = getGameLiveAssistPrompt(this.activeGameId);

    log.info({ visualCount: promptVisuals.length, hasVisual: !!visualIndexSection }, 'Processing gameplay feed for live assist');

    try {
      const llm = getLLMService();
      const systemPrompt = CHESS_SYSTEM_PROMPT;

      const requestPayload = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'system' as const, content: gamePrompt },
        { role: 'user' as const, content: userPrompt },
      ];

      const isRetryableError = (error: unknown): boolean => {
        if (!error) return false;
        const message = error instanceof Error ? error.message : String(error);
        return /504|gateway timeout|cloudfront|timeout/i.test(message);
      };

      const callWithRetry = async (attempts: number): Promise<ReturnType<typeof llm.chatCompletionJSON<LiveInsights>>> => {
        let lastError: unknown;
        for (let attempt = 1; attempt <= attempts; attempt++) {
          try {
            if (attempt > 1) {
              const backoffMs = 500 * attempt;
              await new Promise((resolve) => setTimeout(resolve, backoffMs));
            }
            return await llm.chatCompletionJSON<LiveInsights>(requestPayload);
          } catch (error) {
            lastError = error;
            if (!isRetryableError(error) || attempt === attempts) {
              throw error;
            }
            log.warn({ attempt, error: error instanceof Error ? error.message : String(error) }, 'Retrying LLM request after transient error');
          }
        }

        throw lastError instanceof Error ? lastError : new Error('LLM request failed');
      };

      const response = await callWithRetry(3);

      log.debug(
        {
          success: response.success,
          hasData: !!response.data,
          error: response.error,
          dataPreview: response.data
            ? {
                say_this: response.data.say_this?.slice(0, 2),
                ask_this: response.data.ask_this?.slice(0, 2),
              }
            : null,
        },
        'Live assist LLM response received'
      );

      this.lastProcessedTimestamp = now;

      if (!response.success || !response.data) {
        if (this.activeGameId === 'chess' && chessContext?.engineSummary) {
          const engineFallback = `Engine: ${this.sanitizeInsightText(chessContext.engineSummary).slice(0, 320)}`;
          this.emit('insights', {
            insights: { say_this: [engineFallback], ask_this: [] },
            processedAt: Date.now(),
            clearExisting: true,
          });
        }
        log.warn({ error: response.error }, 'Failed to get live assist response');
        return;
      }

      const { say_this, ask_this } = response.data;
      log.debug({ say_this, ask_this }, 'Insights generated for this chunk');

      const normalizeInsights = (value: unknown): string[] => {
        if (!value) return [];
        if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
        if (typeof value === 'string') return [value];
        return [];
      };

      const sayThisList = normalizeInsights(say_this);
      const askThisList = normalizeInsights(ask_this);

      // Filter out duplicates from previous rounds
      const newSayThis = sayThisList
        .map(item => this.sanitizeInsightText(item))
        .filter(Boolean)
        .filter(item => !this.previousSayThis.has(item.toLowerCase()))
        .sort((a, b) => this.rankInsightPriority(b) - this.rankInsightPriority(a))
        .slice(0, 3);

      const newAskThis = askThisList
        .map(item => this.sanitizeInsightText(item))
        .filter(Boolean)
        .filter(item => !this.previousAskThis.has(item.toLowerCase()))
        .sort((a, b) => this.rankInsightPriority(b) - this.rankInsightPriority(a))
        .slice(0, 3);

      // Chess uses detailed tips; pass through without shooter-oriented compression.
      const contextAdjusted = { sayThis: newSayThis, askThis: newAskThis, clearExisting: false };

      let finalSayThis: string[] = [];
      let finalAskThis: string[] = [];

      if (this.activeGameId === 'chess') {
        // Preserve the LLM paragraph tip (3-5 sentences) for the overlay.
        const paragraph =
          contextAdjusted.sayThis.map((item) => this.sanitizeInsightText(item)).find(Boolean) ||
          '';
        const maxParagraphChars = 1000;
        const trimmedParagraph = paragraph.length > maxParagraphChars
          ? paragraph.slice(0, maxParagraphChars).trim()
          : paragraph;
        if (trimmedParagraph) {
          // Guard: sometimes the LLM returns the raw FEN or board text instead of
          // the requested analysis paragraph. Detect and ignore those so the
          // overlay shows analysis (or engine fallback) rather than the board.
          const looksLikeFullFen = /[prnbqkPRNBQK1-8\/]+\s+[wb]\s+(?:-|[KQkq]{1,4})\s+(?:-|[a-h][36])\s+\d+\s+\d+/.test(trimmedParagraph);
          const looksLikeBoardOnly = /^[prnbqkPRNBQK1-8]+(?:\/[prnbqkPRNBQK1-8]+){7}$/.test(trimmedParagraph);
          if (!looksLikeFullFen && !looksLikeBoardOnly) {
            finalSayThis.push(trimmedParagraph);
          } else {
            log.debug({ trimmedParagraph }, '[LiveAssist] Discarding paragraph that looks like FEN/board-only');
          }
        }

        // Add a compact engine snippet (best move + eval/top line) when available.
        const engineCompact = (() => {
          const raw = chessContext?.engineSummary || '';
          if (!raw) return '';
          const lines = raw
            .split('\n')
            .map((l) => this.sanitizeInsightText(l))
            .filter(Boolean);

          const pick = (prefix: string): string =>
            lines.find((l) => l.toLowerCase().startsWith(prefix)) || '';

          const best = pick('best move') || pick('best');
          const evalLine = pick('eval') || pick('mate');
          const top = pick('top lines') || pick('top');
          const parts = [best, evalLine, top].filter(Boolean);
          const combined = (parts.length > 0 ? parts.join(' | ') : lines.slice(0, 2).join(' | ')).trim();
          return combined.length > 220 ? combined.slice(0, 220).trim() : combined;
        })();
        if (engineCompact) {
          finalSayThis.push(`Engine: ${engineCompact}`);
        }

        // Keep the drill short and clearly labeled.
        const drill =
          contextAdjusted.askThis.map((item) => this.sanitizeInsightText(item)).find(Boolean) ||
          '';
        if (drill) {
          const maxDrillChars = 160;
          const trimmedDrill = drill.length > maxDrillChars ? drill.slice(0, maxDrillChars).trim() : drill;
          finalAskThis.push(/^drill:/i.test(trimmedDrill) ? trimmedDrill : `Drill: ${trimmedDrill}`);
        }
      }

      // Do not emit empty updates (prevents flicker/brief clears).
      if (finalSayThis.length === 0 && finalAskThis.length === 0) {
        return;
      }

      // Keep a tip on-screen long enough before replacing with a new one.
      const nowMs = Date.now();
      const nextTipNormalized = finalSayThis[0]?.toLowerCase().trim() || null;
      const isSameTip = !!nextTipNormalized && nextTipNormalized === this.currentVisibleTip;
      const nextInstructionSignature = this.getInstructionSignature(finalSayThis, finalAskThis);
      const isSameInstruction = !!nextInstructionSignature && nextInstructionSignature === this.lastInstructionSignature;
      const withinReplaceCooldown = this.roundTipVisible && (nowMs - this.lastTipShownAt) < TIP_REPLACE_COOLDOWN_MS;
      if (isSameTip || isSameInstruction) {
        log.debug('Skipping identical tip refresh');
        return;
      }
      if (withinReplaceCooldown && !isSameTip && !isSameInstruction) {
        log.debug({ nextTip: finalSayThis[0] }, 'Skipping tip replacement during cooldown');
        return;
      }

      const shouldClearExisting = true;

      // Track these to avoid repetition
      finalSayThis.forEach(item => this.previousSayThis.add(item.toLowerCase()));
      finalAskThis.forEach(item => this.previousAskThis.add(item.toLowerCase()));

      // Keep previous sets manageable (last 20 each)
      if (this.previousSayThis.size > 20) {
        const arr = Array.from(this.previousSayThis);
        this.previousSayThis = new Set(arr.slice(-20));
      }
      if (this.previousAskThis.size > 20) {
        const arr = Array.from(this.previousAskThis);
        this.previousAskThis = new Set(arr.slice(-20));
      }

      if (finalSayThis.length > 0 || finalAskThis.length > 0 || shouldClearExisting) {
        log.info({ sayCount: finalSayThis.length, askCount: finalAskThis.length, clearExisting: shouldClearExisting }, 'Generated new live insights');
        if (this.activeGameId === 'chess' && chessSignature) {
          this.lastChessSignature = chessSignature;
          this.lastChessBoard = chessContext?.board || chessSignature;
          this.lastChessTurn = chessContext?.turn || this.lastChessTurn;
          this.pendingChessSignature = null;
          this.pendingChessSignatureCount = 0;
          // Emit confirmed FEN so the overlay can render the board for verification
          this.emit('fen', {
            fen: chessContext?.fen || `${chessSignature} ${this.lastChessTurn || 'w'} - - 0 1`,
            board: this.lastChessBoard,
            turn: this.lastChessTurn,
          });
        }
        this.emit('insights', {
          insights: { say_this: finalSayThis, ask_this: finalAskThis },
          processedAt: Date.now(),
          clearExisting: shouldClearExisting,
        });
        this.roundTipVisible = finalSayThis.length > 0;
        this.roundTipAutoClearAt = this.roundTipVisible ? Date.now() + TIP_VISIBLE_MS : null;
        this.currentVisibleTip = finalSayThis[0]?.toLowerCase().trim() || null;
        this.lastInstructionSignature = nextInstructionSignature || null;
        this.lastTipShownAt = Date.now();
        this.pendingRoundEndAt = null;
      }
    } catch (error) {
      // Fallback: if LLM timed out, still emit engine-only tip for chess
      if (this.activeGameId === 'chess' && chessContext?.engineSummary) {
        const engineFallback = `Engine: ${this.sanitizeInsightText(chessContext.engineSummary).slice(0, 320)}`;
        this.emit('insights', {
          insights: { say_this: [engineFallback], ask_this: [] },
          processedAt: Date.now(),
          clearExisting: true,
        });
        log.warn({ error }, 'LLM failed; emitted chess engine fallback');
      } else {
        log.error({ error }, 'Error processing transcript for live assist');
      }
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
    this.lastChessSignature = null;
    this.lastChessBoard = null;
    this.lastChessTurn = null;
    this.pendingChessSignature = null;
    this.pendingChessSignatureCount = 0;
    this.isProcessing = false;
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
