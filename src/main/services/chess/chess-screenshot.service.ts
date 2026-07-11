/**
 * Chess Screenshot Service
 *
 * Captures the primary screen, crops the chess board, sends it to the vision
 * model for FEN extraction, then promotes stable positions into Live Assist.
 * The core scoring, hashing, and image helpers live in ../../lib/vision/chess-screenshot-core.
 */

import { desktopCapturer, screen } from 'electron';
import { logger } from '../../lib/logger';
import { pipelineLatency } from '../../lib/pipeline-latency';
import type { VoteMeta, PromotionMeta } from '../../lib/pipeline-latency';
import { detectChessBoard } from '../../lib/vision/board-detector';
import {
  sampleHash,
  scoreFenConfidence,
  sharpenImage,
  squareDeltaFenBoards,
  type VoteEntry,
} from '../../lib/vision/chess-screenshot-core';
import { DEBUG_FRAMES_ENABLED, getDebugDir, saveDebugFrame, saveRawScreenshot } from '../../lib/vision/chess-screenshot-debug';
import { fixRankTranspositions } from '../../lib/chess/fen-utils';
import { getLiveAssistService } from '../live-assist.service';
import { getLLMService } from '../llm/llm.service';
import { getGameFenPrompt, getGameTurnPrompt } from '../../../shared/config/game-coaching';
import {
  BURST_COUNT,
  BURST_INTERVAL_MS,
  CAPTURE_TICK_TIMEOUT_MS,
  FEN_VOTE_THRESHOLD,
  FEN_VOTE_WINDOW,
  MAX_CONCURRENT_EXTRACTIONS,
  MAX_STALE_VOTE_CYCLES,
  SCREENSHOT_INTERVAL_MS,
  STABLE_JUMP_ACCEPT_LIMIT,
  TEMPORAL_REJECT_LIMIT,
} from './chess-screenshot/chess-screenshot.constants';
import {
  countPiecesInFenBoard,
  getEffectiveMaxSquareDelta,
  hasBothKingsInFenBoard,
  isPerspectiveFlipFenBoard,
} from './chess-screenshot/chess-screenshot-guards';

const log = logger.child({ module: 'chess-screenshot' });
// Frame deduplication
//
// Before calling the vision LLM, compute a fast hash of the PNG buffer to
// detect frames that are pixel-for-pixel identical to the previous one.
// On a static board this skips the ~6 s fenExtract call entirely.
//
// Implementation: sample every FRAME_HASH_STRIDE-th byte and SHA-1 the sample.
// On a 6 MB PNG (~6 million bytes) with stride 512 that's ~11,700 bytes hashed
// - takes < 1 ms and catches any real board change.
//
// Burst captures always bypass the check so the vote window fills correctly
// after a move.


class ChessScreenshotService {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private fenPrompt = '';
  private turnPrompt = '';
  /** Number of concurrent fenExtract model calls currently in-flight. */
  private inFlightCount = 0;

  // Majority-vote ring buffer
  private fenVoteBuffer: VoteEntry[] = [];
  private lastConfirmedFen: string | null = null;

  // Burst state
  private burstPending = false;

  // Debug frame sequence counter
  private debugSeq = 0;

  // Frame deduplication - hash of the last PNG sent to the LLM
  private lastFrameHash: string | null = null;

  // Latency: per-FEN vote metadata keyed by fenBoard string.
  // Stores both the wall-clock time of vote read 1 (seenAt) and how long
  // that extraction took (fenExtract1Ms) so the confirming cycle can report
  // the full fenStabilization phase duration.
  // Entries are evicted when a FEN is promoted or when its buffer slot is
  // overwritten, keeping memory bounded at FEN_VOTE_WINDOW entries.
  private fenVoteMeta = new Map<string, VoteMeta>();

  /** Consecutive temporal consistency rejections - reset when a frame passes. */
  private temporalRejectStreak = 0;
  /** Last large-delta board rejected by the temporal gate. */
  private lastTemporalRejectedFen: string | null = null;
  /** Number of times the same large-delta board has been rejected. */
  private temporalRejectedSameFenCount = 0;
  /** Last accepted board that the large-delta candidate was compared against. */
  private temporalRejectedAgainstFen: string | null = null;

