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
import { getChessScreenshotService } from './chess-screenshot.service';
import type { LiveInsights } from '../../shared/types/live-assist.types';
import type { ProbingQuestion } from '../../shared/types/meeting-setup.types';
import { fenDiffToSan, getTerminalState, parseBoardOnlyFen } from '../lib/chess-notation';
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
Format: {"say_this":"<2 sentences>","ask_this":"<one short calculation drill>"}
Output rules (apply regardless of personality):
- The context specifies the player's color and whose turn it is. Follow those instructions exactly.
- When it is the PLAYER's turn: explain the engine's best move for the player with concrete board-specific reasoning — name the immediate idea and then explain the follow-up benefit or threat it creates.
- When it is the OPPONENT's turn: explain what the opponent's best move threatens or achieves, then tell the player what they should watch out for or prepare.
- Use the required move exactly as given. Do NOT invent a different move.
- The context may include a "Moving piece:" line that tells you which piece is on the from-square. Use it exactly — do NOT contradict it.
- Only mention a piece being on a specific square if that square is confirmed by the FEN or the "Moving piece:" line. Never hallucinate piece locations.
- Mention at least two concrete chess details across your two sentences: piece, square, file, diagonal, pawn break, threat, capture, king-safety issue, or development gain.
- Write exactly two complete sentences — never cut a sentence short and never write only one sentence.
- Do NOT use "..." chess move notation (e.g. "...e5"). Write "Black plays e5" or "Black's e5" instead.
- Keep say_this between 40 and 60 words — two complete, concrete sentences. Never truncate a sentence.
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

// ─── Position history for robust opening detection ────────────────────────────
//
// FEN extraction can hallucinate a plausible-but-wrong board position for one
// or two frames before snapping back to the true position.  To avoid poisoning
// the opening sequence with these transients we maintain a small rolling buffer
// of recently confirmed positions and only "commit" an entry once it has
// survived a short stability window (POSITION_STABILITY_FRAMES consecutive
// identical positions) OR been corroborated by the following confirmed entry.
//
// State machine per entry:
//   provisional → confirmed  (survived stability window)
//   provisional → reverted   (contradicted by a return to a prior board)
//
// Only "confirmed" entries are used for opening detection.

const POSITION_STABILITY_FRAMES = 3;   // consecutive identical confirmations before committing
const OPENING_HISTORY_MAX_PLIES = 12;  // how many early plies to keep for opening ID
// If a board appears even once in the provisional buffer at a non-head position
// (i.e. it is not being consecutively reinforced), it is oscillating — discard
// the entire provisional buffer.  Set to 1 so Ra1→Rb1→Ra1 bounces are caught
// on the second Ra1 appearance.
const OSCILLATION_REPEAT_LIMIT = 1;
// How many canonical entries to walk back when searching for a rebase anchor.
// A hallucination typically lasts 1-2 frames, so 3 is ample and cheap.
const CANONICAL_LOOKBACK_DEPTH = 3;

interface PositionEntry {
  /** Full FEN string (board + turn + castling + …). */
  fen: string;
  /** Board part only (before the first space), for quick comparison. */
  board: string;
  /** How many consecutive confirmations this board has received so far. */
  frameCount: number;
  /** Whether this entry has been committed to the stable history. */
  status: 'provisional' | 'confirmed' | 'reverted';
  /** SAN of the move that led to this position, if determinable. */
  san?: string;
}

interface VisualIndexChunk {
  text: string;
  timestamp: number;
}

interface ChessContextData {
  fen: string;
  engineSummary: string;
  engineSan?: string;        // best move SAN directly from the engine response
  engineLan?: string;        // best move LAN (UCI) e.g. "g8f6" — used for arrow drawing
  /** Source square of the best move, e.g. "b7". From chess-api.com directly. */
  engineFrom?: string;
  /** Destination square of the best move, e.g. "b8". From chess-api.com directly. */
  engineTo?: string;
  engineEval?: number;       // centipawn eval (as float, e.g. -11.62) from the engine response
  engineMate?: number | null; // mate-in-N (null if no forced mate)
  /** Win chance for White (0–100) AFTER this move was played. */
  winChance?: number;
  /** Win chance for White (0–100) from the PREVIOUS position (before this move). */
  winChanceBefore?: number;
  /** Centipawn loss of the move that was played (|evalBefore − evalAfter| × 100). */
  centipawnLoss?: number;
  playedMoveSan?: string;
  playedMoveUci?: string;
  board?: string;
  turn?: 'w' | 'b';
  /**
   * Set when the position is terminal (no legal moves for the side to move).
   * 'checkmate' — side to move is in check with no escape.
   * 'stalemate' — side to move has no legal move but is not in check.
   * Undefined / absent for normal positions.
   */
  terminalState?: 'checkmate' | 'stalemate';
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
  // Separate tracker for move history FEN diff — updated in injectConfirmedFen
  // independently of lastChessSignature to avoid breaking the coaching skip check.
  private lastFenForMoveHistory: string | null = null;
  /** Count of confirmed board-position changes (plies) in the current session. */
  private totalMoveCount = 0;
  /**
   * Canonical per-ply move history — committed entries only.  A board is only
   * moved here once the *following* board has confirmed it was real (two-stage
   * provisional model).  The snapshot sent to the renderer is built from this
   * list, giving a one-ply display lag that eliminates phantom moves.
   */
  private canonicalMoveHistory: Array<{ board: string; fen?: string; san?: string; turn?: 'w' | 'b' }> = [];
  /**
   * Provisional buffer — holds the most-recently-seen board before it has been
   * validated by a subsequent board.  Every new board lands here first; it is
   * moved to canonicalMoveHistory only when the next board confirms it is real.
   * If the next board cannot connect from this entry (e.g. it connects from the
   * previous committed tail instead), this entry is silently discarded.
   *
   * `suspect` is set to true when this entry was placed by REPLACE after a
   * same-color CONFIRM was blocked (i.e. the board was the second consecutive
   * move by the same side).  A suspect pending must also pass an extra
   * opponentCountsOK check against committedTail before it can be committed.
   */
  private pendingCanonicalEntry: { board: string; fen?: string; san?: string; turn?: 'w' | 'b'; suspect?: boolean } | null = null;
  /**
   * Previous pending entry — saved when REPLACE fires so that the following
   * board can check if it connects through the replaced (possibly real) entry.
   * Example: real move P was in pending, hallucination H came in (REPLACE fired,
   * P dropped, H is now pending).  Next real board B connects P→B but not H→B.
   * We recover P by checking prevPending→B.  P gets committed, H is discarded.
   */
  private prevPendingCanonicalEntry: { board: string; fen?: string; san?: string; turn?: 'w' | 'b'; suspect?: boolean } | null = null;
  /** The first board FEN confirmed during the current session — used for opening detection. */
  private firstSeenFen: string | null = null;
  /**
   * Rolling buffer of recent board positions used to build a stable early-move
   * sequence for opening detection.  Entries are provisional until they survive
   * POSITION_STABILITY_FRAMES confirmations; hallucinated frames that revert are
   * marked "reverted" and excluded from the committed history.
   */
  private positionBuffer: PositionEntry[] = [];
  /**
   * Committed early-position history: only entries that reached "confirmed"
   * status.  Capped at OPENING_HISTORY_MAX_PLIES entries (enough to cover any
   * standard opening).
   */
  private committedPositionHistory: PositionEntry[] = [];
  private lastChessTurn: 'w' | 'b' | null = null;
  private lastChessPerspective: 'white' | 'black' = 'white';
  // Last engine result — carried on every fen event so the widget always has the current move/eval.
  private lastEngineSan: string | undefined = undefined;
  private lastEngineLan: string | undefined = undefined;
  private lastEngineFrom: string | undefined = undefined;
  private lastEngineTo: string | undefined = undefined;
  private lastEngineEval: number | undefined = undefined;
  private lastEngineMate: number | null | undefined = undefined;
  /** Engine eval of the PREVIOUS position — used to compute centipawn loss per move. */
  private lastPositionEval: number | undefined = undefined;
  /** winChance from the PREVIOUS engine call — stored for next-move centipawn-loss calc. */
  private lastPositionWinChance: number | undefined = undefined;
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
  /** Set to true by flipTurn() so the next processTranscriptInner run does not
   *  overwrite lastChessTurn from chessContext — preserving the user override. */
  private userFlippedTurn = false;

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

  /**
   * Count every piece type on the board and return a map of piece char → count.
   * e.g. { P: 5, N: 2, B: 1, R: 2, Q: 1, K: 1, p: 7, n: 1, b: 2, r: 2, q: 1, k: 1 }
   */
  private pieceCounts(board: string): Map<string, number> {
    const counts = new Map<string, number>();
    for (const ch of board) {
      if (/[prnbqkPRNBQK]/.test(ch)) {
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
      }
    }
    return counts;
  }

