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
import { GPT_54_MODEL, getLLMService } from './llm/llm.service';
import { getChessEngineService } from './chess/chess-engine.service';
import { getChessScreenshotService } from './chess/chess-screenshot.service';
import { fenDiffToSan, getTerminalState } from '../lib/chess/chess-notation';
import { isBoardPlausible } from '../lib/chess/board-plausibility';
import {
  extractFenCandidates as extractFenCandidatesFromText,
  hasNoBoardRawBoard,
  isSemanticFenValid,
  isValidFenBoard,
} from '../lib/vision/chess-fen-extractor';
import { selectLatestFenFromVisuals } from '../lib/chess/live-assist-fen-selection';
import {
  isLikelyGameplayFeed,
  isNonActionableVisualText,
  stripNonActionableVisualText,
} from '../lib/vision/live-assist-visual-text';
import {
  getCanonicalMoveHistorySnapshot as buildCanonicalMoveHistorySnapshot,
  INITIAL_CHESS_BOARD,
  type CanonicalHistoryEntry,
  updateCanonicalHistoryState,
} from '../lib/chess/canonical-history';
import {
  DEFAULT_GAME_ID,
  getGameVisualIndexTiming,
  type SupportedGameId,
} from '../../shared/config/game-coaching';
import {
  getCastlingRightsString,
  updateCastlingRightsFromBoard,
  type CastlingRightsState,
} from '../lib/chess/live-assist-chess-helpers';
import {
  OPENING_HISTORY_MAX_PLIES,
  PLAUSIBILITY_REJECT_LIMIT,
  PROCESS_TRANSCRIPT_TIMEOUT_MS,
  TIP_REPLACE_COOLDOWN_MS,
  TIP_VISIBLE_MS,
  VISUAL_DUPLICATE_WINDOW_MS,
} from './live-assist/live-assist.constants';
import type {
  ChessContextData,
  MeetingContext,
  PositionEntry,
  TranscriptChunk,
  VisualIndexChunk,
} from './live-assist/live-assist.types';
import { describeMovingPiece } from './live-assist/engine/live-assist-engine-text';
import {
  buildWinProbabilitySnapshot,
  stampWinChanceAtStage1 as stampWinChance,
  type WinProbabilityPoint,
} from './live-assist/engine/live-assist-win-probability';
import {
  applyNextTurnToFen as resolveFenTurn,
  extractLatestChessMove,
} from './live-assist/fen/live-assist-fen-turn';
import { recordPositionForHistory as updatePositionHistory } from './live-assist/history/live-assist-position-history';
import {
  buildOpponentThreatPrompt,
  buildPlayerBestMovePrompt,
  buildTerminalPrompt,
} from './live-assist/coaching/live-assist-coaching-prompts';
import {
  buildFinalCoachingOutput,
} from './live-assist/coaching/live-assist-coaching-response';
import { prepareRtstreamFenVisualText } from './live-assist/fen/live-assist-rtstream';
import {
  buildSemanticRejectDiagnostics,
  countBoardPieces,
} from './live-assist/diagnostics/live-assist-board-diagnostics';
import {
  emptyEngineState,
  engineStateFromContext,
  type LiveAssistEngineState,
} from './live-assist/engine/live-assist-engine-state';
import {
  formatEngineSummaryTip,
  parseEngineSummaryMove,
} from './live-assist/engine/live-assist-engine-summary';
import { resolveLiveAssistTurnContext } from './live-assist/fen/live-assist-side-to-move';
import { buildLiveAssistFenEvent } from './live-assist/fen/live-assist-fen-event';
import { resolveConfirmedFenTurn } from './live-assist/fen/live-assist-turn-resolution';
import {
  getInstructionSignature,
  sanitizeInsightText,
} from './live-assist/coaching/live-assist-insights';
import { buildLiveAssistChatPrompt } from './live-assist/coaching/live-assist-chat-prompt';
import { requestCoachingInsights } from './live-assist/coaching/live-assist-coaching-task';