  /** Consecutive vote-buffer cycles without consensus. */
  private voteStaleCycles = 0;
// Public API
  start(): void {
    if (this.isRunning) {
      log.warn('Chess screenshot service already running');
      return;
    }

    this.fenPrompt  = getGameFenPrompt('chess');
    this.turnPrompt = getGameTurnPrompt('chess');
    this.isRunning = true;
    this.inFlightCount = 0;
    this.fenVoteBuffer = [];
    this.lastConfirmedFen = null;
    this.burstPending = false;
    this.debugSeq = 0;
    this.lastFrameHash = null;
    this.fenVoteMeta.clear();
    this.temporalRejectStreak = 0;
    this.lastTemporalRejectedFen = null;
    this.temporalRejectedSameFenCount = 0;
    this.temporalRejectedAgainstFen = null;
    this.voteStaleCycles = 0;

    if (DEBUG_FRAMES_ENABLED) {
      log.info({ dir: getDebugDir() }, '[ChessScreenshot] Debug frame saving ENABLED');
    }

    log.info({ intervalMs: SCREENSHOT_INTERVAL_MS }, '[ChessScreenshot] Starting screenshot loop for direct FEN extraction');

    void this.captureAndExtract();
    this.timer = setInterval(() => {
      void this.captureAndExtract();
    }, SCREENSHOT_INTERVAL_MS);
  }

  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.fenVoteBuffer = [];
    this.lastConfirmedFen = null;
    this.burstPending = false;
    this.lastFrameHash = null;
    this.fenVoteMeta.clear();
    this.temporalRejectStreak = 0;
    this.lastTemporalRejectedFen = null;
    this.temporalRejectedSameFenCount = 0;
    this.temporalRejectedAgainstFen = null;
    this.voteStaleCycles = 0;

    log.info('[ChessScreenshot] Screenshot loop stopped');
  }
// Temporal consistency
  //
  // A single chess move changes at most 4 squares (castling: king + rook, both
  // origin and destination). If a newly voted FEN differs from the last confirmed
  // FEN by more than MAX_SQUARE_DELTA squares it almost certainly represents a
  // visual hallucination or a mid-animation snapshot rather than a real move.
  // We reject it so the vote buffer resets and the pipeline waits for a stable frame.
  //
  // The threshold is set to 6 to give a small margin above the theoretical max (4)
  // while still catching runaway piece-cluster hallucinations (which typically
  // produce 8---20 square changes in the benchmark failure cases).