  /**
   * Validate that a candidate board is physically plausible given the last
   * confirmed board. Catches pawn↔bishop and knight↔rook LLM hallucinations
   * while correctly allowing all legal chess moves including promotions.
   *
   * PROMOTION HANDLING — all cases are tolerated by the +1 threshold:
   *
   *   pawn → queen:   P−1, Q+1  → P+B decreases 1, N+R unchanged    ✓
   *   pawn → bishop:  P−1, B+1  → P+B unchanged (net 0)              ✓
   *   pawn → knight:  P−1, N+1  → P+B decreases 1, N+R increases 1  ✓
   *   pawn → rook:    P−1, R+1  → P+B decreases 1, N+R increases 1  ✓
   *   + capture:      opponent piece −1  → only decreases sums        ✓
   *
   * In every promotion case the P+B and N+R sums for the promoting side change
   * by at most +1, which is exactly the tolerance built into the checks below.
   * A hallucination where a pawn is misread as a bishop increases the sum by 2
   * (real bishop +1 from promotion + hallucinated bishop +1 from misread pawn),
   * which correctly exceeds the threshold and is rejected.
   *
   * Returns true (plausible) or false (reject — wait for the next frame).
   * Always returns true when prevBoard is null (cold start, no baseline).
   */
  private isBoardPlausible(prevBoard: string | null, candidateBoard: string): boolean {
    if (!prevBoard) return true; // cold start — no baseline to compare against

    const prev = this.pieceCounts(prevBoard);
    const cand = this.pieceCounts(candidateBoard);

    const get = (m: Map<string, number>, k: string) => m.get(k) ?? 0;

    // --- Pawn+Bishop stability check (most common LLM confusion pair) ---
    // The combined P+B sum per side can legitimately increase by at most 1
    // (pawn promotes to bishop: P−1 B+1 = net 0 normally, but with a
    // simultaneous capture of an opponent pawn/bishop it could be −1 for
    // opponent). We allow +1 to cover the promotion-to-bishop case. Any
    // increase of +2 or more is a hallucination (pawn misread as bishop on
    // top of a real change).
    const whitePB_prev = get(prev, 'P') + get(prev, 'B');
    const whitePB_cand = get(cand, 'P') + get(cand, 'B');
    const blackPB_prev = get(prev, 'p') + get(prev, 'b');
    const blackPB_cand = get(cand, 'p') + get(cand, 'b');

    if (whitePB_cand > whitePB_prev + 1) {
      log.warn(
        { prevWhitePB: whitePB_prev, candWhitePB: whitePB_cand, prevBoard: prevBoard.slice(0, 30), candidateBoard: candidateBoard.slice(0, 30) },
        '[LiveAssist] isBoardPlausible: white P+B count increased by >1 — likely pawn↔bishop hallucination, rejecting'
      );
      return false;
    }
    if (blackPB_cand > blackPB_prev + 1) {
      log.warn(
        { prevBlackPB: blackPB_prev, candBlackPB: blackPB_cand },
        '[LiveAssist] isBoardPlausible: black p+b count increased by >1 — likely pawn↔bishop hallucination, rejecting'
      );
      return false;
    }

    // --- Knight+Rook stability check (another common confusion pair) ---
    // Same +1 tolerance: pawn→knight and pawn→rook promotions each increase
    // the N+R sum by exactly 1, which is allowed. +2 is a hallucination.
    const whiteNR_prev = get(prev, 'N') + get(prev, 'R');
    const whiteNR_cand = get(cand, 'N') + get(cand, 'R');
    const blackNR_prev = get(prev, 'n') + get(prev, 'r');
    const blackNR_cand = get(cand, 'n') + get(cand, 'r');

    if (whiteNR_cand > whiteNR_prev + 1) {
      log.warn(
        { prevWhiteNR: whiteNR_prev, candWhiteNR: whiteNR_cand },
        '[LiveAssist] isBoardPlausible: white N+R count increased by >1 — likely knight↔rook hallucination, rejecting'
      );
      return false;
    }
    if (blackNR_cand > blackNR_prev + 1) {
      log.warn(
        { prevBlackNR: blackNR_prev, candBlackNR: blackNR_cand },
        '[LiveAssist] isBoardPlausible: black n+r count increased by >1 — likely knight↔rook hallucination, rejecting'
      );
      return false;
    }

    // --- Total piece count sanity ---
    // A single move removes at most 1 piece (capture) and adds 0 (promotions
    // replace a pawn with another piece — net change is −1 for a capturing
    // promotion, 0 otherwise). We allow +2 to tolerate multi-move skips
    // (e.g. capture lag), but +3 or more is always a hallucination.
    const prevTotal = [...prev.values()].reduce((a, b) => a + b, 0);
    const candTotal = [...cand.values()].reduce((a, b) => a + b, 0);
    if (candTotal > prevTotal + 2) {
      log.warn(
        { prevTotal, candTotal },
        '[LiveAssist] isBoardPlausible: total piece count jumped up — rejecting implausible board'
      );
      return false;
    }

    return true;
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

    // The LLM outputs NO_BOARD when no main chess board is visible (e.g. the
    // chess tab is not in focus and only the overlay mini-board is on screen).
    // Treat this as a clean miss — return null so the pipeline skips this frame
    // rather than hallucinating a position from the overlay's rendered board.
    const rawBoardContent = rawBoardMatches[rawBoardMatches.length - 1]?.[1]?.trim() || '';
    if (rawBoardContent.toUpperCase() === 'NO_BOARD') {
      log.debug('[LiveAssist] extractFenFromTaggedChessOutput: LLM reported NO_BOARD — no main chess board visible, skipping frame');
      return null;
    }

    const perspectiveRaw = perspectiveMatch?.[1]?.toLowerCase() || '';
    const perspective: 'white' | 'black' = perspectiveRaw.includes('black') ? 'black' : 'white';
    if (!perspectiveMatch) {
      log.warn('[LiveAssist] extractFenFromTaggedChessOutput: <perspective> tag missing — defaulting to white. Board may be silently flipped if player is Black.');
    }
    const rawBoard = rawBoardContent.replace(/\s+/g, '');
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
   * Validate that an algebraic from/to pair is consistent with the current FEN.
   *
   * A valid pair must satisfy ALL of the following:
   *   1. Both squares parse as legal algebraic coordinates ([a-h][1-8]).
   *   2. Exactly one of the two squares is empty in the FEN (the origin) and
   *      the other has a piece (the destination). If both have pieces or both
   *      are empty the LLM picked the wrong pair.
   *
   * Returns true when the pair is usable, false otherwise.
   */
  private validateAlgebraicMovePair(from: string, to: string, fenBoard: string): boolean {
    const algebraicToIndices = (sq: string): { rankIdx: number; fileIdx: number } | null => {
      if (!sq || sq.length < 2) return null;
      const fileIdx = sq.charCodeAt(0) - 97;
      const rankIdx = 8 - parseInt(sq[1], 10);
      if (fileIdx < 0 || fileIdx > 7 || rankIdx < 0 || rankIdx > 7) return null;
      return { rankIdx, fileIdx };
    };

    const getPiece = (rankIdx: number, fileIdx: number): string | null => {
      const ranks = fenBoard.split('/');
      if (ranks.length !== 8) return null;
      const rank = ranks[rankIdx];
      if (!rank) return null;
      let col = 0;
      for (const ch of rank) {
        if (/\d/.test(ch)) {
          const skip = parseInt(ch, 10);
          if (fileIdx < col + skip) return '';
          col += skip;
        } else {
          if (col === fileIdx) return ch;
          col++;
        }
        if (col > fileIdx) break;
      }
      return '';
    };

    const fromIdx = algebraicToIndices(from);
    const toIdx   = algebraicToIndices(to);
    if (!fromIdx || !toIdx) return false;

    const fromPiece = getPiece(fromIdx.rankIdx, fromIdx.fileIdx);
    const toPiece   = getPiece(toIdx.rankIdx,   toIdx.fileIdx);
    if (fromPiece === null || toPiece === null) return false;

    // Exactly one must be empty (origin) and the other must have a piece (destination).
    const oneEmpty = (fromPiece === '' && toPiece !== '') || (fromPiece !== '' && toPiece === '');
    return oneEmpty;
  }

  /**
   * Derive whose turn it is next from the two highlighted squares reported by
   * the LLM as algebraic coordinates (e.g. "e2", "e4").
   *
   * Looks up the piece on the destination square in the current FEN:
   *   - Uppercase (White piece) → White just moved → Black to move ('b').
   *   - Lowercase (Black piece) → Black just moved → White to move ('w').
   *
   * Also accepts swapped FROM/TO labels for robustness.
   */
  private deriveTurnFromAlgebraicMove(
    fromSq: string,
    toSq: string,
    fenBoard: string,
  ): 'w' | 'b' | null {
    const algebraicToIndices = (sq: string): { rankIdx: number; fileIdx: number } | null => {
      if (!sq || sq.length < 2) return null;
      const fileIdx = sq.charCodeAt(0) - 97; // 'a'=0 … 'h'=7
      const rankIdx = 8 - parseInt(sq[1], 10); // '1'→7, '8'→0
      if (fileIdx < 0 || fileIdx > 7 || rankIdx < 0 || rankIdx > 7) return null;
      return { rankIdx, fileIdx };
    };

    const getPiece = (rankIdx: number, fileIdx: number): string | null => {
      const ranks = fenBoard.split('/');
      if (ranks.length !== 8) return null;
      const rank = ranks[rankIdx];
      if (!rank) return null;
      let col = 0;
      for (const ch of rank) {
        if (/\d/.test(ch)) {
          const skip = parseInt(ch, 10);
          if (fileIdx < col + skip) return '';
          col += skip;
        } else {
          if (col === fileIdx) return ch;
          col++;
        }
        if (col > fileIdx) break;
      }
      return '';
    };

    const fromIdx = algebraicToIndices(fromSq);
    const toIdx   = algebraicToIndices(toSq);
    if (!fromIdx || !toIdx) return null;

    const fromPiece = getPiece(fromIdx.rankIdx, fromIdx.fileIdx);
    const toPiece   = getPiece(toIdx.rankIdx,   toIdx.fileIdx);
    if (fromPiece === null || toPiece === null) return null;

    let actualToPiece: string;
    if (toPiece !== '' && fromPiece === '') {
      actualToPiece = toPiece;   // LLM labelled correctly
    } else if (fromPiece !== '' && toPiece === '') {
      actualToPiece = fromPiece; // LLM swapped FROM/TO — use the non-empty one
    } else {
      log.debug({ fromPiece, toPiece, fromSq, toSq }, '[TurnDetect] deriveTurnFromAlgebraicMove: ambiguous squares, falling through');
      return null;
    }

    if (/[A-Z]/.test(actualToPiece)) return 'b';
    if (/[a-z]/.test(actualToPiece)) return 'w';
    return null;
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
  /**
   * Determine whose turn it is next by trying both sides with fenDiffToSan.
   *
   * fenDiffToSan already handles all move types correctly (quiet moves, captures,
   * en passant, castling, promotion).  We call it with each side as the mover:
   *   - If White-as-mover produces a valid SAN → White just moved → Black to move ('b')
   *   - If Black-as-mover produces a valid SAN → Black just moved → White to move ('w')
   *
   * This is deterministic and does not depend on lastKnownTurn for the common case.
   * Returns null when the diff is ambiguous (both or neither side produces a SAN),
   * so the caller can fall through to the LLM-reported turn rather than blind-flipping.
   * Blind-flipping is wrong when multiple moves were missed (e.g. fast play that
   * outpaces the screenshot vote window) — every extra skipped move inverts the
   * expected parity, so the flip produces the wrong side.
   */
  private inferTurnFromBoards(
    prevBoard: string | null,
    currBoard: string,
    lastKnownTurn: 'w' | 'b' | null
  ): 'w' | 'b' | null {
    if (!prevBoard || prevBoard === currBoard) {
      // Board unchanged — no new information; preserve whatever is already known.
      return lastKnownTurn;
    }

    // Build minimal synthetic FENs (turn field doesn't matter for fenDiffToSan
    // since it only reads the board parts, but castling/ep are irrelevant here too)
    const prevFen = `${prevBoard} w - - 0 1`;
    const currFen = `${currBoard} b - - 0 1`;

    const whiteMoved = fenDiffToSan(prevFen, currFen, 'w');
    const blackMoved = fenDiffToSan(prevFen, currFen, 'b');

    if (whiteMoved && !blackMoved) {
      log.debug({ san: whiteMoved }, '[TurnDetect] fenDiff: White moved → Black to move');
      return 'b';
    }
    if (blackMoved && !whiteMoved) {
      log.debug({ san: blackMoved }, '[TurnDetect] fenDiff: Black moved → White to move');
      return 'w';
    }

    // Ambiguous (both sides produced a SAN — OCR noise / multi-move skip) or
    // neither side produced a SAN (boards differ by more than one legal move).
    // Return null so the caller can fall through to the LLM-reported turn tag
    // instead of blindly flipping — a blind flip is wrong whenever an even
    // number of moves were missed between frames.
    log.debug(
      { whiteMoved, blackMoved, lastKnownTurn },
      '[TurnDetect] fenDiff ambiguous — returning null, caller will use LLM turn tag'
    );
    return null;
  }

  private resetChessSessionState(): void {
    this.lastChessSignature = null;
    this.lastChessBoard = null;
    this.lastChessTurn = null;
    this.lastChessPerspective = 'white';
    this.lastFenForMoveHistory = null;
    this.userFlippedTurn = false;
    // NOTE: totalMoveCount is intentionally NOT reset here — it is reset in
    // start() so that stop() → copilot reads the count before a new session zeros it.
    this.lastEngineSan = undefined;
    this.lastEngineLan = undefined;
    this.lastEngineFrom = undefined;
    this.lastEngineTo = undefined;
    this.lastEngineEval = undefined;
    this.lastEngineMate = undefined;
    this.lastPositionEval = undefined;
    this.lastPositionWinChance = undefined;
    this.pendingChessSignature = null;
    this.pendingChessSignatureCount = 0;
    this.castlingRights = {
      whiteKingside: false,
      whiteQueenside: false,
      blackKingside: false,
      blackQueenside: false,
    };
    this.hasSeenInitialChessPosition = false;
    // NOTE: firstSeenFen, positionBuffer, committedPositionHistory,
    // canonicalMoveHistory, and pendingCanonicalEntry are NOT reset here —
    // they are reset in start() alongside totalMoveCount so that stop() →
    // copilot can still read the opening history before a new session wipes it.
  }

  /** Returns the total number of confirmed distinct board positions seen this session (= plies played). */
  getTotalMoveCount(): number {
    // Each increment of totalMoveCount represents one real move (board-position change).
    // The initial board is handled by the early-return path and does not increment this counter.
    return this.totalMoveCount;
  }

  /**
   * Update the canonical move history with a newly confirmed board position.
   *
   * Four cases, evaluated in order:
   *
   *  NO-OP    — board matches the current tail → nothing to do.
   *
   *  REVERT   — board matches an earlier entry (hallucinated branch reverted
   *             back to a known-good position) → truncate everything after
   *             that matching entry.
   *
   *  REBASE   — board is genuinely new BUT cannot be connected by a single
   *             legal move from the current tail, yet CAN be connected from
   *             one of the last CANONICAL_LOOKBACK_DEPTH entries.
   *             This is the "late-correction" case: the detector showed a
   *             hallucinated board H, then the player made the real move and
   *             the board snapped to the correct position C.  C is reachable
   *             from a prior canonical entry but not from H.
   *             → prune back to the connectable entry, resolve SAN, append C.
   *
   *  EXTEND   — board is genuinely new and either connects legally from the
   *             current tail, or no prior entry connects either (we keep it
   *             and let SAN be undefined rather than drop the position).
   *
   * Returns { history, resolvedSan } so the caller can use the rebase-resolved
   * SAN instead of the one it computed against the wrong (hallucinated) baseline.
   */
  /**
   * Two-stage provisional move history update.
   *
   * Every confirmed board first lands in `pendingCanonicalEntry`.  It is only
   * committed to `canonicalMoveHistory` (and therefore to the visible snapshot)
   * when the *next* board validates it.  This gives a one-ply display lag that
   * eliminates phantom moves: a hallucinated board can never appear in the table
   * because it is discarded the moment the following real board cannot connect
   * from it.
   *
   * Resolution when board N+1 arrives against pending board N:
   *
   *  NO-OP    — same board as pending (repeated confirmation) → do nothing.
   *
   *  REVERT   — board N+1 matches an earlier committed entry → discard pending,
   *             prune committed history back to that entry.
   *
   *  CONFIRM  — board N+1 connects legally from pending (single clean ply) →
   *             commit pending, make N+1 the new pending.
   *
   *  PREVRECOVER — board N+1 cannot connect from pending, but CAN connect from
   *             prevPending (the pending BEFORE the current one was set).
   *             This recovers the pattern: real_move → hallucination → real_move.
   *             prevPending is committed, current pending (hallucination) is dropped.
   *
   *  REPLACE  — board N+1 connects from a committed entry (not pending) →
   *             pending was a hallucination; discard, make N+1 the new pending.
   *
   *  DISCARD  — no connection found; drop pending, N+1 becomes new pending.
   *
   * Returns the snapshot-ready committed history and the resolved SAN/turn of
   * whatever was just committed (if anything), so the caller can forward them
   * on the fen event.
   */
  private updateCanonicalHistory(
    board: string,
    fen?: string,
  ): { history: Array<{ board: string; fen?: string; san?: string; turn?: 'w' | 'b' }>; resolvedSan?: string; resolvedTurn?: 'w' | 'b' } {
    const committed  = this.canonicalMoveHistory;
    const pending    = this.pendingCanonicalEntry;
    const prevPending = this.prevPendingCanonicalEntry;

    // ── NO-OP ────────────────────────────────────────────────────────────────
    if (pending && pending.board === board) {
      return { history: committed };
    }

    // ── REVERT ───────────────────────────────────────────────────────────────
    let revertIdx = -1;
    for (let i = committed.length - 1; i >= 0; i--) {
      if (committed[i].board === board) { revertIdx = i; break; }
    }
    if (revertIdx !== -1) {
      this.canonicalMoveHistory = committed.slice(0, revertIdx + 1);
      this.pendingCanonicalEntry = null;
      this.prevPendingCanonicalEntry = null;
      log.debug(
        { board: board.slice(0, 24), revertIdx, droppedPending: !!pending },
        '[CanonicalHistory] Reverted to earlier committed position'
      );
      return { history: this.canonicalMoveHistory };
    }

    const committedTail = committed[committed.length - 1] ?? null;

    // ── CONFIRM ──────────────────────────────────────────────────────────────
    const fromPending = pending ? this.tryInferSanForHistory(pending.board, board) : null;
    if (fromPending) {
      // If the pending entry was marked suspect (set when a same-color consecutive
      // move was inferred from CONFIRM — indicating the new pending board may have
      // wrong piece positions), require TWO extra checks before committing it:
      //
      //  A. The non-moving side in `board` must be consistent with committedTail
      //     (opponentCountsOK).  Catches the original two-hallucination chain.
      //
      //  B. The confirming `board` must NOT be the same board as committedTail.
      //     The rook-bounce pattern is: real_board → HALL_rook_moved → real_board.
      //     The second real_board equals committedTail, so the "confirming" step
      //     is actually a revert/re-read disguised as a new move.  Rejecting when
      //     board === committedTail.board catches all such bounces without needing
      //     to inspect piece positions.
      const suspectOK = !pending!.suspect || !committedTail
        || (board !== committedTail.board
            && this.opponentCountsOK(committedTail.board, board, fromPending.turn));
      if (suspectOK) {
        committed.push(pending!);
        log.debug(
          { committed: pending!.board.slice(0, 24), san: pending!.san, newPending: board.slice(0, 24) },
          '[CanonicalHistory] Confirmed — committed pending entry'
        );
        // Mark the new pending as suspect if BOTH the pending move and the new ply
        // are the same color — this happens when a black frame was skipped and white
        // moved again, OR when a hallucination is masquerading as a white move.
        // The next CONFIRM will apply the committedTail guard to catch the latter.
        const newSuspect = !!pending!.turn && fromPending.turn === pending!.turn;
        const newEntry = { board, fen, san: fromPending.san, turn: fromPending.turn, suspect: newSuspect || undefined };
        this.prevPendingCanonicalEntry = null;
        this.pendingCanonicalEntry = newEntry;
        return { history: committed, resolvedSan: pending!.san, resolvedTurn: pending!.turn };
      }
      log.debug(
        { suspect: pending!.board.slice(0, 24), san: pending!.san },
        '[CanonicalHistory] Suspect pending failed committedTail check — routing to REPLACE'
      );
      // Suspect pending failed: fall through to REPLACE/DISCARD with committedTail as anchor.
      // Propagate the suspect flag so any board placed by DISCARD below is also treated
      // as suspect on its first CONFIRM attempt.
    }

    // PREVRECOVER: real_move → hallucination → real_move pattern.
    // prevPending is only set when the previous pending was DISCARDED/REPLACED
    // (not committed), so checking it here is safe — it won't double-commit.
    const fromPrevPending = (prevPending && prevPending.board !== pending?.board)
      ? this.tryInferSanForHistory(prevPending.board, board)
      : null;
    if (fromPrevPending) {
      // ── PREVRECOVER ──────────────────────────────────────────────────────
      committed.push(prevPending!);
      log.debug(
        {
          recovered: prevPending!.board.slice(0, 24),
          san: prevPending!.san,
          droppedHallucination: pending?.board.slice(0, 24),
          newPending: board.slice(0, 24),
        },
        '[CanonicalHistory] PrevRecover — committed prev-pending, discarded hallucination'
      );
      const newEntry = { board, fen, san: fromPrevPending.san, turn: fromPrevPending.turn };
      this.prevPendingCanonicalEntry = null;
      this.pendingCanonicalEntry = newEntry;
      return { history: committed, resolvedSan: prevPending!.san, resolvedTurn: prevPending!.turn };
    }

    // Try connecting from committed entries
    const fromCommittedTail = committedTail
      ? this.tryInferSanForHistory(committedTail.board, board)
      : null;

    let fromLookback: { san: string; turn: 'w' | 'b' } | null = null;
    let lookbackIdx = -1;
    if (!fromCommittedTail && committed.length >= 2) {
      const depth = Math.min(CANONICAL_LOOKBACK_DEPTH, committed.length - 1);
      for (let i = committed.length - 2; i >= committed.length - 1 - depth; i--) {
        const r = this.tryInferSanForHistory(committed[i].board, board);
        if (r) { fromLookback = r; lookbackIdx = i; break; }
      }
    }

    // Empty-history fallback
    const fromStart = (!pending && !committedTail && board !== INITIAL_CHESS_BOARD)
      ? this.tryInferSanForHistory(INITIAL_CHESS_BOARD, board)
      : null;

    const connectsToCommitted = fromCommittedTail ?? fromLookback ?? fromStart;

    if (connectsToCommitted) {
      // ── REPLACE ──────────────────────────────────────────────────────────
      if (lookbackIdx !== -1) {
        this.canonicalMoveHistory = committed.slice(0, lookbackIdx + 1);
        log.debug(
          { lookbackIdx, prunedEntries: committed.length - lookbackIdx - 1 },
          '[CanonicalHistory] Replace+prune via lookback'
        );
      } else {
        log.debug(
          { droppedPending: pending?.board.slice(0, 24) },
          '[CanonicalHistory] Replaced hallucinated pending entry'
        );
      }
      // Mark this pending as suspect if this board's turn matches the committed tail's turn
      // (same-color consecutive move from the committed anchor).
      const suspect = !!committedTail?.turn && connectsToCommitted.turn === committedTail.turn;
      const newEntry = { board, fen, san: connectsToCommitted.san, turn: connectsToCommitted.turn, suspect: suspect || undefined };
      this.prevPendingCanonicalEntry = pending;
      this.pendingCanonicalEntry = newEntry;
      return { history: this.canonicalMoveHistory };
    }

    // ── DISCARD ───────────────────────────────────────────────────────────────
    log.debug(
      { droppedPending: pending?.board.slice(0, 24), orphan: board.slice(0, 24) },
      '[CanonicalHistory] Discard — unconnected board replaces pending without committing it'
    );
    this.prevPendingCanonicalEntry = pending;
    // Propagate suspect flag: if the board that just failed a suspect check triggered
    // a DISCARD, mark the new pending as suspect too so the chain of hallucinated
    // boards cannot escape via DISCARD → CONFIRM.
    const discardSuspect = !!(pending?.suspect) || undefined;
    this.pendingCanonicalEntry = { board, fen, san: undefined, turn: undefined, suspect: discardSuspect };
    return { history: committed };
  }

  /**
   * Try to infer a single-ply SAN connecting `fromBoard` → `toBoard`.
   *
   * A valid single ply satisfies TWO conditions:
   *  1. Exactly one side's pieces moved (`fenDiffToSan` returns a SAN for that side).
   *  2. The result is UNAMBIGUOUS: the OTHER side must NOT also produce a SAN.
   *     If both sides produce a SAN, both moved simultaneously — that is 2 plies,
   *     not 1.
   *
   * Additionally, after finding a candidate side, verify the opponent's piece type
   * counts did not increase (no OCR-hallucinated pieces were added).
   *
   * Returns `{ san, turn }` for the uniquely-moving side, or null.
   */
  private tryInferSanForHistory(
    fromBoard: string,
    toBoard: string,
  ): { san: string; turn: 'w' | 'b' } | null {
    if (!fromBoard || !toBoard || fromBoard === toBoard) return null;

    const whiteSan = fenDiffToSan(`${fromBoard} w - - 0 1`, `${toBoard} w - - 0 1`, 'w');
    const blackSan = fenDiffToSan(`${fromBoard} b - - 0 1`, `${toBoard} b - - 0 1`, 'b');

    // Both sides produced a SAN → 2 plies, not 1 → ambiguous
    if (whiteSan && blackSan) return null;

    if (whiteSan && this.opponentCountsOK(fromBoard, toBoard, 'w')) return { san: whiteSan, turn: 'w' };
    if (blackSan && this.opponentCountsOK(fromBoard, toBoard, 'b')) return { san: blackSan, turn: 'b' };
    return null;
  }

  /**
   * Returns true when the opponent's piece layout is consistent with `side`
   * having made exactly one legal move (no opponent pieces were created or moved).
   *
   * Two conditions must hold:
   *  A. No opponent piece TYPE COUNT increased (no hallucinated pieces added).
   *  B. The opponent's total piece count did NOT decrease by more than 1 (no
   *     mass capture in one ply).
   *  C. If the total opponent count is UNCHANGED (no capture), then every
   *     individual opponent piece must be on the exact same square as before
   *     (no opponent movement).  This catches the 2-ply case where both white
   *     rook and black bishop moved — counts stay the same but positions change.
   */
  private opponentCountsOK(fromBoard: string, toBoard: string, side: 'w' | 'b'): boolean {
    const from = parseBoardOnlyFen(fromBoard);
    const to   = parseBoardOnlyFen(toBoard);
    const isOpp = (p: string) => side === 'w' ? p === p.toLowerCase() : p === p.toUpperCase();

    // Condition A: no opponent piece type count increased
    const fromCounts = new Map<string, number>();
    const toCounts   = new Map<string, number>();
    for (const [, p] of from) if (isOpp(p)) fromCounts.set(p, (fromCounts.get(p) ?? 0) + 1);
    for (const [, p] of to)   if (isOpp(p)) toCounts.set(p,   (toCounts.get(p)   ?? 0) + 1);
    for (const [p, toCount] of toCounts) {
      if (toCount > (fromCounts.get(p) ?? 0)) return false;
    }

    // Compute total opponent counts
    const fromTotal = [...fromCounts.values()].reduce((a, b) => a + b, 0);
    const toTotal   = [...toCounts.values()].reduce((a, b) => a + b, 0);

    // Condition B: at most 1 opponent piece captured
    if (fromTotal - toTotal > 1) return false;

    // Condition C: if no capture (same total), opponent positions must be identical
    if (fromTotal === toTotal) {
      for (const [sq, fp] of from) {
        if (!isOpp(fp)) continue;
        if (to.get(sq) !== fp) return false; // opponent piece changed or moved
      }
    }

    return true;
  }

  /**
   * Convert the flat per-ply canonical history into the paired-row format that
   * the renderer expects: { no, white?, black? }.
   *
   * Each full-move row pairs White's ply with the following Black ply.
   * The first ply in the session may be Black's (unusual but legal for mid-game
   * joins), in which case the first row will have only a black entry.
   */
  getCanonicalMoveHistorySnapshot(): Array<{ no: number; white?: string; black?: string }> {
    const rows: Array<{ no: number; white?: string; black?: string }> = [];
    for (const entry of this.canonicalMoveHistory) {
      if (!entry.san) continue; // skip initial board / positions with unknown SAN
      if (entry.turn === 'w') {
        rows.push({ no: rows.length + 1, white: entry.san });
      } else if (entry.turn === 'b') {
        const last = rows[rows.length - 1];
        if (last && last.white !== undefined && last.black === undefined) {
          last.black = entry.san;
        } else {
          rows.push({ no: rows.length + 1, black: entry.san });
        }
      } else {
        // turn unknown — best-effort: try to fill black slot if last row is open
        const last = rows[rows.length - 1];
        if (last && last.white !== undefined && last.black === undefined) {
          last.black = entry.san;
        } else {
          rows.push({ no: rows.length + 1, white: entry.san });
        }
      }
    }
    return rows;
  }

  /**
   * Returns the first full FEN string observed during the current session.
   * Used by the post-game summary pipeline to infer opening names without
   * requiring a complete PGN (games may start mid-position).
   */
  getFirstFen(): string | null {
    return this.firstSeenFen;
  }

  /**
   * Returns the stabilised early-move sequence for opening detection.
   *
   * Derived directly from canonicalMoveHistory — the two-stage confirmed
   * move history that the renderer uses for the move table.  Every entry here
   * has already survived the hallucination-filtering state machine (CONFIRM /
   * REPLACE / PREVRECOVER / REVERT), so it is the most reliable source
   * available.  The separate committedPositionHistory buffer required
   * POSITION_STABILITY_FRAMES consecutive identical frames to commit a position,
   * which is almost never satisfied in practice (the player moves before 3
   * identical pipeline frames accumulate), leaving that array empty even after a
   * full game.
   *
   * Returns up to OPENING_HISTORY_MAX_PLIES entries, each with the full FEN and
   * SAN of the move that led to that position (when determinable).
   */
  getEarlyMoveSequence(): Array<{ fen: string; san?: string }> {
    return this.canonicalMoveHistory
      .slice(0, OPENING_HISTORY_MAX_PLIES)
      .filter(e => !!e.fen)
      .map(e => ({ fen: e.fen as string, san: e.san }));
  }

  /**
   * Record an incoming confirmed board position into the rolling stability
   * buffer and attempt to commit it to the opening history.
   *
   * State machine:
   *
   *   REVERT: board matches a previously committed position
   *     → the provisional buffer contains a hallucinated branch — discard it.
   *     → do NOT add a new entry (we are back to a known state).
   *
   *   REINFORCE: board matches the head of the provisional buffer
   *     → increment frameCount.
   *     → when frameCount reaches POSITION_STABILITY_FRAMES, commit and flush buffer.
   *
   *   OSCILLATION: board appears more than OSCILLATION_REPEAT_LIMIT times in the
   *     provisional buffer (e.g. Ra1 → Rb1 → Ra1 bounce)
   *     → discard the entire provisional buffer.
   *     → do NOT commit any of the oscillating positions.
   *
   *   NEW: genuinely unseen board
   *     → attempt single-ply SAN inference from the last committed position.
   *     → if a provisional entry sits between them and two-ply inference succeeds,
   *       commit the provisional entry too (gap-fill).
   *     → push the new board as provisional (frameCount=1).
   */
  private recordPositionForHistory(fen: string, san?: string): void {
    if (this.committedPositionHistory.length >= OPENING_HISTORY_MAX_PLIES) return;

    const board = fen.split(' ')[0] ?? '';

    // ── REVERT: board matches a previously committed position ────────────────
    const committedIdx = this.committedPositionHistory.findIndex(e => e.board === board);
    if (committedIdx !== -1) {
      if (this.positionBuffer.length > 0) {
        log.debug(
          { board: board.slice(0, 24), committedIdx, dropped: this.positionBuffer.length },
          '[PositionHistory] Revert to committed position — dropping provisional buffer'
        );
        this.positionBuffer = [];
      }
      return;
    }

    // ── REINFORCE: board matches the HEAD of the provisional buffer ──────────
    // Must run BEFORE the oscillation check — consecutive confirmations of the
    // same board are legitimate and should increment the frame count, not be
    // treated as oscillation.
    const head = this.positionBuffer[this.positionBuffer.length - 1];
    if (head && head.board === board && head.status === 'provisional') {
      head.frameCount++;
      if (san && !head.san) head.san = san;

      if (head.frameCount >= POSITION_STABILITY_FRAMES) {
        head.status = 'confirmed';
        this.committedPositionHistory.push({ ...head });
        log.debug(
          { board: board.slice(0, 24), san: head.san, histLen: this.committedPositionHistory.length },
          '[PositionHistory] Position committed after stability window'
        );
        this.positionBuffer = [];
      }
      return;
    }

    // ── OSCILLATION: board seen at a non-head position in provisional buffer ──
    // If this board already appeared anywhere in the buffer (and is NOT the
    // current head — that case was handled above), the pipeline is bouncing
    // between positions (e.g. Ra1 → Rb1 → Ra1).  Discard the buffer.
    const provisionalRepeatCount = this.positionBuffer.filter(e => e.board === board).length;
    if (provisionalRepeatCount >= OSCILLATION_REPEAT_LIMIT) {
      log.debug(
        { board: board.slice(0, 24), repeatCount: provisionalRepeatCount, bufLen: this.positionBuffer.length },
        '[PositionHistory] Oscillation detected — discarding provisional buffer'
      );
      this.positionBuffer = [];
      return;
    }

    // ── NEW board ─────────────────────────────────────────────────────────────
    const lastCommitted = this.committedPositionHistory[this.committedPositionHistory.length - 1];
    let resolvedSan = san;

    if (lastCommitted) {
      if (!resolvedSan) {
        resolvedSan = this.tryInferSan(lastCommitted.fen, fen) ?? undefined;
      }

      if (!resolvedSan && this.positionBuffer.length > 0) {
        const provisional = this.positionBuffer[this.positionBuffer.length - 1];
        if (provisional && provisional.status === 'provisional') {
          const san1 = this.tryInferSan(lastCommitted.fen, provisional.fen);
          const san2 = this.tryInferSan(provisional.fen, fen);
          if (san1 && san2) {
            provisional.status = 'confirmed';
            provisional.san = san1;
            this.committedPositionHistory.push({ ...provisional });
            this.positionBuffer = [];
            resolvedSan = san2;
            log.debug(
              { san1, san2, histLen: this.committedPositionHistory.length },
              '[PositionHistory] Gap-filled two-ply transition'
            );
          } else {
            log.debug(
              { board: provisional.board.slice(0, 24) },
              '[PositionHistory] Provisional entry discarded (gap-fill failed)'
            );
            this.positionBuffer = [];
          }
        }
      }
    }

    // Push new board as provisional.
    this.positionBuffer.push({
      fen,
      board,
      frameCount: 1,
      status: 'provisional',
      san: resolvedSan,
    });
  }

  /**
   * Try to infer the SAN of the single move between `fromFen` and `toFen`.
   * Returns the SAN string if exactly one legal move bridges the two positions,
   * or null if the transition cannot be explained by a single move.
   */
  private tryInferSan(fromFen: string, toFen: string): string | null {
    try {
      const fromBoard = fromFen.split(' ')[0] ?? '';
      const toBoard = toFen.split(' ')[0] ?? '';
      if (fromBoard === toBoard) return null;

      // Try the turn encoded in fromFen first, then the other side as fallback.
      const fromTurnField = fromFen.split(' ')[1] as 'w' | 'b' | undefined;
      const turns: ('w' | 'b')[] = fromTurnField
        ? [fromTurnField, fromTurnField === 'w' ? 'b' : 'w']
        : ['w', 'b'];

      for (const turn of turns) {
        const candidate = `${fromBoard} ${turn} - - 0 1`;
        const result = fenDiffToSan(candidate, toFen, turn);
        if (result) return result;
      }
    } catch {
      // Best-effort — swallow errors
    }
    return null;
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

    let inferredTurn: 'w' | 'b';
    if (this.lastChessTurn !== null) {
      // Screenshot-path FEN has been confirmed — use the already-resolved turn.
      inferredTurn = this.lastChessTurn;
    } else {
      // Screenshot vote has not yet promoted a FEN (websocket-fallback path or
      // very start of a session). Try to read the <turn> tag from the most recent
      // visual index frame — the WebSocket indexing pipeline embeds it there.
      // IMPORTANT: Only accept a <turn> tag from a frame that also contains the
      // same board position (matching <raw_board> content). This prevents stale
      // tags from previous positions — which can linger in the buffer for up to
      // visualContextWindowMs (45 s) — from poisoning the cold-start turn seed
      // and causing the engine to analyse from the wrong side's perspective.
      let turnFromVisuals: 'w' | 'b' | null = null;
      if (visuals && visuals.length > 0) {
        for (let i = visuals.length - 1; i >= 0; i--) {
          const chunkText = visuals[i].text;
          const turnMatch = chunkText.match(/<turn>\s*(.*?)\s*<\/turn>/is);
          if (!turnMatch) continue;

          // Verify the board in this chunk matches the board we are resolving the
          // turn for. Strip whitespace before comparing so minor formatting
          // differences in the injected synthetic text don't cause false misses.
          const boardMatch = chunkText.match(/<raw_board>\s*(.*?)\s*<\/raw_board>/is);
          if (boardMatch) {
            const chunkBoard = boardMatch[1].trim();
            if (chunkBoard !== board.trim()) {
              // This <turn> tag belongs to a different board — skip it to avoid
              // using a stale tag as the turn seed for the current position.
              log.debug(
                { chunkBoard: chunkBoard.slice(0, 30), currentBoard: board.slice(0, 30) },
                '[LiveAssist] applyNextTurnToFen: skipping stale <turn> tag (board mismatch)'
              );
              continue;
            }
          }

          turnFromVisuals = turnMatch[1].toLowerCase().includes('black') ? 'b' : 'w';
          log.debug({ turnFromVisuals, source: 'visual_index_turn_tag' }, '[LiveAssist] applyNextTurnToFen: turn read from visual index <turn> tag (board-matched)');
          break;
        }
      }
      inferredTurn = turnFromVisuals ?? (this.lastChessPerspective === 'black' ? 'b' : 'w');
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

    // ── Terminal-position fast path ──────────────────────────────────────────
    // Check before calling the engine. chess-api.com returns INVALID_INPUT for
    // checkmate/stalemate FENs because there is no legal move to extend. Instead
    // of letting the engine call fail and discarding the position, we detect the
    // terminal state locally and return a context that lets the LLM generate a
    // coaching explanation.
    const terminalState = getTerminalState(resolvedFen.fen);
    if (terminalState) {
      log.info(
        { resolvedFen: resolvedFen.fen, terminalState },
        '[LiveAssist] Terminal position detected — skipping engine call, routing to coaching LLM'
      );
      if (cycleId !== undefined) pipelineLatency.endStep(cycleId, 'engineCall', terminalState);
      return {
        fen: resolvedFen.fen,
        engineSummary: '',
        playedMoveSan: latestMove.san,
        playedMoveUci: latestMove.uci,
        board: resolvedFen.fen.split(' ')[0],
        // turn field = side that JUST moved (opposite of side to move).
        turn: resolvedFen.turn === 'w' ? 'b' : 'w',
        terminalState,
      };
    }

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
    // Fetch 3 top lines in parallel (best move + 2 alternatives) so the engine
    // card can display "Top lines: 1. e4 (eval 0.36) | 2. d4 (eval 0.34) | ...".
    if (cycleId !== undefined) pipelineLatency.startStep(cycleId, 'engineCall');
    const topLines = await engine.getTopLines(resolvedFen.fen, 3, {
      depth: 12,
      maxThinkingTime: 50,
    });

    const result = topLines[0] ?? null;

    if (!result) {
      if (cycleId !== undefined) pipelineLatency.endStep(cycleId, 'engineCall', 'no analysis');
      log.warn({ resolvedFen: resolvedFen.fen, inferredTurn: resolvedFen.turn }, '[LiveAssist] Chess engine returned no analysis — skipping tip for this position');
      return null;
    }
    if (cycleId !== undefined) pipelineLatency.endStep(cycleId, 'engineCall');

    const currentEval = typeof result.eval === 'number' ? result.eval : undefined;
    const currentWinChance = typeof result.winChance === 'number' ? result.winChance : undefined;

    // Centipawn loss = |evalBefore − evalAfter| × 100.
    const centipawnLoss =
      this.lastPositionEval !== undefined && currentEval !== undefined
        ? Math.round(Math.abs(this.lastPositionEval - currentEval) * 100)
        : undefined;

    // Capture the PREVIOUS win% BEFORE overwriting it — this is winChanceBefore for this move.
    const winChanceBefore = this.lastPositionWinChance;

    // Persist the current eval/winChance so the NEXT call can compute loss for that move.
    this.lastPositionEval = currentEval;
    this.lastPositionWinChance = currentWinChance;

    return {
      fen: resolvedFen.fen,
      engineSummary: engine.summarize(result, topLines),
      engineSan: result.san,
      engineLan: result.lan,
      engineFrom: result.from,
      engineTo: result.to,
      engineEval: currentEval,
      engineMate: result.mate ?? null,
      winChance: currentWinChance,
      winChanceBefore,
      centipawnLoss,
      playedMoveSan: latestMove.san,
      playedMoveUci: latestMove.uci,
      board: resolvedFen.board,
      // resolvedFen.turn is who is to move NEXT — flip it to get the side
      // that just played the move that triggered this engine call.
      turn: resolvedFen.turn === 'w' ? 'b' : 'w',
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
    this.totalMoveCount = 0;
    this.firstSeenFen = null;
    this.positionBuffer = [];
    this.committedPositionHistory = [];
    this.canonicalMoveHistory = [];
    this.pendingCanonicalEntry = null;
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
   * Flip the current side-to-move and immediately re-run the engine and
   * coaching pipeline against the new turn. Called when the user manually
   * overrides the detected turn from the overlay button.
   */
  flipTurn(): void {
    if (!this.isRunning || !this.lastChessBoard || this.lastChessTurn === null) {
      log.warn('[LiveAssist] flipTurn: no active position to flip');
      return;
    }

    const flipped: 'w' | 'b' = this.lastChessTurn === 'w' ? 'b' : 'w';
    log.info(
      { from: this.lastChessTurn, to: flipped, board: this.lastChessBoard.slice(0, 30) },
      '[LiveAssist] flipTurn: user-initiated turn override'
    );

    this.lastChessTurn = flipped;
    this.userFlippedTurn = true; // prevent processTranscriptInner from overwriting the flip

    // Reset the signature so processTranscriptInner treats this as a new
    // position and re-runs the engine rather than skipping as a duplicate.
    this.lastChessSignature = null;

    // Emit an updated fen event immediately so the overlay reflects the
    // new turn before the engine call completes.
    // isFlipAck marks this as a position-only acknowledge — the renderer
    // must not use it to clear the "regenerating" spinner.
    const castling = this.getCastlingRightsString();
    const whitePerspFen = `${this.lastChessBoard} ${flipped} ${castling} - 0 1`;
    const displayFen = this.buildDisplayFen(whitePerspFen, this.lastChessPerspective);
    this.emit('fen', {
      fen: whitePerspFen,
      displayFen,
      board: this.lastChessBoard,
      turn: flipped,
      boardOrientation: this.lastChessPerspective,
      engineSan: this.lastEngineSan,
      engineLan: this.lastEngineLan,
      engineFrom: this.lastEngineFrom,
      engineTo: this.lastEngineTo,
      engineEval: this.lastEngineEval,
      engineMate: this.lastEngineMate,
      isFlipAck: true,
    });

    // Re-schedule processing so the engine re-analyses with the flipped turn.
    this.scheduleProcessing();
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
  injectConfirmedFen(fenBoard: string, perspective: 'white' | 'black' = 'white', reportedTurn: 'w' | 'b' | null = null, cycleId?: number, voteMeta?: VoteMeta, reportedLastMoveFrom?: string | null, reportedLastMoveTo?: string | null): boolean {
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

    // ── Semantic validity guard ───────────────────────────────────────────────
    // Reject boards that are structurally impossible in a real chess game.
    // This catches LLM failures such as all-empty boards (8/8/8/8/8/8/8/8),
    // boards missing both kings, pawns on the back rank, or more than 16 pieces
    // per side. These boards must never reach the engine or update game state.
    if (!this.isValidFenBoard(fenBoard) || !this.isSemanticFenValid(fenBoard)) {
      log.warn(
        { fenBoard: fenBoard.slice(0, 40) },
        '[LiveAssist] injectConfirmedFen: board failed semantic validation (empty/missing kings/illegal pieces) — discarding'
      );
      return false;
    }

    // ── Plausibility guard ────────────────────────────────────────────────────
    // Reject boards that are physically impossible given the last confirmed
    // position. The most common LLM hallucination is confusing pawns with
    // bishops (P↔B / p↔b) or knights with rooks (N↔R / n↔r) because they can
    // look similar in certain piece sets. A single chess move cannot increase the
    // combined count of (pawns + bishops) or (knights + rooks) for either side —
    // so any increase in those sums is a hallucination, not a real move.
    //
    // We compare against lastChessBoard (last frame accepted into live-assist,
    // not last confirmed engine FEN) so the check is always relative to the most
    // recent known-good state.
    if (!this.isBoardPlausible(this.lastChessBoard, fenBoard)) {
      log.warn(
        { fenBoard: fenBoard.slice(0, 40), lastBoard: (this.lastChessBoard ?? '').slice(0, 40) },
        '[LiveAssist] injectConfirmedFen: board rejected by plausibility check — waiting for next frame'
      );
      return false;
    }

    // ── Initial position: always White's turn ────────────────────────────────
    // The starting position is deterministic — White always moves first.
    // Override any LLM-reported or heuristic-derived turn to prevent the
    // perspective seed or a stale lastChessTurn from setting it to 'b'.
    if (this.isInitialChessBoard(fenBoard)) {
      const inferredTurn: 'w' | 'b' = 'w';
      this.lastChessTurn = inferredTurn;
      this.lastChessBoard = fenBoard;
      this.lastFenForMoveHistory = fenBoard;  // anchor so the first real move can be diffed
      this.lastChessPerspective = perspective;
      this.updateCastlingRightsFromBoard(fenBoard);
      const castling = this.getCastlingRightsString();
      log.debug(
        { fenBoard: fenBoard.slice(0, 30), perspective, inferredTurn, castling },
        '[LiveAssist] injectConfirmedFen: initial position — turn forced to white'
      );
      const whitePerspectiveFen = `${fenBoard} ${inferredTurn} ${castling} - 0 1`;
      const displayFen = this.buildDisplayFen(whitePerspectiveFen, perspective);
      // Do NOT set firstSeenFen here — the starting position is not useful for
      // opening identification. We wait for the first real move (non-initial board)
      // to capture the actual opening position. If the game is recorded from the
      // very first move, getFirstFen() will return the post-first-move FEN.
      this.emit('fen', {
        fen: whitePerspectiveFen,
        displayFen,
        board: fenBoard,
        turn: inferredTurn,
        boardOrientation: perspective,
        engineSan: this.lastEngineSan,
        engineLan: this.lastEngineLan,
        engineFrom: this.lastEngineFrom,
        engineTo: this.lastEngineTo,
        engineEval: this.lastEngineEval,
        engineMate: this.lastEngineMate,
      });
      const syntheticText = `<source>\nscreenshot\n</source>\n\n<perspective>\nwhite\n</perspective>\n\n<raw_board>\n${fenBoard}\n</raw_board>`;
      this.addVisualIndexRaw(syntheticText);
      return true;
    }

    // Turn resolution priority chain — designed for single-frame accuracy:
    //
    // Tier 1 (T2a) — Algebraic-square-derived turn from <last_move_from/to> tags.
    //   The LLM reports the origin and destination squares as algebraic coordinates.
    //   We cross-validate: look up the piece at the destination in the extracted FEN.
    //   Uppercase = White moved = Black to move. Lowercase = vice-versa.
    //   Works from ANY single frame — no previous frame needed.
    //   This is the PRIMARY mechanism.
    //
    // Tier 2 (T2b) — <turn> text tag from LLM.
    //   The LLM's explicit turn declaration.
    //   Used to cross-validate T2a. When T2a and T2b DISAGREE, T2b wins.
    //   Used alone when T2a is unavailable.
    //
    // Tier 3 — Board-diff via fenDiffToSan (demoted, tertiary).
    //   Requires a valid previous frame exactly one move behind.
    //
    // Tier 4 — Keep last confirmed turn.
    // Tier 5 — Cold-start perspective seed.

    // ── Move-pair validation ──────────────────────────────────────────────────
    // Reject the algebraic from/to pair when it is inconsistent with the
    // confirmed FEN — e.g. the LLM identified the wrong highlighted squares
    // (both occupied, or both empty). Discard early so T2a is cleanly skipped
    // rather than silently returning null inside deriveTurnFromAlgebraicMove.
    let validatedMoveFrom = reportedLastMoveFrom ?? null;
    let validatedMoveTo   = reportedLastMoveTo   ?? null;
    if (validatedMoveFrom && validatedMoveTo) {
      if (!this.validateAlgebraicMovePair(validatedMoveFrom, validatedMoveTo, fenBoard)) {
        log.warn(
          { from: validatedMoveFrom, to: validatedMoveTo, fenBoard: fenBoard.slice(0, 40) },
          '[TurnDetect] injectConfirmedFen: move pair failed FEN validation (neither/both squares empty) — discarding T2a signal'
        );
        validatedMoveFrom = null;
        validatedMoveTo   = null;
      }
    }

    // T2a: derive from algebraic squares (single-frame, primary)
    const gridDerivedTurn = (validatedMoveFrom && validatedMoveTo)
      ? this.deriveTurnFromAlgebraicMove(validatedMoveFrom, validatedMoveTo, fenBoard)
      : null;

    // Cross-validation: when T2a and T2b disagree, T2b wins.
    // T2b is the LLM's direct reasoning output; T2a can be wrong when the
    // model identifies the wrong pair of highlighted squares.
    const effectiveGridDerivedTurn =
      (gridDerivedTurn !== null && reportedTurn !== null && gridDerivedTurn !== reportedTurn)
        ? null  // disagree — discard T2a, fall through to T2b
        : gridDerivedTurn;

    if (gridDerivedTurn !== null && reportedTurn !== null && gridDerivedTurn !== reportedTurn) {
      log.warn(
        { gridDerivedTurn, reportedTurn, fenBoard: fenBoard.slice(0, 40) },
        '[TurnDetect] T2a (grid) and T2b (<turn> tag) disagree — discarding T2a, using T2b'
      );
    }

    // Combined single-frame LLM signal: prefer cross-validated T2a, fall back to T2b
    const llmTurn = effectiveGridDerivedTurn ?? reportedTurn;

    // T3: board-diff (demoted — requires previous frame, unreliable in production)
    const boardDiffTurn = (llmTurn === null && this.lastChessBoard && this.lastChessBoard !== fenBoard)
      ? this.inferTurnFromBoards(this.lastChessBoard, fenBoard, this.lastChessTurn)
      : null;

    const inferredTurn: 'w' | 'b' =
      llmTurn ??
      boardDiffTurn ??
      this.lastChessTurn ??
      (perspective === 'black' ? 'b' : 'w');

    const tierUsed =
      effectiveGridDerivedTurn != null ? '2a' :
      reportedTurn != null             ? '2b' :
      boardDiffTurn != null            ? '3'  :
      this.lastChessTurn != null       ? '4'  : '5';

    log.debug(
      { gridDerivedTurn, effectiveGridDerivedTurn, reportedTurn, llmTurn, boardDiffTurn, lastChessTurn: this.lastChessTurn, inferredTurn, tierUsed },
      '[LiveAssist] injectConfirmedFen: turn tier used'
    );

    // Update castling rights from this confirmed board before updating other state.
    // This ensures getCastlingRightsString() is accurate when we build the FEN below.
    this.updateCastlingRightsFromBoard(fenBoard);

    // Update tracked state immediately so processTranscriptInner uses the
    // correct turn even before a coaching tip is generated.
    this.lastChessTurn = inferredTurn;
    this.lastChessBoard = fenBoard;

    const castling = this.getCastlingRightsString();
    log.debug(
      { fenBoard: fenBoard.slice(0, 30), perspective, reportedTurn, gridDerivedTurn, inferredTurn, castling },
      '[LiveAssist] injectConfirmedFen: turn and castling rights updated'
    );

    // Store the perspective so we can emit it with the 'fen' event
    this.lastChessPerspective = perspective;

    // Emit 'fen' immediately so the overlay board updates the moment a new
    // confirmed position is available — even if the coaching LLM call
    // fails/times out later. This decouples board display from tip generation.
    // Keep the previous engine fields so the overlay continues to show the
    // last best move until the new engine result arrives for this position.
    const whitePerspectiveFen = `${fenBoard} ${inferredTurn} ${castling} - 0 1`;
    const displayFen = this.buildDisplayFen(whitePerspectiveFen, perspective);

    // Update the move history FEN tracker (separate from lastChessSignature
    // which controls coaching deduplication — don't touch that here).
    if (fenBoard && fenBoard !== this.lastFenForMoveHistory) {
      this.lastFenForMoveHistory = fenBoard;
      this.totalMoveCount++;
    }

    // Update the canonical move history — revert or rebase hallucinated branches,
    // and derive the SAN via the guarded tryInferSanForHistory.
    // SAN derivation lives entirely inside updateCanonicalHistory so there is
    // exactly one code path and one source of truth.
    const canonicalResult = this.updateCanonicalHistory(fenBoard, whitePerspectiveFen);
    const finalPlayedSan  = canonicalResult.resolvedSan;
    const finalPlayedTurn = canonicalResult.resolvedTurn;
    const moveHistorySnapshot = this.getCanonicalMoveHistorySnapshot();

    // Record the first real gameplay position (non-starting-board) for opening detection.
    // Skipping the initial board ensures mid-game joins capture the actual position,
    // and games starting from move 1 capture the post-first-move FEN (e.g. after 1.e4)
    // rather than the blank starting position which always returns "Starting Position".
    if (!this.firstSeenFen) {
      this.firstSeenFen = whitePerspectiveFen;
    }

    // Feed the stable position history buffer used for opening detection.
    // We pass fenPlayedSan (the move that just led here) so the history can
    // reconstruct a partial move sequence even when frames are missing.
    this.recordPositionForHistory(whitePerspectiveFen, finalPlayedSan);

    this.emit('fen', {
      fen: whitePerspectiveFen,
      displayFen,
      board: fenBoard,
      turn: inferredTurn,
      boardOrientation: perspective,
      engineSan: this.lastEngineSan,
      engineLan: this.lastEngineLan,
      engineFrom: this.lastEngineFrom,
      engineTo: this.lastEngineTo,
      engineEval: this.lastEngineEval,
      engineMate: this.lastEngineMate,
      playedMoveSan: finalPlayedSan,
      playedTurn: finalPlayedTurn,
      moveHistorySnapshot,
    });

    // The pipeline always works in white's perspective.
    // The <source>screenshot</source> tag marks this as coming from the
    // validated screenshot path so extractLatestFen can prefer it over
    // RTStream board_mapping items which may be noisy or incorrectly normalised.
    // We bypass the addVisualIndex actionability filter here — the raw XML tags
    // must be stored verbatim so extractLatestFen can parse <raw_board> later.
    const syntheticText = `<source>\nscreenshot\n</source>\n\n<perspective>\nwhite\n</perspective>\n\n<raw_board>\n${fenBoard}\n</raw_board>`;
    this.addVisualIndexRaw(syntheticText);
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
   * Like addVisualIndex but stores the raw text verbatim without applying the
   * actionability filter or sanitization.
   *
   * Used exclusively by injectConfirmedFen() for screenshot-path synthetic XML
   * text whose <source>, <perspective>, and <raw_board> tags must be preserved
   * exactly so that extractLatestFen() can parse them later.  The normal
   * addVisualIndex() path strips XML tags via sanitizeInsightText(), which
   * destroys the structure extractLatestFen() relies on.
   */
  private addVisualIndexRaw(text: string): void {
    if (!this.isRunning) return;

    const now = Date.now();

    // Dedup: skip if identical text was just added within the duplicate window.
    const isLikelyDuplicate =
      this.lastVisualText === text &&
      (now - this.lastVisualTextAt) <= VISUAL_DUPLICATE_WINDOW_MS;

    if (isLikelyDuplicate) {
      log.debug('[LiveAssist] addVisualIndexRaw: skipping duplicate screenshot injection');
      // Still schedule processing so the cycle is not silently dropped when the
      // board hasn't changed but a new cycle needs to be evaluated.
      this.scheduleProcessing();
      return;
    }

    this.lastVisualText = text;
    this.lastVisualTextAt = now;

    this.visualIndexBuffer.push({ text, timestamp: now });

    log.debug(
      { preview: text.substring(0, 120), bufferSizeBefore: this.visualIndexBuffer.length },
      '[LiveAssist] addVisualIndexRaw: screenshot-path FEN injected'
    );

    this.scheduleProcessing();

    const timingProfile = getGameVisualIndexTiming(this.activeGameId);
    const cutoff = now - timingProfile.visualContextWindowMs;
    this.visualIndexBuffer = this.visualIndexBuffer.filter(v => v.timestamp > cutoff);
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
      // Invalidate both the pending AND confirmed signatures so the screenshot
      // service's next confirmation of the same board is treated as a new position
      // and triggers a fresh engine call. Without this, lastConfirmedFen in the
      // screenshot service blocks re-injection and the position is permanently stuck.
      this.pendingChessSignature = null;
      this.pendingChessSignatureCount = 0;
      this.lastChessSignature = null;
      getChessScreenshotService().invalidateLastConfirmed();
      return;
    }

    // ── Terminal position branch (checkmate / stalemate) ─────────────────────
    // The engine cannot analyse these positions (no legal move). Instead we skip
    // the normal player-turn / opponent-turn routing and fire a dedicated coaching
    // LLM prompt that explains what happened and why.
    if (this.activeGameId === 'chess' && chessContext?.terminalState) {
      const terminal = chessContext.terminalState;
      const playerColor: 'w' | 'b' = this.lastChessPerspective === 'black' ? 'b' : 'w';
      const justMoved: 'w' | 'b' = chessContext.turn ?? playerColor;
      const sideToMove: 'w' | 'b' = justMoved === 'w' ? 'b' : 'w';
      const sideToMoveLabel = sideToMove === 'w' ? 'White' : 'Black';
      const justMovedLabel = justMoved === 'w' ? 'White' : 'Black';

      // Update state + clear stale engine data before emitting FEN.
      if (chessSignature) {
        this.lastChessSignature = chessSignature;
        this.lastChessBoard = chessContext.board || chessSignature;
        this.lastChessTurn = sideToMove;
        // Clear previous engine move — there is no best move in a terminal position.
        this.lastEngineSan = undefined;
        this.lastEngineLan = undefined;
        this.lastEngineFrom = undefined;
        this.lastEngineTo = undefined;
        this.lastEngineEval = undefined;
        this.lastEngineMate = undefined;
        this.pendingChessSignature = null;
        this.pendingChessSignatureCount = 0;
        const whitePerspFen = chessContext.fen;
        const dFen = this.buildDisplayFen(whitePerspFen, this.lastChessPerspective);
        this.emit('fen', {
          fen: whitePerspFen,
          displayFen: dFen,
          board: this.lastChessBoard,
          turn: sideToMove,
          engineSan: undefined,
          engineLan: undefined,
          engineFrom: undefined,
          engineTo: undefined,
          engineEval: undefined,
          engineMate: undefined,
        });
      }
      this.lastProcessedTimestamp = now;

      // Build a terminal coaching prompt — tailor by checkmate vs stalemate.
      const gameContextSection = this.meetingContext?.description?.trim()
        ? `## PLAYER'S GAME GOALS\n${this.meetingContext.description.trim()}\n\n`
        : '';
      const terminalPrompt = terminal === 'checkmate'
        ? `${gameContextSection}## CHESS POSITION CONTEXT\nFEN: ${chessContext.fen}\nThe game has ended. ${sideToMoveLabel} is in checkmate — ${justMovedLabel} delivered the decisive blow.\n\n## TASK\nYou are a chess coach. In exactly two sentences (30–55 words total), explain this checkmate to the player:\n- First sentence: identify the tactical pattern or motif that made the mate possible (back-rank mate, smothered mate, Arabian mate, etc.) and the key piece(s) involved.\n- Second sentence: explain what the losing side could have done differently to prevent it.\nFor ask_this, write one short question that tests the player's understanding of the mating pattern.\nRespond with ONLY a raw JSON object: {"say_this":"...","ask_this":"..."}`
        : `${gameContextSection}## CHESS POSITION CONTEXT\nFEN: ${chessContext.fen}\nThe game has ended in stalemate — ${sideToMoveLabel} has no legal move but is not in check.\n\n## TASK\nYou are a chess coach. In exactly two sentences (30–55 words total), explain this stalemate:\n- First sentence: identify which pieces are blocking all of ${sideToMoveLabel}'s moves and why the position became a stalemate.\n- Second sentence: explain what ${justMovedLabel} could have done differently to avoid gifting the stalemate.\nFor ask_this, write one short question that tests the player's understanding of stalemate avoidance.\nRespond with ONLY a raw JSON object: {"say_this":"...","ask_this":"..."}`;

      this.coachingInFlight = true;
      void this.runCoachingLLM(chessContext, chessSignature, terminalPrompt, null, trackedCycleId);
      return;
    }
    // lastChessPerspective = which side the player is playing as (board orientation).
    // chessContext.turn   = side that JUST MOVED (flipped in buildChessContext for accuracy tagging).
    // sideToMove          = who is to move NEXT = opposite of chessContext.turn.
    const playerColor: 'w' | 'b' = this.lastChessPerspective === 'black' ? 'b' : 'w';
    const justMoved: 'w' | 'b' = chessContext?.turn ?? playerColor;
    const sideToMove: 'w' | 'b' = justMoved === 'w' ? 'b' : 'w';
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
        const rawSummary = chessContext.engineSummary.split('\n').filter(Boolean).join(' | ');
        this.emit('insights', {
          insights: { say_this: [`engine: ${rawSummary}`], ask_this: [] },
          processedAt: Date.now(),
          clearExisting: true,
          isFlipAck: this.userFlippedTurn,
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
        this.lastEngineLan = chessContext?.engineLan;
        this.lastEngineFrom = chessContext?.engineFrom;
        this.lastEngineTo = chessContext?.engineTo;
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
          engineLan: this.lastEngineLan,
          engineFrom: this.lastEngineFrom,
          engineTo: this.lastEngineTo,
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
        const threatPrompt = `${gameContextSection}## CHESS POSITION CONTEXT\nFEN: ${chessContext.fen}\nYou are coaching ${playerColorLabel}. It is currently ${opponentColorLabel}'s turn.\n${chessContext.engineSummary ? `Engine summary:\n${chessContext.engineSummary}\n` : ''}\n---\n\n## OPPONENT'S BEST MOVE: ${bestOppMoveSan}\n${oppPieceAnchor}\nThe engine says ${opponentColorLabel}'s best move is ${bestOppMoveSan}.\nExplain to ${playerColorLabel} what this move threatens or achieves in exactly two sentences (40–60 words total). First sentence: describe the concrete threat or idea behind ${bestOppMoveSan} — what it attacks, pins, opens, or prepares. Second sentence: tell ${playerColorLabel} what they must watch out for or how they should respond.\nOnly mention piece positions that are confirmed by the FEN. Do not invent piece locations.\nFor ask_this: ask what ${playerColorLabel}'s best defensive or counter response would be.\nRespond with ONLY a raw JSON object: {"say_this":"...","ask_this":"..."}`;

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
      const rawSummary = chessContext.engineSummary.split('\n').filter(Boolean).join(' | ');
      this.emit('insights', {
        insights: { say_this: [`engine: ${rawSummary}`], ask_this: [] },
        processedAt: Date.now(),
        clearExisting: true,
        isFlipAck: this.userFlippedTurn,
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
In exactly two sentences (40–60 words total), explain why ${bestMoveSan ?? 'the engine move'} is best. First sentence: name the immediate concrete threat, square, or tactical idea it creates. Second sentence: explain the follow-up benefit, positional gain, or what it prevents.
Only mention piece positions confirmed by the FEN. No generic advice.
For ask_this, write one short calculation question about the next move or likely response.
Respond with ONLY a raw JSON object: {"say_this":"...","ask_this":"..."}`;
    log.info({ visualCount: promptVisuals.length, hasVisual: !!chessSection }, 'Processing gameplay feed for live assist');

    // Compute the actual played move SAN via FEN diff BEFORE updating lastChessSignature.
    // prevFen = last known board + whose turn it was BEFORE the move (opposite of chessContext.turn).
    let computedPlayedSan: string | undefined;
    if (this.activeGameId === 'chess' && this.lastChessSignature && chessContext?.turn && chessContext?.fen) {
      const prevFen = `${this.lastChessSignature} ${chessContext.turn === 'w' ? 'b' : 'w'} - - 0 1`;
      computedPlayedSan = fenDiffToSan(prevFen, chessContext.fen, chessContext.turn);
      log.debug({ prevFen, newFen: chessContext.fen, turn: chessContext.turn, computedPlayedSan }, '[LiveAssist] FEN diff → played SAN');
    }

    // Mark this position as processed immediately so isProcessing is released.
    // The coaching LLM fires in the background and upgrades the engine tip when ready.
    if (this.activeGameId === 'chess' && chessSignature) {
      this.lastChessSignature = chessSignature;
      this.lastChessBoard = chessContext?.board || chessSignature;
      // When the user has manually flipped the turn, preserve their override —
      // do NOT re-derive lastChessTurn from chessContext which would undo the flip.
      // Clear the flag after consuming it so future auto-detected moves work normally.
      if (this.userFlippedTurn) {
        this.userFlippedTurn = false;
      } else {
        // chessContext.turn is the side that JUST MOVED — flip to get side to move next.
        this.lastChessTurn = chessContext?.turn ? (chessContext.turn === 'w' ? 'b' : 'w') : this.lastChessTurn;
      }
      // Store engine result on instance so subsequent fen emits carry it too.
      this.lastEngineSan = chessContext?.engineSan;
      this.lastEngineLan = chessContext?.engineLan;
      // Store engine result on instance so subsequent fen emits carry it too.
      this.lastEngineSan = chessContext?.engineSan;
      this.lastEngineLan = chessContext?.engineLan;
      this.lastEngineFrom = chessContext?.engineFrom;
      this.lastEngineTo = chessContext?.engineTo;
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
        engineLan: this.lastEngineLan,
        engineFrom: this.lastEngineFrom,
        engineTo: this.lastEngineTo,
        engineEval: this.lastEngineEval,
        engineMate: this.lastEngineMate,
      });
    }
    this.lastProcessedTimestamp = now;

    // Fire coaching LLM as fire-and-forget — it will upgrade the engine tip
    // when it completes. isProcessing is released immediately after this return.
    this.coachingInFlight = true;
    void this.runCoachingLLM(chessContext, chessSignature, userPrompt, bestMoveSan, trackedCycleId, computedPlayedSan);
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
    cycleId?: number,
    playedMoveSan?: string,
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

Previous draft was too generic or too short:
${currentSay || '(empty)'}

Rewrite it as exactly two sentences (40–60 words total). First sentence: name the required move and explain the immediate board effect — the specific threat, square, or piece activity. Second sentence: explain the follow-up benefit or what it prevents. Return ONLY raw JSON.`;

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
      // No hard char cap — the prompt constrains length to 40-60 words.
      // A sentence-completing safety valve: if the paragraph is unreasonably long
      // (> 600 chars, well above 60 words) trim to the last sentence boundary within
      // that limit so we never chop mid-sentence.
      const PARAGRAPH_SAFETY_CHARS = 600;
      const trimmedParagraph = paragraph.length > PARAGRAPH_SAFETY_CHARS
        ? (() => {
            const safe = paragraph.slice(0, PARAGRAPH_SAFETY_CHARS);
            const lastDot = safe.lastIndexOf('.');
            return lastDot > 0 ? safe.slice(0, lastDot + 1) : safe;
          })()
        : paragraph;
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
        winChance: chessContext?.winChance,
        winChanceBefore: chessContext?.winChanceBefore,
        engineEval: chessContext?.engineEval,
        centipawnLoss: chessContext?.centipawnLoss,
        turn: chessContext?.turn ?? undefined,
        moveSan: chessContext?.engineSan ?? chessContext?.playedMoveSan ?? undefined,
        playedMoveSan: playedMoveSan ?? chessContext?.playedMoveSan ?? undefined,
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
    this.canonicalMoveHistory = [];
    this.pendingCanonicalEntry = null;
    this.prevPendingCanonicalEntry = null;
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