const log = logger.child({ module: 'live-assist' });

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
  /** Consecutive plausibility rejections — reset when the first board passes. */
  private plausibilityRejectStreak = 0;
  // Separate tracker for move history FEN diff — updated in injectConfirmedFen
  // independently of lastChessSignature to avoid breaking the coaching skip check.
  private lastFenForMoveHistory: string | null = null;
  /** Last RTStream FEN board string — used by ChessScreenshotService for cross-validation. */
  public lastRtstreamFenBoard: string | null = null;
  /** Count of confirmed board-position changes (plies) in the current session. */
  private totalMoveCount = 0;
  /**
   * Canonical per-ply move history — committed entries only.  A board is only
   * moved here once the *following* board has confirmed it was real (two-stage
   * provisional model).  The snapshot sent to the renderer is built from this
   * list, giving a one-ply display lag that eliminates phantom moves.
   */
  private canonicalMoveHistory: CanonicalHistoryEntry[] = [];
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
  private pendingCanonicalEntry: CanonicalHistoryEntry | null = null;
  /**
   * Previous pending entry — saved when REPLACE fires so that the following
   * board can check if it connects through the replaced (possibly real) entry.
   * Example: real move P was in pending, hallucination H came in (REPLACE fired,
   * P dropped, H is now pending).  Next real board B connects P→B but not H→B.
   * We recover P by checking prevPending→B.  P gets committed, H is discarded.
   */
  private prevPendingCanonicalEntry: CanonicalHistoryEntry | null = null;
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

  private getLastEngineState(): LiveAssistEngineState {
    return {
      engineSan: this.lastEngineSan,
      engineLan: this.lastEngineLan,
      engineFrom: this.lastEngineFrom,
      engineTo: this.lastEngineTo,
      engineEval: this.lastEngineEval,
      engineMate: this.lastEngineMate,
    };
  }

  private applyLastEngineState(engine: LiveAssistEngineState): void {
    this.lastEngineSan = engine.engineSan;
    this.lastEngineLan = engine.engineLan;
    this.lastEngineFrom = engine.engineFrom;
    this.lastEngineTo = engine.engineTo;
    this.lastEngineEval = engine.engineEval;
    this.lastEngineMate = engine.engineMate;
  }

  private clearLastEngineState(): void {
    this.applyLastEngineState(emptyEngineState());
  }

  private sanitizeInsightText(text: string): string {
    return sanitizeInsightText(text);
  }

  private getFenCandidates(text: string) {
    if (hasNoBoardRawBoard(text)) {
      log.debug('[LiveAssist] getFenCandidates: LLM reported NO_BOARD - no main chess board visible, skipping frame');
      this.lastChessBoard = null;
      this.lastChessTurn = null;
      this.emit('no-board');
      return [];
    }

    const candidates = extractFenCandidatesFromText(text, {
      sanitizeText: (value) => this.sanitizeInsightText(value),
    });

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

  private extractFenFromText(text: string): string | null {
    const candidates = this.getFenCandidates(text);
    if (candidates.length === 0) return null;
    return candidates[0].fen;
  }

  private extractLatestFen(visuals: VisualIndexChunk[]): string | null {
    return selectLatestFenFromVisuals({
      visuals,
      getFenCandidates: (text) => this.getFenCandidates(text),
      sanitizeText: (value) => this.sanitizeInsightText(value),
      debug: (data, message) => log.debug(data, message),
    });
  }


  private resetChessSessionState(): void {
    this.lastChessSignature = null;
    this.lastChessBoard = null;
    this.lastChessTurn = null;
    this.lastChessPerspective = 'white';
    this.lastFenForMoveHistory = null;
    this.plausibilityRejectStreak = 0;
    this.userFlippedTurn = false;
    // NOTE: totalMoveCount is intentionally NOT reset here — it is reset in
    // start() so that stop() → copilot reads the count before a new session zeros it.
    this.clearLastEngineState();
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
  ): { history: CanonicalHistoryEntry[]; resolvedSan?: string; resolvedTurn?: 'w' | 'b' } {
    const state = {
      canonicalMoveHistory: this.canonicalMoveHistory,
      pendingCanonicalEntry: this.pendingCanonicalEntry,
      prevPendingCanonicalEntry: this.prevPendingCanonicalEntry,
    };
    const result = updateCanonicalHistoryState(state, board, fen);
    this.canonicalMoveHistory = state.canonicalMoveHistory;
    this.pendingCanonicalEntry = state.pendingCanonicalEntry;
    this.prevPendingCanonicalEntry = state.prevPendingCanonicalEntry;
    return result;
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
    return buildCanonicalMoveHistorySnapshot(this.canonicalMoveHistory);
  }

  /**
   * Build the win-probability snapshot from committed canonical history plus
   * the currently pending entry. Pending points self-heal because every emit
   * rebuilds from the current canonical state.
   */
  private getWinProbabilitySnapshot(): WinProbabilityPoint[] {
    return buildWinProbabilitySnapshot(this.canonicalMoveHistory, this.pendingCanonicalEntry);
  }

  /** Stamp engine win-probability data onto the canonical or pending entry for `board`. */
  private stampWinChanceAtStage1(
    board: string,
    winChance: number | undefined,
    turn: 'w' | 'b' | undefined,
    moveSan: string | undefined,
  ): boolean {
    const result = stampWinChance({
      canonicalMoveHistory: this.canonicalMoveHistory,
      pendingCanonicalEntry: this.pendingCanonicalEntry,
      lastChessBoard: this.lastChessBoard,
      board,
      winChance,
      turn,
      moveSan,
    });

    if (result.stamped) {
      log.debug(
        { board: board.slice(0, 30), winChance, moveSan: result.moveSan, entryIdx: result.entryIdx, slot: result.slot },
        '[LiveAssist] Stage-1: stamped winChance onto canonical history'
      );
    } else {
      log.debug(
        { board: board.slice(0, 30) },
        '[LiveAssist] Stage-1: board not found in committed history or pending - winChance not stamped'
      );
    }

    return result.stamped;
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

  private recordPositionForHistory(fen: string, san?: string): void {
    const state = {
      positionBuffer: this.positionBuffer,
      committedPositionHistory: this.committedPositionHistory,
    };
    updatePositionHistory(state, fen, san, {
      debug: (data, message) => log.debug(data, message),
      warn: (data, message) => log.warn(data, message),
    });
    this.positionBuffer = state.positionBuffer;
    this.committedPositionHistory = state.committedPositionHistory;
  }

  private getCastlingRightsString(): string {
    return getCastlingRightsString(this.castlingRights);
  }

  private updateCastlingRightsFromBoard(board: string): void {
    const hadSeenInitial = this.hasSeenInitialChessPosition;
    const update = updateCastlingRightsFromBoard(
      board,
      this.castlingRights,
      this.hasSeenInitialChessPosition,
    );
    this.castlingRights = update.castlingRights;
    this.hasSeenInitialChessPosition = update.hasSeenInitialChessPosition;
    if (!hadSeenInitial && this.hasSeenInitialChessPosition) {
      log.debug('[LiveAssist] Initial chess board detected - castling rights (re)seeded to KQkq');
    }
  }


  private applyNextTurnToFen(fen: string, visuals?: VisualIndexChunk[]): { fen: string; board: string; turn: 'w' | 'b' } {
    return resolveFenTurn({
      fen,
      visuals,
      lastChessTurn: this.lastChessTurn,
      lastChessPerspective: this.lastChessPerspective,
      castling: this.getCastlingRightsString(),
      debug: (data, message) => log.debug(data, message),
    });
  }

  private extractLatestChessMove(visuals: VisualIndexChunk[]): { san?: string; uci?: string } {
    return extractLatestChessMove(visuals);
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
    const topLines = await engine.getTopLines(resolvedFen.fen, {
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
    const fenEvent = buildLiveAssistFenEvent({
      fen: whitePerspFen,
      board: this.lastChessBoard,
      turn: flipped,
      boardOrientation: this.lastChessPerspective,
      engine: this.getLastEngineState(),
      winProbabilitySnapshot: this.getWinProbabilitySnapshot(),
      extras: { isFlipAck: true },
    });
    log.info({ fen: fenEvent.fen.slice(0, 40), displayFen: fenEvent.displayFen.slice(0, 40), turn: flipped, isFlipAck: true }, '[LiveAssist] emitting fen event (flipTurn)');
    this.emit('fen', fenEvent);

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

    const fullFen = this.lastChessBoard
      ? this.applyNextTurnToFen(this.lastChessBoard).fen
      : null;
    const recentTips = Array.from(this.previousSayThis).slice(-3);
    const chatPrompt = buildLiveAssistChatPrompt({
      question,
      tipContext,
      fullFen,
      perspective: this.lastChessPerspective,
      gameGoals: this.meetingContext?.description,
      recentTips,
      coachPersonalityId: this.activeCoachPersonalityId,
    });

    log.info({
      questionLength: question.length,
      hasTipContext: chatPrompt.hasTipContext,
      hasFen: chatPrompt.hasFen,
      recentTipCount: chatPrompt.recentTipCount,
    }, '[LiveAssist] Chat question received');

    const response = await llm.complete(chatPrompt.userPrompt, chatPrompt.systemPrompt, 30000, GPT_54_MODEL);

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
    log.info({ fenBoard: fenBoard.slice(0, 40), perspective, reportedTurn, isRunning: this.isRunning }, '[LiveAssist] injectConfirmedFen called');
    if (!this.isRunning) {
      log.warn('[LiveAssist] injectConfirmedFen: REJECTED at isRunning gate — service is not running');
      return false;
    }

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
    if (!isValidFenBoard(fenBoard) || !isSemanticFenValid(fenBoard)) {
      const diagnostics = buildSemanticRejectDiagnostics(fenBoard);
      log.warn(
        { fenBoard: fenBoard.slice(0, 40), ...diagnostics },
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
    if (!isBoardPlausible(this.lastChessBoard, fenBoard)) {
      this.plausibilityRejectStreak += 1;
      const curr = countBoardPieces(fenBoard);
      const prev = this.lastChessBoard ? countBoardPieces(this.lastChessBoard) : null;
      log.warn(
        {
          fenBoard: fenBoard.slice(0, 40),
          lastBoard: (this.lastChessBoard ?? '').slice(0, 40),
          streak: this.plausibilityRejectStreak,
          currPieceCounts: curr,
          prevPieceCounts: prev,
        },
        '[LiveAssist] injectConfirmedFen: board rejected by plausibility check — waiting for next frame'
      );
      if (this.plausibilityRejectStreak >= PLAUSIBILITY_REJECT_LIMIT) {
        log.warn(
          { streak: this.plausibilityRejectStreak },
          '[LiveAssist] injectConfirmedFen: plausibility reject limit reached — resetting lastChessBoard to escape deadlock'
        );
        this.lastChessBoard = null;
        this.plausibilityRejectStreak = 0;
      }
      return false;
    }

    // ── Initial position: always White's turn ────────────────────────────────
    // The starting position is deterministic — White always moves first.
    // Override any LLM-reported or heuristic-derived turn to prevent the
    // perspective seed or a stale lastChessTurn from setting it to 'b'.
    if (fenBoard === INITIAL_CHESS_BOARD) {
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
      const fenEvent = buildLiveAssistFenEvent({
        fen: whitePerspectiveFen,
        board: fenBoard,
        turn: inferredTurn,
        boardOrientation: perspective,
        engine: this.getLastEngineState(),
        winProbabilitySnapshot: this.getWinProbabilitySnapshot(),
      });
      // Do NOT set firstSeenFen here — the starting position is not useful for
      // opening identification. We wait for the first real move (non-initial board)
      // to capture the actual opening position. If the game is recorded from the
      // very first move, getFirstFen() will return the post-first-move FEN.
      log.info({ fen: fenEvent.fen.slice(0, 40), displayFen: fenEvent.displayFen.slice(0, 40), turn: inferredTurn, listenerCount: this.listenerCount('fen') }, '[LiveAssist] emitting fen event (initial position)');
      this.emit('fen', fenEvent);
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
    const turnResolution = resolveConfirmedFenTurn({
      fenBoard,
      perspective,
      lastChessBoard: this.lastChessBoard,
      lastChessTurn: this.lastChessTurn,
      reportedTurn,
      reportedLastMoveFrom,
      reportedLastMoveTo,
    });

    if (turnResolution.invalidMovePair) {
      log.warn(
        { from: reportedLastMoveFrom, to: reportedLastMoveTo, fenBoard: fenBoard.slice(0, 40) },
        '[TurnDetect] injectConfirmedFen: move pair failed FEN validation (neither/both squares empty) — discarding T2a signal'
      );
    }

    if (turnResolution.gridReportedDisagree) {
      log.warn(
        { gridDerivedTurn: turnResolution.gridDerivedTurn, reportedTurn, fenBoard: fenBoard.slice(0, 40) },
        '[TurnDetect] T2a (grid) and T2b (<turn> tag) disagree — discarding T2a, using T2b'
      );
    }

    const {
      inferredTurn,
      gridDerivedTurn,
      effectiveGridDerivedTurn,
      llmTurn,
      boardDiffTurn,
      tierUsed,
    } = turnResolution;

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
    const fenEvent = buildLiveAssistFenEvent({
      fen: whitePerspectiveFen,
      board: fenBoard,
      turn: inferredTurn,
      boardOrientation: perspective,
      engine: this.getLastEngineState(),
      winProbabilitySnapshot: this.getWinProbabilitySnapshot(),
      extras: {
        playedMoveSan: finalPlayedSan,
        playedTurn: finalPlayedTurn,
        moveHistorySnapshot,
      },
    });

    // Win-probability chart eligibility is owned by canonical history. Stage-1
    // stamping attaches points only to committed or pending canonical entries.

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

    log.info({ fen: fenEvent.fen.slice(0, 40), displayFen: fenEvent.displayFen.slice(0, 40), turn: inferredTurn, listenerCount: this.listenerCount('fen') }, '[LiveAssist] emitting fen event');
    this.emit('fen', fenEvent);

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
    const actionableText = stripNonActionableVisualText(
      normalizedText || text,
      (value) => this.sanitizeInsightText(value),
    );
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
   * Route RTStream WebSocket messages containing chess FEN XML tags through
   * the raw (tag-preserving) path so that extractLatestFen() can parse
   * <raw_board>, <board_mapping>, and <perspective> tags.
   *
   * Unlike addVisualIndex() which runs stripNonActionableVisualText() and can
   * mangle structured multi-line XML, this method stores the text verbatim
   * (same as addVisualIndexRaw() for screenshot-path injections).
   *
   * A lightweight math validation is applied before buffering so malformed
   * RTStream FEN payloads cannot pollute the voting window.
   */
  public addVisualIndexFen(text: string, _source: 'rtstream'): void {
    if (!this.isRunning) return;

    const prepared = prepareRtstreamFenVisualText(text);

    if ('dropReason' in prepared) {
      log.debug({ reason: prepared.dropReason }, '[LiveAssist] addVisualIndexFen: dropping invalid RTStream FEN payload');
      return;
    }

    this.lastRtstreamFenBoard = prepared.normalizedFenBoard;
    this.addVisualIndexRaw(prepared.taggedText);
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

    const freshGameplayVisuals = newVisuals.filter((v) => !isNonActionableVisualText(v.text));
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
    const filteredRecentVisuals = recentVisuals.filter((v) => !isNonActionableVisualText(v.text));
    const filteredFocusedVisuals = focusedVisuals.filter((v) => !isNonActionableVisualText(v.text));
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
    if (!isLikelyGameplayFeed(recentTexts)) {
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
      const {
        sideToMove,
        sideToMoveLabel,
        justMovedLabel,
      } = resolveLiveAssistTurnContext({
        perspective: this.lastChessPerspective,
        justMoved: chessContext.turn,
      });

      // Update state + clear stale engine data before emitting FEN.
      if (chessSignature) {
        this.lastChessSignature = chessSignature;
        this.lastChessBoard = chessContext.board || chessSignature;
        this.lastChessTurn = sideToMove;
        // Clear previous engine move — there is no best move in a terminal position.
        this.clearLastEngineState();
        this.pendingChessSignature = null;
        this.pendingChessSignatureCount = 0;
        const whitePerspFen = chessContext.fen;
        const fenEvent = buildLiveAssistFenEvent({
          fen: whitePerspFen,
          board: this.lastChessBoard,
          turn: sideToMove,
          boardOrientation: this.lastChessPerspective,
          engine: {},
          winProbabilitySnapshot: this.getWinProbabilitySnapshot(),
        });
        log.info({ fen: fenEvent.fen.slice(0, 40), displayFen: fenEvent.displayFen.slice(0, 40), turn: sideToMove }, '[LiveAssist] emitting fen event (processTranscriptInner — terminal/mate)');
        this.emit('fen', fenEvent);
      }
      this.lastProcessedTimestamp = now;

      const terminalPrompt = buildTerminalPrompt({
        description: this.meetingContext?.description,
        chessContext,
        terminal,
        sideToMoveLabel,
        justMovedLabel,
      });
      this.coachingInFlight = true;
      void this.runCoachingLLM(chessContext, chessSignature, terminalPrompt, null, trackedCycleId);
      return;
    }
    // lastChessPerspective = which side the player is playing as (board orientation).
    // chessContext.turn   = side that JUST MOVED (flipped in buildChessContext for accuracy tagging).
    // sideToMove          = who is to move NEXT = opposite of chessContext.turn.
    const {
      sideToMove,
      isPlayerTurn,
      playerColorLabel,
      opponentColorLabel,
    } = resolveLiveAssistTurnContext({
      perspective: this.lastChessPerspective,
      justMoved: chessContext?.turn,
    });

    // If it is the opponent's turn, run a threat-analysis LLM call:
    // explain what the opponent's best move threatens and what the player must watch out for.
    if (!isPlayerTurn) {
      const bestOppMove = parseEngineSummaryMove(chessContext?.engineSummary);
      const bestOppMoveSan = bestOppMove.san;

      // Immediate engine-only fallback shown while LLM runs
      if (this.activeGameId === 'chess' && chessContext?.engineSummary) {
        if (trackedCycleId !== undefined) pipelineLatency.startStep(trackedCycleId, 'engineTip');
        this.emit('insights', {
          insights: { say_this: [formatEngineSummaryTip(chessContext.engineSummary)], ask_this: [] },
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
        this.applyLastEngineState(engineStateFromContext(chessContext));
        this.pendingChessSignature = null;
        this.pendingChessSignatureCount = 0;
        const whitePerspFen = chessContext?.fen || `${chessSignature} ${sideToMove} - - 0 1`;
        // Stage-1 stamp: attach winChance to the canonical entry NOW so the live
        // chart updates immediately rather than waiting for the LLM to complete.
        this.stampWinChanceAtStage1(
          chessContext?.board ?? '',
          chessContext?.winChance,
          chessContext?.turn,
          chessContext?.playedMoveSan,
        );
        const fenEvent = buildLiveAssistFenEvent({
          fen: whitePerspFen,
          board: this.lastChessBoard,
          turn: sideToMove,
          boardOrientation: this.lastChessPerspective,
          engine: this.getLastEngineState(),
          winProbabilitySnapshot: this.getWinProbabilitySnapshot(),
        });
        log.info({ fen: fenEvent.fen.slice(0, 40), displayFen: fenEvent.displayFen.slice(0, 40), turn: sideToMove, engineSan: this.lastEngineSan }, '[LiveAssist] emitting fen event (processTranscriptInner — stage-1 engine)');
        this.emit('fen', fenEvent);
      }
      this.lastProcessedTimestamp = now;

      // Fire threat-analysis LLM in the background so the player sees WHY the
      // opponent's best move is dangerous and what to watch out for next turn.
      if (chessContext && bestOppMoveSan) {
        const bestOppMoveLan = bestOppMove.lan;
        const oppPieceDesc = (chessContext.board && bestOppMoveLan)
          ? describeMovingPiece(chessContext.board, bestOppMoveLan)
          : null;
        const threatPrompt = buildOpponentThreatPrompt({
          description: this.meetingContext?.description,
          chessContext,
          playerColorLabel,
          opponentColorLabel,
          bestOppMoveSan,
          opponentPieceDescription: oppPieceDesc,
        });
        this.coachingInFlight = true;
        void this.runCoachingLLM(chessContext, chessSignature, threatPrompt, bestOppMoveSan, trackedCycleId);
      } else {
        endCycleIfTracked('opponentTurnNoMove');
      }
      return;
    }

    // Emit an immediate engine-only tip so the user sees something instantly.
    if (this.activeGameId === 'chess' && chessContext?.engineSummary) {
      if (trackedCycleId !== undefined) pipelineLatency.startStep(trackedCycleId, 'engineTip');
      this.emit('insights', {
        insights: { say_this: [formatEngineSummaryTip(chessContext.engineSummary)], ask_this: [] },
        processedAt: Date.now(),
        clearExisting: true,
        isFlipAck: this.userFlippedTurn,
      });
      if (trackedCycleId !== undefined) pipelineLatency.endStep(trackedCycleId, 'engineTip');
      log.debug({ chessSignature }, '[LiveAssist] Emitted immediate engine-only tip while coaching LLM runs');
    }

    const bestMove = parseEngineSummaryMove(chessContext?.engineSummary);
    const bestMoveSan = bestMove.san;
    const bestMoveLan = bestMove.lan;
    const movingPieceDesc = (chessContext?.board && bestMoveLan)
      ? describeMovingPiece(chessContext.board, bestMoveLan)
      : null;

    const { prompt: userPrompt, hasChessSection } = buildPlayerBestMovePrompt({
      description: this.meetingContext?.description,
      chessContext,
      playerColorLabel,
      bestMoveSan,
      movingPieceDescription: movingPieceDesc,
    });
    log.info({ visualCount: promptVisuals.length, hasVisual: hasChessSection }, 'Processing gameplay feed for live assist');
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
      this.applyLastEngineState(engineStateFromContext(chessContext));
      this.pendingChessSignature = null;
      this.pendingChessSignatureCount = 0;
      const whitePerspFen = chessContext?.fen || `${chessSignature} ${this.lastChessTurn || 'w'} - - 0 1`;
      // Stage-1 stamp: attach winChance to the canonical entry NOW so the live
      // chart updates immediately rather than waiting for the LLM to complete.
      this.stampWinChanceAtStage1(
        chessContext?.board ?? '',
        chessContext?.winChance,
        chessContext?.turn,
        computedPlayedSan ?? chessContext?.playedMoveSan,
      );
      const fenEvent = buildLiveAssistFenEvent({
        fen: whitePerspFen,
        board: this.lastChessBoard,
        turn: this.lastChessTurn,
        boardOrientation: this.lastChessPerspective,
        engine: this.getLastEngineState(),
        winProbabilitySnapshot: this.getWinProbabilitySnapshot(),
      });
      log.info({ fen: fenEvent.fen.slice(0, 40), displayFen: fenEvent.displayFen.slice(0, 40), turn: this.lastChessTurn, engineSan: this.lastEngineSan }, '[LiveAssist] emitting fen event (processTranscriptInner — player turn)');
      this.emit('fen', fenEvent);
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
      const { parsed: coachingInsights } = await requestCoachingInsights({
        coachPersonalityId: this.activeCoachPersonalityId,
        userPrompt,
        bestMoveSan,
        chessContext,
        sanitizeInsightText: (text) => this.sanitizeInsightText(text),
        startCoachingLlm: () => startStep('coachingLLM'),
        endCoachingLlm: () => endStep('coachingLLM'),
      });

      // Discard if position has moved on
      if (chessSignature && chessSignature !== this.lastChessSignature) {
        endCycle('coachingStale');
        log.debug({ chessSignature }, '[LiveAssist] Coaching response stale — position changed, discarding');
        return;
      }

      // Measure the full post-LLM tip generation path: JSON cleanup, parsing,
      // filtering, dedupe/cooldown checks, and the final emit if one occurs.
      startStep('coachingTip');

      if (!coachingInsights) {
        endStep('coachingTip', 'null response');
        endCycle('coachingNullResponse');
        log.warn('[LiveAssist] Coaching response null — keeping engine fallback');
        return;
      }

      const sayValue = String(coachingInsights.say_this ?? '');
      if (sayValue.trim().length <= 10) {
        endStep('coachingTip', 'short response');
        endCycle('coachingShortResponse');
        log.warn('[LiveAssist] Coaching response empty/short — keeping engine fallback');
        return;
      }

      const { finalSayThis, finalAskThis } = buildFinalCoachingOutput(
        coachingInsights,
        chessContext,
        (text) => this.sanitizeInsightText(text),
        (text) => this.previousSayThis.has(text),
        (text) => this.previousAskThis.has(text),
      );


      if (finalSayThis.length === 0 && finalAskThis.length === 0) {
        endStep('coachingTip', 'empty output');
        endCycle('coachingEmptyOutput');
        return;
      }

      // Cooldown check — don't replace a fresh tip
      const nowMs = Date.now();
      const nextTipNormalized = finalSayThis[0]?.toLowerCase().trim() || null;
      const isSameTip = !!nextTipNormalized && nextTipNormalized === this.currentVisibleTip;
      const nextInstructionSignature = getInstructionSignature(finalSayThis, finalAskThis);
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
        // WP fields are persisted for post-game accuracy and charts. The live
        // chart is driven by fen-event snapshots stamped onto canonical history.
        winChance:       chessContext?.winChance,
        winChanceBefore: chessContext?.winChanceBefore,
        engineEval:      chessContext?.engineEval,
        centipawnLoss:   chessContext?.centipawnLoss,
        turn:            chessContext?.turn ?? undefined,
        moveSan:      chessContext?.engineSan ?? chessContext?.playedMoveSan ?? undefined,
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
export type { MeetingContext, TranscriptChunk };