// Vote helpers
  private pushToVoteBuffer(entry: VoteEntry): void {
    // Record vote-read-1 metadata the first time this fenBoard appears.
    // Subsequent reads of the same board don't overwrite it - the first
    // extraction is the true start of the fenStabilization phase.
    if (!this.fenVoteMeta.has(entry.fenBoard)) {
      this.fenVoteMeta.set(entry.fenBoard, {
        seenAt: entry.seenAt,
        fenExtract1Ms: entry.fenExtractMs,
      });
    }
    this.fenVoteBuffer.push(entry);
    if (this.fenVoteBuffer.length > FEN_VOTE_WINDOW) {
      const evicted = this.fenVoteBuffer.shift();
      // If the evicted FEN is no longer referenced by any remaining entry,
      // remove it from the meta map to keep memory bounded.
      if (evicted && !this.fenVoteBuffer.some(e => e.fenBoard === evicted.fenBoard)) {
        this.fenVoteMeta.delete(evicted.fenBoard);
      }
    }
  }

  private computeVotedFen(): VoteEntry | null {
    if (this.fenVoteBuffer.length === 0) return null;

    const counts = new Map<string, number>();
    for (const entry of this.fenVoteBuffer) {
      counts.set(entry.fenBoard, (counts.get(entry.fenBoard) ?? 0) + 1);
    }

    let bestFen: string | null = null;
    let bestCount = 0;
    for (const [fen, count] of counts) {
      if (count > bestCount) {
        bestCount = count;
        bestFen = fen;
      }
    }

    if (bestCount >= FEN_VOTE_THRESHOLD && bestFen !== null) {
      const matchingEntries = [...this.fenVoteBuffer]
        .filter((e) => e.fenBoard === bestFen);

      // Prefer the entry with grid-based last-move coordinates (most reliable turn signal).
      // Fall back to entries with a <turn> tag, then any matching entry.
      // Always use the LATEST entry within each category - earlier entries may have been
      // captured before the highlight fully settled on screen.
      const withGrid = matchingEntries.filter(
        (e) => e.reportedLastMoveFrom !== null && e.reportedLastMoveTo !== null
      );
      const withTurn = matchingEntries.filter((e) => e.reportedTurn !== null);
      return withGrid[withGrid.length - 1] ?? withTurn[withTurn.length - 1] ?? matchingEntries[matchingEntries.length - 1] ?? null;
    }
    return null;
  }

  private findLatestStaleJumpCandidate(): VoteEntry | null {
    if (this.lastConfirmedFen === null) return null;

    for (let i = this.fenVoteBuffer.length - 1; i >= 0; i -= 1) {
      const entry = this.fenVoteBuffer[i];
      if (!entry) continue;
      if (!hasBothKingsInFenBoard(entry.fenBoard)) continue;
      if (isPerspectiveFlipFenBoard(entry.fenBoard)) continue;

      const delta = squareDeltaFenBoards(entry.fenBoard, this.lastConfirmedFen);
      const maxDelta = getEffectiveMaxSquareDelta(entry.fenBoard);
      if (delta > maxDelta) {
        return entry;
      }
    }

    return null;
  }

  /**
   * Check temporal consistency of a candidate FEN against the last confirmed FEN.
   * A real chess move changes at most 4 squares; more than MAX_SQUARE_DELTA
   * indicates a hallucination or mid-animation frame.
   *
   * Returns true when the candidate passes (should be promoted).
   * Returns false when it fails - also purges the vote buffer and ends the
   * pipeline cycle so the caller can return immediately.
   */
  private checkTemporalConsistency(
    fenBoard: string,
    isInitialBoard: boolean,
    cycleId: number,
    logLabel: string,
    stableDetections = 1,
  ): boolean {
    if (this.lastConfirmedFen === null || isInitialBoard) return true;

    // Endgame delta tightening: when - 12 pieces remain, reduce max
    // from 6 to 3 - large deltas in sparse positions are always hallucinations.
    const pieceCount = countPiecesInFenBoard(fenBoard);
    const maxDelta = getEffectiveMaxSquareDelta(fenBoard);

    const delta = squareDeltaFenBoards(fenBoard, this.lastConfirmedFen);
    if (delta > maxDelta) {
      const hasBothKings = hasBothKingsInFenBoard(fenBoard);
      this.temporalRejectStreak += 1;
      if (
        this.lastTemporalRejectedFen === fenBoard &&
        this.temporalRejectedAgainstFen === this.lastConfirmedFen
      ) {
        this.temporalRejectedSameFenCount += 1;
      } else {
        this.lastTemporalRejectedFen = fenBoard;
        this.temporalRejectedAgainstFen = this.lastConfirmedFen;
        this.temporalRejectedSameFenCount = 1;
      }

      const stableJumpEvidence = Math.max(this.temporalRejectedSameFenCount, stableDetections);
      if (stableJumpEvidence >= STABLE_JUMP_ACCEPT_LIMIT && hasBothKings) {
        log.warn(
          {
            delta,
            max: maxDelta,
            pieceCount,
            hasBothKings,
            votedFen: fenBoard,
            prevFen: this.lastConfirmedFen,
            repeated: this.temporalRejectedSameFenCount,
            stableDetections,
          },
          `[ChessScreenshot] ${logLabel} accepting stable large-delta board after repeated detections`
        );
        this.temporalRejectStreak = 0;
        this.lastTemporalRejectedFen = null;
        this.temporalRejectedSameFenCount = 0;
        this.temporalRejectedAgainstFen = null;
        return true;
      }

      log.warn(
        {
          delta,
          max: maxDelta,
          pieceCount,
          hasBothKings,
          votedFen: fenBoard,
          prevFen: this.lastConfirmedFen,
          streak: this.temporalRejectStreak,
          repeated: this.temporalRejectedSameFenCount,
          stableDetections,
        },
        `[ChessScreenshot] ${logLabel} temporal consistency REJECT - large delta, likely hallucination`
      );
      if (this.temporalRejectStreak >= TEMPORAL_REJECT_LIMIT) {
        log.warn(
          { streak: this.temporalRejectStreak },
          `[ChessScreenshot] ${logLabel} temporal reject limit reached - resetting lastConfirmedFen to escape deadlock`
        );
        this.lastConfirmedFen = null;
        this.temporalRejectStreak = 0;
      }
      this.fenVoteBuffer = [];
      this.fenVoteMeta.clear();
      pipelineLatency.endCycle(cycleId, 'temporalReject');
      return false;
    }
    this.temporalRejectStreak = 0;
    this.lastTemporalRejectedFen = null;
    this.temporalRejectedSameFenCount = 0;
    this.temporalRejectedAgainstFen = null;
    return true;
  }
// Burst confirmation
  private scheduleBurst(): void {
    if (this.burstPending) return;
    this.burstPending = true;

    let fired = 0;
    const fireNext = () => {
      if (!this.isRunning || fired >= BURST_COUNT) {
        this.burstPending = false;
        return;
      }
      fired += 1;
      log.debug({ fired, total: BURST_COUNT }, '[ChessScreenshot] Burst capture');
      void this.captureAndExtract(/* isBurst */ true);
      setTimeout(fireNext, BURST_INTERVAL_MS);
    };

    setTimeout(fireNext, BURST_INTERVAL_MS);
  }
// Main capture loop
  private async captureAndExtract(isBurst = false): Promise<void> {
    if (!this.isRunning) return;

    if (this.inFlightCount >= MAX_CONCURRENT_EXTRACTIONS) {
      log.debug(
        { inFlightCount: this.inFlightCount, max: MAX_CONCURRENT_EXTRACTIONS },
        '[ChessScreenshot] Skipping tick - concurrency limit reached'
      );
      return;
    }

    this.inFlightCount += 1;
    try {
      // Hard timeout: if doCapture hangs for any reason, release the slot
      // so the pipeline is never permanently stalled.
      await Promise.race([
        this.doCapture(isBurst),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('captureAndExtract tick timed out after 15s')), CAPTURE_TICK_TIMEOUT_MS)
        ),
      ]);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.warn({ error: msg }, '[ChessScreenshot] Capture tick failed or timed out - releasing inFlight slot');
    } finally {
      this.inFlightCount -= 1;
    }
  }

  private async doCapture(isBurst: boolean): Promise<void> {
    // Create a new pipeline latency cycle for this capture tick.
    const cycleId = pipelineLatency.newCycle();
// Step 1: Capture full primary screen
    pipelineLatency.startStep(cycleId, 'screenshot');

    // Use native display resolution for the thumbnail so the ONNX ML
    // detector and downstream vision model receive maximum pixel detail.
    const { width: thumbW, height: thumbH } = screen.getPrimaryDisplay().bounds;

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: thumbW, height: thumbH },
    });

    if (!sources.length) {
      log.warn('[ChessScreenshot] No screen sources available');
      pipelineLatency.endStep(cycleId, 'screenshot', 'no sources');
      pipelineLatency.endCycle(cycleId, 'noSources');
      return;
    }

    const thumbnail = sources[0].thumbnail;

    if (!thumbnail || thumbnail.isEmpty()) {
      log.warn('[ChessScreenshot] Screen thumbnail is empty');
      pipelineLatency.endStep(cycleId, 'screenshot', 'empty thumbnail');
      pipelineLatency.endCycle(cycleId, 'emptyThumbnail');
      return;
    }

    // Save raw full-screen frame under the same CHESS_DEBUG_FRAMES gate.
    if (DEBUG_FRAMES_ENABLED) {
      saveRawScreenshot(thumbnail, this.debugSeq, isBurst);
    }
// Step 2: Detect and crop the chess board
    // Run board detection on the full-resolution bitmap so the ONNX ML
    // detector (primary path) receives a properly detailed input.
    // The ML model internally resizes to 640--640 and scales coords back
    // to input space.  The fallback deterministic detector also operates
    // on full-res - its ~10---15 ms cost is negligible vs the 10---12 s LLM call.
    const fullSize = thumbnail.getSize();
    const bitmap = thumbnail.toBitmap();
    const bounds = await detectChessBoard(bitmap, fullSize.width, fullSize.height);
    const cropped = thumbnail.crop(bounds);
    let pngBuffer = cropped.toPNG();
    if (!pngBuffer || pngBuffer.length === 0) {
      log.warn('[ChessScreenshot] Failed to encode cropped board as PNG');
      pipelineLatency.endStep(cycleId, 'screenshot', 'PNG encode failed');
      pipelineLatency.endCycle(cycleId, 'pngEncodeFailed');
      return;
    }

    pngBuffer = await sharpenImage(pngBuffer, log);

    log.debug(
      { boardBounds: bounds, fullSize, pngBytes: pngBuffer.length },
      '[ChessScreenshot] Board cropped from full screen'
    );
    pipelineLatency.endStep(cycleId, 'screenshot');
// Frame deduplication
    // Hash a strided sample of the PNG buffer. If it matches the previous
    // frame AND this is not a burst capture, the board hasn't changed ---
    // skip the expensive vision LLM call entirely.
    const frameHash = sampleHash(pngBuffer);
    if (!isBurst && frameHash === this.lastFrameHash) {
      log.debug('[ChessScreenshot] Frame unchanged - skipping fenExtract');
      pipelineLatency.endCycle(cycleId, 'frameUnchanged');
      return;
    }
    this.lastFrameHash = frameHash;

    log.debug(
      { bytes: pngBuffer.length, isBurst, resolution: `${thumbW}x${thumbH}` },
      '[ChessScreenshot] Screenshot captured, sending to gpt-5.4 for FEN extraction'
    );

    // ------ Step 3: Parallel FEN + turn extraction ------------------------------------------------------------------------------------
    // Two independent vision calls run concurrently:
    //   FEN call  - extracts <perspective> + <raw_board>; retries once on math errors.
    //   Turn call - extracts <turn>, <last_move_from>, <last_move_to>.
    // Results are merged before entering the vote buffer.
    //
    // Exception: on the very first tick of a session (lastConfirmedFen === null) we
    // skip the turn call entirely.  At this point there is no last-move highlight on
    // the board (nothing has been played yet), so the turn call will always return null
    // move coordinates and frequently triggers an expensive post-merge retry.
    // live-assist.service.ts hardcodes turn='w' and seeds full castling rights (KQkq)
    // whenever it receives the initial board position, so the null turn is handled
    // correctly downstream.  Skipping saves ~10-12 s on first-board detection.
    const skipTurnCall = this.lastConfirmedFen === null;
    const llm = getLLMService();
    pipelineLatency.startStep(cycleId, 'fenExtract');
    const fenExtractStart = Date.now();
    const rawResult = await llm.extractFenAndTurnFromImage(
      pngBuffer,
      'image/png',
      this.fenPrompt,
      this.turnPrompt,
      cycleId,
      skipTurnCall,
    );
    const fenExtractMs = Date.now() - fenExtractStart;
// Step 3b: Debug frame seq increment
    if (DEBUG_FRAMES_ENABLED) {
      this.debugSeq += 1;
    }
// Step 5: Fix rank transpositions against last confirmed FEN
    if (rawResult === null) {
      pipelineLatency.endStep(cycleId, 'fenExtract', 'null result');
      pipelineLatency.endCycle(cycleId, 'fenNull');
      log.debug('[ChessScreenshot] FEN extraction returned null');

      if (DEBUG_FRAMES_ENABLED) {
        this.debugSeq += 1;
        saveDebugFrame({
          seq: this.debugSeq,
          pngBuffer,
          rawResult: null,
          voteBuffer: this.fenVoteBuffer,
          votedEntry: null,
          isBurst,
        });
      }
      return;
    }
    pipelineLatency.endStep(cycleId, 'fenExtract');
// Step 5: Fix rank transpositions against last confirmed FEN
    // Compare the new board rank-by-rank with the last confirmed position.
    // Ranks whose piece multiset matches the previous frame but have
    // different digit/piece arrangement (e.g. "bqp1" vs "bq1p") are fixed
    // before the result enters the confidence gate or vote buffer.
    let rankFixFrom: string | undefined;
    let rankFixTo: string | undefined;
    if (this.lastConfirmedFen !== null) {
      const fixedFen = fixRankTranspositions(rawResult.fenBoard, this.lastConfirmedFen);
      if (fixedFen !== rawResult.fenBoard) {
        rankFixFrom = rawResult.fenBoard;
        rankFixTo = fixedFen;
        log.info(
          { from: rawResult.fenBoard, to: fixedFen },
          '[ChessScreenshot] Rank transposition corrected against last confirmed FEN'
        );
        rawResult.fenBoard = fixedFen;
      }
    }

    // Stamp seenAt and fenExtractMs so pushToVoteBuffer can build VoteMeta
    // for the phase latency report on the confirming cycle.
    const voteEntry: VoteEntry = {
      ...rawResult,
      seenAt: Date.now(),
      fenExtractMs,
      noRetryNeeded: rawResult.noRetryNeeded,
      ...(rankFixFrom ? { rankFixApplied: true, rankFixFrom, rankFixTo } : {}),
    };
// Confidence gate
    // Score this result before touching the vote buffer. A high-confidence
    // result is promoted immediately - we skip the second confirmation read
    // entirely, cutting the dominant fenStabilization latency roughly in half.
    //
    // Low-confidence results fall through to the existing vote-buffer path
    // unchanged: they are pushed into the ring buffer and the cycle ends with
    // voteInconclusive, waiting for a subsequent tick to provide consensus.
    //
// Pre-gate: reject perspective-flipped hallucinations
    // Perspective flips (uppercase in top rank + lowercase in bottom rank)
    // are catastrophic LLM failures. Reject immediately - don't even enter
    // the vote buffer, because a single flipped FEN can pollute subsequent
    // frames via the rank-transposition fix and temporal consistency chain.
    if (isPerspectiveFlipFenBoard(voteEntry.fenBoard)) {
      log.warn(
        { fenBoard: voteEntry.fenBoard, fenRawText: (voteEntry.fenRawText ?? '').slice(0, 200) },
        '[ChessScreenshot] PERSPECTIVE FLIP detected - rejecting FEN immediately'
      );

      if (DEBUG_FRAMES_ENABLED) {
        voteEntry.perspectiveFlipRejected = true;
        voteEntry.confidenceDecision = 'rejected';
        voteEntry.confidenceReasons = ['perspectiveFlip'];
        saveDebugFrame({
          seq: this.debugSeq,
          pngBuffer,
          rawResult: voteEntry,
          voteBuffer: this.fenVoteBuffer,
          votedEntry: null,
          isBurst,
        });
      }
      pipelineLatency.endCycle(cycleId, 'perspectiveFlip');
      return;
    }
// Endgame delta tightening
    // When - 12 total pieces remain (endgame), the theoretical max delta per
    // move is still 4 squares, but in practice large deltas in endgames are
    // always hallucinations (sparse board - LLM misreads clusters of squares).
    // Reduce max square delta from 6 to 3 in endgame positions.
    const effectiveMaxDelta = getEffectiveMaxSquareDelta(voteEntry.fenBoard);
// RTStream cross-validation
    // If RTStream has a validated FEN from the same frame and it differs
    // by more than 4 squares from the screenshot FEN, demote to slow-path.
    // RTStream uses the same model+prompt through an independent pipeline,
    // so agreement is a strong signal of correctness; disagreement means
    // one of them is hallucinating - don't fast-path promote until we have
    // another vote.
    const rtFen = getLiveAssistService().lastRtstreamFenBoard;
    if (rtFen && rtFen !== voteEntry.fenBoard) {
      const rtDelta = squareDeltaFenBoards(voteEntry.fenBoard, rtFen);
      if (rtDelta > 4) {
        log.warn(
          { screenshotFen: voteEntry.fenBoard, rtstreamFen: rtFen, rtDelta },
          '[ChessScreenshot] RTStream disagrees with screenshot - demoting to slow-path'
        );

        if (DEBUG_FRAMES_ENABLED) {
          voteEntry.confidenceDecision = 'slow';
          voteEntry.confidenceReasons = [`rtstreamMismatch(delta=${rtDelta})`];
        }
        // Force low confidence - enters vote buffer instead of immediate promote
        this.pushToVoteBuffer(voteEntry);
        pipelineLatency.endCycle(cycleId, 'rtstreamMismatch');
        return;
      }
    }

    const confidence = scoreFenConfidence(
      voteEntry,
      this.lastConfirmedFen,
      effectiveMaxDelta,
    );

    if (confidence.high) {
// Fast path: promote immediately
      if (DEBUG_FRAMES_ENABLED) {
        voteEntry.confidenceDecision = 'fast';
        voteEntry.confidenceReasons = confidence.reasons;
      }

      const isInitialBoard = voteEntry.fenBoard === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

      // Skip if this board is already the last confirmed FEN and not the
      // initial board (same dedup logic as the vote path).
      if (voteEntry.fenBoard === this.lastConfirmedFen && !isInitialBoard) {
        pipelineLatency.startStep(cycleId, 'voteConfirm');
        pipelineLatency.endStep(cycleId, 'voteConfirm');
        pipelineLatency.endCycle(cycleId, 'fenUnchanged');
        log.debug({ votedFen: voteEntry.fenBoard }, '[ChessScreenshot] Fast-path: FEN unchanged - no push needed');

        if (DEBUG_FRAMES_ENABLED) {
          saveDebugFrame({
            seq: this.debugSeq,
            pngBuffer,
            rawResult: voteEntry,
            voteBuffer: this.fenVoteBuffer,
            votedEntry: null,
            isBurst,
          });
        }
        return;
      }

      // Temporal consistency gate applies on the fast-path too.
      if (!this.checkTemporalConsistency(voteEntry.fenBoard, isInitialBoard, cycleId, 'Fast-path')) {
        if (DEBUG_FRAMES_ENABLED) {
          voteEntry.confidenceReasons = [...(voteEntry.confidenceReasons ?? []), 'temporalReject'];
          saveDebugFrame({
            seq: this.debugSeq,
            pngBuffer,
            rawResult: voteEntry,
            voteBuffer: this.fenVoteBuffer,
            votedEntry: null,
            isBurst,
          });
        }
        return;
      }

      log.info(
        {
          votedFen: voteEntry.fenBoard,
          perspective: voteEntry.perspective,
          reportedTurn: voteEntry.reportedTurn,
          lastMoveFrom: voteEntry.reportedLastMoveFrom,
          lastMoveTo: voteEntry.reportedLastMoveTo,
          prevConfirmed: this.lastConfirmedFen,
          fastPath: true,
        },
        '[ChessScreenshot] HIGH confidence - fast-path promotion, skipping second read'
      );

      // Record voteConfirm step with near-zero cost (no second LLM call needed).
      pipelineLatency.startStep(cycleId, 'voteConfirm');
      pipelineLatency.endStep(cycleId, 'voteConfirm');

      // Build VoteMeta for this cycle: seenAt is this extraction's start time,
      // fenExtract1Ms is the single read's duration (no second read needed).
      const fastVoteMeta: VoteMeta = {
        seenAt: voteEntry.seenAt - voteEntry.fenExtractMs,
        fenExtract1Ms: voteEntry.fenExtractMs,
      };

      // Record how this FEN was promoted so the latency summary is accurate.
      const fastPromotionMeta: PromotionMeta = {
        promotionPath: 'fast',
        fenRetried:    !voteEntry.noRetryNeeded,
        turnTimedOut:  voteEntry.reportedTurn === null &&
                       voteEntry.reportedLastMoveFrom === null &&
                       voteEntry.reportedLastMoveTo   === null,
      };
      pipelineLatency.setPromotionMeta(cycleId, fastPromotionMeta);

      // Also push into the vote buffer so the next tick has a baseline entry.
      // This keeps the slow-path coherent if the next frame is low-confidence.
      this.pushToVoteBuffer(voteEntry);

      const liveAssist = getLiveAssistService();
      const accepted = liveAssist.injectConfirmedFen(
        voteEntry.fenBoard,
        voteEntry.perspective,
        voteEntry.reportedTurn,
        cycleId,
        fastVoteMeta,
        voteEntry.reportedLastMoveFrom,
        voteEntry.reportedLastMoveTo,
      );

      // Only update lastConfirmedFen if live-assist accepted the board.
      // Setting it before acceptance (Deadlock 2) would poison future ticks
      // if the board was rejected downstream (plausibility/semantic check).
      if (accepted) {
        this.lastConfirmedFen = voteEntry.fenBoard;
      } else {
        log.warn('[ChessScreenshot] Fast-path: injectConfirmedFen returned false - NOT updating lastConfirmedFen');
      }

      if (!isBurst) {
        this.scheduleBurst();
      }

      if (DEBUG_FRAMES_ENABLED) {
        voteEntry.confidenceReasons = [...(voteEntry.confidenceReasons ?? []), `accepted=${accepted}`];
        saveDebugFrame({
          seq: this.debugSeq,
          pngBuffer,
          rawResult: voteEntry,
          voteBuffer: this.fenVoteBuffer,
          votedEntry: voteEntry,
          isBurst,
        });
      }
      return;
    }
// Low confidence: fall through to existing vote-buffer slow-path
    if (DEBUG_FRAMES_ENABLED) {
      voteEntry.confidenceDecision = 'slow';
      voteEntry.confidenceReasons = confidence.reasons;
    }
    log.debug(
      { confidence: confidence.reasons, fenBoard: voteEntry.fenBoard.slice(0, 30) },
      '[ChessScreenshot] LOW confidence - using vote-buffer slow-path'
    );
// Step 5: Vote
    pipelineLatency.startStep(cycleId, 'voteConfirm');
    this.pushToVoteBuffer(voteEntry);
    const votedEntry = this.computeVotedFen();

    log.debug(
      {
        rawFen: rawResult.fenBoard,
        rawPerspective: rawResult.perspective,
        rawReportedTurn: rawResult.reportedTurn,
        rawLastMoveFrom: rawResult.reportedLastMoveFrom,
        rawLastMoveTo: rawResult.reportedLastMoveTo,
        votedFen: votedEntry?.fenBoard ?? null,
        bufferSize: this.fenVoteBuffer.length,
        window: FEN_VOTE_WINDOW,
        threshold: FEN_VOTE_THRESHOLD,
      },
      '[ChessScreenshot] FEN vote tick'
    );

    if (votedEntry === null) {
      this.voteStaleCycles += 1;
      if (this.voteStaleCycles >= MAX_STALE_VOTE_CYCLES) {
        const staleJumpEntry = this.findLatestStaleJumpCandidate();
        if (staleJumpEntry !== null) {
          pipelineLatency.endStep(cycleId, 'voteConfirm', 'staleJump');
          log.warn(
            {
              staleCycles: this.voteStaleCycles,
              staleJumpFen: staleJumpEntry.fenBoard,
              prevConfirmed: this.lastConfirmedFen,
              bufferSize: this.fenVoteBuffer.length,
            },
            '[ChessScreenshot] Vote buffer stale on large-delta boards - trying latest skipped-position candidate'
          );

          const voteMeta = this.fenVoteMeta.get(staleJumpEntry.fenBoard) ?? {
            seenAt: staleJumpEntry.seenAt,
            fenExtract1Ms: staleJumpEntry.fenExtractMs,
          };

          pipelineLatency.setPromotionMeta(cycleId, {
            promotionPath: 'slow',
            fenRetried: !staleJumpEntry.noRetryNeeded,
            turnTimedOut: staleJumpEntry.reportedTurn === null &&
                          staleJumpEntry.reportedLastMoveFrom === null &&
                          staleJumpEntry.reportedLastMoveTo === null,
          });

          const liveAssist = getLiveAssistService();
          const accepted = liveAssist.injectConfirmedFen(
            staleJumpEntry.fenBoard,
            staleJumpEntry.perspective,
            staleJumpEntry.reportedTurn,
            cycleId,
            voteMeta,
            staleJumpEntry.reportedLastMoveFrom,
            staleJumpEntry.reportedLastMoveTo,
          );

          this.fenVoteBuffer = [];
          this.fenVoteMeta.clear();
          this.voteStaleCycles = 0;

          if (accepted) {
            this.lastConfirmedFen = staleJumpEntry.fenBoard;
            if (!isBurst) {
              this.scheduleBurst();
            }
          } else {
            log.warn('[ChessScreenshot] Stale jump candidate rejected downstream - buffer flushed');
            pipelineLatency.endCycle(cycleId, 'staleJumpRejected');
          }

          if (DEBUG_FRAMES_ENABLED) {
            saveDebugFrame({
              seq: this.debugSeq,
              pngBuffer,
              rawResult: voteEntry,
              voteBuffer: this.fenVoteBuffer,
              votedEntry: staleJumpEntry,
              isBurst,
            });
          }
          return;
        }

        log.warn(
          { staleCycles: this.voteStaleCycles },
          '[ChessScreenshot] Vote buffer staleness limit reached - flushing buffer to escape deadlock'
        );
        this.fenVoteBuffer = [];
        this.fenVoteMeta.clear();
        this.voteStaleCycles = 0;
      }

      pipelineLatency.endStep(cycleId, 'voteConfirm', 'inconclusive');
      pipelineLatency.endCycle(cycleId, 'voteInconclusive');
      log.debug({ staleCycles: this.voteStaleCycles }, '[ChessScreenshot] Vote inconclusive - waiting for consensus');

      if (DEBUG_FRAMES_ENABLED) {
        saveDebugFrame({
          seq: this.debugSeq,
          pngBuffer,
          rawResult: voteEntry,
          voteBuffer: this.fenVoteBuffer,
          votedEntry: null,
          isBurst,
        });
      }
      return;
    }
    this.voteStaleCycles = 0;
    pipelineLatency.endStep(cycleId, 'voteConfirm');
// Step 6: Promote voted FEN if changed
    // Never skip the initial starting position: if the previous confirmed FEN
    // was also the initial board (e.g. game 1 just started), a new game starting
    // from the same position must still be pushed so live-assist can reseed
    // castling rights and other per-game state.
    const isInitialBoard = votedEntry.fenBoard === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
    if (votedEntry.fenBoard === this.lastConfirmedFen && !isInitialBoard) {
      pipelineLatency.endCycle(cycleId, 'fenUnchanged');
      log.debug({ votedFen: votedEntry.fenBoard }, '[ChessScreenshot] Voted FEN unchanged - no push needed');

      if (DEBUG_FRAMES_ENABLED) {
        saveDebugFrame({
          seq: this.debugSeq,
          pngBuffer,
          rawResult: voteEntry,
          voteBuffer: this.fenVoteBuffer,
          votedEntry: votedEntry,
          isBurst,
        });
      }
      return;
    }
// Temporal consistency gate
    // A real chess move changes at most 4 squares. If the new FEN differs from
    // the last confirmed FEN by more than MAX_SQUARE_DELTA squares, it is almost
    // certainly a hallucination or mid-animation snapshot. Reject it, clear the
    // vote buffer, and wait for a stable frame.
    const votedFenDetections = this.fenVoteBuffer.filter((entry) => entry.fenBoard === votedEntry.fenBoard).length;
    if (!this.checkTemporalConsistency(votedEntry.fenBoard, isInitialBoard, cycleId, 'Slow-path', votedFenDetections)) {
      if (DEBUG_FRAMES_ENABLED) {
        saveDebugFrame({
          seq: this.debugSeq,
          pngBuffer,
          rawResult: voteEntry,
          voteBuffer: this.fenVoteBuffer,
          votedEntry: votedEntry,
          isBurst,
        });
      }
      return;
    }

    log.info(
      { votedFen: votedEntry.fenBoard, perspective: votedEntry.perspective, reportedTurn: votedEntry.reportedTurn, lastMoveFrom: votedEntry.reportedLastMoveFrom, lastMoveTo: votedEntry.reportedLastMoveTo, prevConfirmed: this.lastConfirmedFen },
      '[ChessScreenshot] New majority-voted FEN confirmed - pushing to live-assist'
    );

    // Look up vote-read-1 metadata and clean up now that the FEN is promoted.
    const voteMeta = this.fenVoteMeta.get(votedEntry.fenBoard);
    this.fenVoteMeta.delete(votedEntry.fenBoard);

    // Record slow-path promotion metadata for the latency summary.
    const slowPromotionMeta: PromotionMeta = {
      promotionPath: 'slow',
      fenRetried:    !votedEntry.noRetryNeeded,
      turnTimedOut:  votedEntry.reportedTurn === null &&
                     votedEntry.reportedLastMoveFrom === null &&
                     votedEntry.reportedLastMoveTo   === null,
    };
    pipelineLatency.setPromotionMeta(cycleId, slowPromotionMeta);

    const liveAssist = getLiveAssistService();
    // Pass cycleId and voteMeta so live-assist can attach them to the tracker
    // and report the full fenStabilization phase in the cycle summary.
    const accepted = liveAssist.injectConfirmedFen(
      votedEntry.fenBoard,
      votedEntry.perspective,
      votedEntry.reportedTurn,
      cycleId,
      voteMeta,
      votedEntry.reportedLastMoveFrom,
      votedEntry.reportedLastMoveTo,
    );

    // Only update lastConfirmedFen if live-assist accepted the board.
    if (accepted) {
      this.lastConfirmedFen = votedEntry.fenBoard;
    } else {
      log.warn('[ChessScreenshot] Slow-path: injectConfirmedFen returned false - NOT updating lastConfirmedFen');
    }
// Step 7: Burst to confirm new position quickly
    if (!isBurst) {
      this.scheduleBurst();
    }

    if (DEBUG_FRAMES_ENABLED) {
      saveDebugFrame({
        seq: this.debugSeq,
        pngBuffer,
        rawResult: voteEntry,
        voteBuffer: this.fenVoteBuffer,
        votedEntry: votedEntry,
        isBurst,
      });
    }
    // Note: cycle is NOT ended here - live-assist will end it after coachingTip.
  }
  /**
   * Clear the last confirmed FEN so the next screenshot cycle that produces
   * the same board will re-inject it into live-assist (e.g. after an engine
   * timeout that left the position without analysis).
   */
  invalidateLastConfirmed(): void {
    this.lastConfirmedFen = null;
    log.debug('[ChessScreenshot] lastConfirmedFen invalidated - next matching vote will re-inject');
  }
}

// Singleton
let instance: ChessScreenshotService | null = null;

export function getChessScreenshotService(): ChessScreenshotService {
  if (!instance) {
    instance = new ChessScreenshotService();
  }
  return instance;
}

export function resetChessScreenshotService(): void {
  if (instance) {
    instance.stop();
    instance = null;
  }
}
