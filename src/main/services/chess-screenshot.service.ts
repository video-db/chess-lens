/**
 * Chess Screenshot Service
 *
 * Takes periodic screenshots of the primary screen using Electron's
 * desktopCapturer and sends them directly to the VideoDB proxy (gpt-5.4)
 * for FEN extraction — matching the Python benchmark pipeline.
 *
 * This bypasses the VideoDB indexVisuals() text pipeline which:
 *   1. Uses model 'pro' (not the vision-capable gpt-5.4)
 *   2. Returns JSON that strips all <raw_board> / <board_mapping> XML tags
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TO SWITCH BACK TO VIDEODB RTSTREAM:
 *   1. Stop calling this service (comment out start() call in capture.ts)
 *   2. Change modelName from 'pro' → 'gpt-5.4' in visual-index.ts line ~29
 *   3. The rest of the FEN pipeline (live-assist.service.ts) is unchanged.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Pipeline:
 *   capture full screen → encode PNG → extractFenAndTurnFromImage (gpt-5.4)
 *   → confidence gate → fast-path (promote immediately) OR slow-path (majority-vote)
 *   → injectConfirmedFen → live-assist
 *
 * ─── Confidence gate ─────────────────────────────────────────────────────────
 *
 * After the first vision call, the result is scored for confidence.
 * A HIGH-confidence result is promoted immediately without waiting for a
 * second confirmation read, cutting the dominant latency from ~24 s to ~12 s.
 *
 * HIGH confidence requires ALL of:
 *   1. No LLM retry was needed (fenExtract came back clean on attempt 0).
 *   2. Turn tags present and internally consistent (reportedTurn + move pair agree).
 *   3. Board delta vs last confirmed FEN ≤ MAX_SQUARE_DELTA (no big jump).
 *   4. Not the initial board position (those still go through the vote path to
 *      ensure castling rights are re-seeded correctly in live-assist).
 *
 * LOW confidence falls back to the existing majority-vote slow-path unchanged.
 */

import { desktopCapturer, app } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { logger } from '../lib/logger';
import { pipelineLatency } from '../lib/pipeline-latency';
import type { VoteMeta, PromotionMeta } from '../lib/pipeline-latency';
import { getLiveAssistService } from './live-assist.service';
import { getLLMService } from './llm.service';
import { getGameFenPrompt, getGameTurnPrompt } from '../../shared/config/game-coaching';

const log = logger.child({ module: 'chess-screenshot' });

/** Interval in milliseconds between regular screenshot captures. */
const SCREENSHOT_INTERVAL_MS = 500; // was 1000 — halved to cut worst-case detection delay

/**
 * After a voted FEN changes, fire this many rapid follow-up captures
 * to fill the vote window quickly and confirm the new position.
 */
const BURST_COUNT = 4;           // was 2 — more frames while move highlight is visible
const BURST_INTERVAL_MS = 100;   // was 200 — tighter spacing to fill vote window faster

/**
 * Maximum number of concurrent model (fenExtract) calls allowed.
 * Raising this above 1 means a new screenshot can start LLM extraction
 * while a previous call is still in-flight, so the pipeline is no longer
 * serialized behind a single slow model call (~10–12 s).
 * The first call to return a promotable FEN wins; the rest are discarded.
 */
const MAX_CONCURRENT_EXTRACTIONS = 2;

/**
 * Majority-vote parameters.
 *
 * FEN_VOTE_WINDOW  — number of most-recent raw extractions to keep.
 * FEN_VOTE_THRESHOLD — minimum occurrences needed to promote a FEN.
 *
 * N=3, M=2: 2 of the last 3 readings must agree. This tolerates one bad
 * frame (e.g. from an LLM math-error retry producing a different board)
 * while still requiring consensus before the FEN is promoted to live-assist.
 */
const FEN_VOTE_WINDOW = 3;
const FEN_VOTE_THRESHOLD = 2;

// ─── Frame deduplication ──────────────────────────────────────────────────────
//
// Before calling the vision LLM, compute a fast hash of the PNG buffer to
// detect frames that are pixel-for-pixel identical to the previous one.
// On a static board this skips the ~6 s fenExtract call entirely.
//
// Implementation: sample every FRAME_HASH_STRIDE-th byte and SHA-1 the sample.
// On a 6 MB PNG (~6 million bytes) with stride 512 that's ~11,700 bytes hashed
// — takes < 1 ms and catches any real board change.
//
// Burst captures always bypass the check so the vote window fills correctly
// after a move.

const FRAME_HASH_STRIDE = 512;

function sampleHash(buf: Buffer): string {
  const hash = crypto.createHash('sha1');
  for (let i = 0; i < buf.length; i += FRAME_HASH_STRIDE) {
    hash.update(buf.subarray(i, i + 1));
  }
  return hash.digest('hex');
}

// ─── Debug frame writer ───────────────────────────────────────────────────────
//
// Saves every frame sent to the LLM alongside its extraction result to
// <userData>/fen-debug/.  Enabled when CHESS_DEBUG_FRAMES=1.
//
// Each extraction produces two files:
//   <seq>_<fenBoard|NULL>.png  — exact PNG sent to the LLM
//   <seq>_<fenBoard|NULL>.txt  — sidecar with metadata

const DEBUG_ENABLED = process.env.CHESS_DEBUG_FRAMES === '1';

function getDebugDir(): string {
  const userData = app.getPath('userData');
  const dir = path.join(userData, 'fen-debug');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function saveDebugFrame(opts: {
  seq: number;
  pngBuffer: Buffer;
  rawResult: { fenBoard: string; perspective: 'white' | 'black' } | null;
  voteBuffer: Array<{ fenBoard: string; perspective: 'white' | 'black' }>;
  votedEntry: { fenBoard: string; perspective: 'white' | 'black' } | null;
  isBurst: boolean;
}): void {
  try {
    const dir = getDebugDir();
    const seq = String(opts.seq).padStart(4, '0');
    const fenLabel = opts.rawResult
      ? opts.rawResult.fenBoard.replace(/\//g, '-').slice(0, 60)
      : 'NULL';
    const base = `${seq}_${fenLabel}`;

    fs.writeFileSync(path.join(dir, `${base}.png`), opts.pngBuffer);

    const meta = [
      `seq:         ${opts.seq}`,
      `timestamp:   ${new Date().toISOString()}`,
      `isBurst:     ${opts.isBurst}`,
      `rawFen:      ${opts.rawResult?.fenBoard ?? 'NULL'}`,
      `perspective: ${opts.rawResult?.perspective ?? 'N/A'}`,
      `voteBuffer:  [${opts.voteBuffer.map((e) => `${e.fenBoard}(${e.perspective})`).join(', ')}]`,
      `votedFen:    ${opts.votedEntry?.fenBoard ?? 'no consensus'}`,
    ].join('\n');
    fs.writeFileSync(path.join(dir, `${base}.txt`), meta, 'utf8');
  } catch (err) {
    log.warn({ err }, '[ChessScreenshot] Failed to write debug frame');
  }
}

/** One raw FEN extraction result stored in the vote ring buffer. */
interface VoteEntry {
  fenBoard: string;
  perspective: 'white' | 'black';
  /** Whose turn it is as reported by the LLM <turn> tag. Null when absent. */
  reportedTurn: 'w' | 'b' | null;
  /** Algebraic square of the FROM square of the last move (e.g. "e2").
   *  Null when the LLM did not report move coordinates. */
  reportedLastMoveFrom: string | null;
  /** Algebraic square of the TO square of the last move (e.g. "e4").
   *  Null when the LLM did not report move coordinates. */
  reportedLastMoveTo: string | null;
  /** Wall-clock time (Date.now()) when this entry was added to the buffer. */
  seenAt: number;
  /** How long the fenExtract LLM call took for this entry, in ms. */
  fenExtractMs: number;
  /** True when neither the FEN call nor the turn call needed an LLM retry. */
  noRetryNeeded: boolean;
}

// ─── Confidence gate ──────────────────────────────────────────────────────────
//
// After the first vision call we score the result to decide whether to promote
// it immediately (fast-path) or wait for a second confirmation read (slow-path).
//
// Hard-fail signals (any one → LOW confidence → vote-buffer slow-path):
//   1. largeDelta  — board change vs last confirmed > MAX_SQUARE_DELTA squares.
//                    Real chess moves change ≤ 4 squares; more means hallucination
//                    or mid-animation frame.
//   2. initialBoard — starting position always goes through vote so castling
//                    rights are re-seeded correctly in live-assist.
//
// Soft signals (logged but never block promotion on their own):
//   - noRetryNeeded  — a retry was needed but still produced a valid board.
//                      The temporal gate and isBoardPlausible in injectConfirmedFen
//                      are the real correctness safety net.
//   - noTurnSignal   — turn/move tags timed out or were absent. injectConfirmedFen
//                      has a 5-tier turn inference fallback that handles null turns
//                      safely (board-diff → lastChessTurn → perspective seed).
//
// This design ensures the pipeline is not silently stalled by a turn-call timeout
// when the FEN board itself is structurally valid and spatially consistent.

interface ConfidenceResult {
  high: boolean;
  reasons: string[]; // list of failing signals for debug logging
}

function scoreFenConfidence(
  rawResult: VoteEntry,
  lastConfirmedFen: string | null,
  maxSquareDelta: number,
): ConfidenceResult {
  const reasons: string[] = [];

  // Soft signal 1: retry was needed (logged only, never a hard block)
  if (!rawResult.noRetryNeeded) {
    reasons.push('retryNeeded(soft)');
  }

  // Soft signal 2: turn signal absent (logged only, never a hard block)
  const hasTurnSignal =
    rawResult.reportedTurn !== null ||
    (rawResult.reportedLastMoveFrom !== null && rawResult.reportedLastMoveTo !== null);
  if (!hasTurnSignal) {
    reasons.push('noTurnSignal(soft)');
  }

  // Hard signal 1: board delta vs last confirmed
  const hardReasons: string[] = [];
  if (lastConfirmedFen !== null) {
    const delta = squareDeltaFn(rawResult.fenBoard, lastConfirmedFen);
    if (delta > maxSquareDelta) {
      hardReasons.push(`largeDelta(${delta})`);
    }
  }

  // Hard signal 2: initial board must go through vote
  const isInitial = rawResult.fenBoard === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
  if (isInitial) {
    hardReasons.push('initialBoard');
  }

  return {
    high: hardReasons.length === 0,
    // Include both soft and hard reasons in the log for observability
    reasons: [...hardReasons, ...reasons],
  };
}

// Module-level helper so scoreFenConfidence can use squareDelta logic without
// being a class method.
function squareDeltaFn(fenA: string, fenB: string): number {
  const expand = (fen: string): string => {
    const squares: string[] = [];
    for (const rank of fen.split('/')) {
      for (const ch of rank) {
        if (/\d/.test(ch)) {
          for (let i = 0; i < parseInt(ch, 10); i++) squares.push('.');
        } else {
          squares.push(ch);
        }
      }
    }
    return squares.join('');
  };
  const a = expand(fenA);
  const b = expand(fenB);
  if (a.length !== 64 || b.length !== 64) return Infinity;
  let diff = 0;
  for (let i = 0; i < 64; i++) if (a[i] !== b[i]) diff++;
  return diff;
}

class ChessScreenshotService {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private indexingPrompt = '';
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

  // Frame deduplication — hash of the last PNG sent to the LLM
  private lastFrameHash: string | null = null;

  // Latency: per-FEN vote metadata keyed by fenBoard string.
  // Stores both the wall-clock time of vote read 1 (seenAt) and how long
  // that extraction took (fenExtract1Ms) so the confirming cycle can report
  // the full fenStabilization phase duration.
  // Entries are evicted when a FEN is promoted or when its buffer slot is
  // overwritten, keeping memory bounded at FEN_VOTE_WINDOW entries.
  private fenVoteMeta = new Map<string, VoteMeta>();

  // ─── Public API ──────────────────────────────────────────────────────────

  start(indexingPrompt: string): void {
    if (this.isRunning) {
      log.warn('Chess screenshot service already running');
      return;
    }

    this.indexingPrompt = indexingPrompt;
    // Derive the focused FEN-only and turn-only prompts from the base prompt.
    // The game ID is always 'chess' here; the split is done at startup so we
    // don't recompute it every capture cycle.
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

    if (DEBUG_ENABLED) {
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

    log.info('[ChessScreenshot] Screenshot loop stopped');
  }

  // ─── Temporal consistency ─────────────────────────────────────────────────
  //
  // A single chess move changes at most 4 squares (castling: king + rook, both
  // origin and destination). If a newly voted FEN differs from the last confirmed
  // FEN by more than MAX_SQUARE_DELTA squares it almost certainly represents a
  // visual hallucination or a mid-animation snapshot rather than a real move.
  // We reject it so the vote buffer resets and the pipeline waits for a stable frame.
  //
  // The threshold is set to 6 to give a small margin above the theoretical max (4)
  // while still catching runaway piece-cluster hallucinations (which typically
  // produce 8–20 square changes in the benchmark failure cases).

  private static readonly MAX_SQUARE_DELTA = 6;

  /**
   * Count the number of squares that differ between two FEN board strings.
   * Both boards must already be in white-perspective (8 ranks, rank-sum = 8).
   * Returns Infinity if either string fails basic validation so the caller
   * can treat a malformed FEN as an unconditional reject.
   * Delegates to the module-level squareDeltaFn so the same logic is reused
   * by the confidence gate without needing a class reference.
   */
  private static squareDelta(fenA: string, fenB: string): number {
    return squareDeltaFn(fenA, fenB);
  }

  // ─── Vote helpers ─────────────────────────────────────────────────────────

  private pushToVoteBuffer(entry: VoteEntry): void {
    // Record vote-read-1 metadata the first time this fenBoard appears.
    // Subsequent reads of the same board don't overwrite it — the first
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
      // Always use the LATEST entry within each category — earlier entries may have been
      // captured before the highlight fully settled on screen.
      const withGrid = matchingEntries.filter(
        (e) => e.reportedLastMoveFrom !== null && e.reportedLastMoveTo !== null
      );
      const withTurn = matchingEntries.filter((e) => e.reportedTurn !== null);
      return withGrid[withGrid.length - 1] ?? withTurn[withTurn.length - 1] ?? matchingEntries[matchingEntries.length - 1] ?? null;
    }
    return null;
  }

  // ─── Burst confirmation ───────────────────────────────────────────────────

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

  // ─── Main capture loop ────────────────────────────────────────────────────

  private async captureAndExtract(isBurst = false): Promise<void> {
    if (!this.isRunning) return;

    if (this.inFlightCount >= MAX_CONCURRENT_EXTRACTIONS) {
      log.debug(
        { inFlightCount: this.inFlightCount, max: MAX_CONCURRENT_EXTRACTIONS },
        '[ChessScreenshot] Skipping tick — concurrency limit reached'
      );
      return;
    }

    this.inFlightCount += 1;
    try {
      // Hard timeout: if doCapture hangs for any reason, release the slot
      // so the pipeline is never permanently stalled.
      const TICK_TIMEOUT_MS = 15000;
      await Promise.race([
        this.doCapture(isBurst),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('captureAndExtract tick timed out after 15s')), TICK_TIMEOUT_MS)
        ),
      ]);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.warn({ error: msg }, '[ChessScreenshot] Capture tick failed or timed out — releasing inFlight slot');
    } finally {
      this.inFlightCount -= 1;
    }
  }

  private async doCapture(isBurst: boolean): Promise<void> {
    // Create a new pipeline latency cycle for this capture tick.
    const cycleId = pipelineLatency.newCycle();

    // ── Step 1: Capture full primary screen ────────────────────────────────
    pipelineLatency.startStep(cycleId, 'screenshot');
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
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

    // ── Step 2: Encode full screenshot to PNG ─────────────────────────────
    const pngBuffer = thumbnail.toPNG();
    if (!pngBuffer || pngBuffer.length === 0) {
      log.warn('[ChessScreenshot] Failed to encode screenshot as PNG');
      pipelineLatency.endStep(cycleId, 'screenshot', 'PNG encode failed');
      pipelineLatency.endCycle(cycleId, 'pngEncodeFailed');
      return;
    }
    pipelineLatency.endStep(cycleId, 'screenshot');

    // ── Frame deduplication ────────────────────────────────────────────────
    // Hash a strided sample of the PNG buffer. If it matches the previous
    // frame AND this is not a burst capture, the board hasn't changed —
    // skip the expensive vision LLM call entirely.
    const frameHash = sampleHash(pngBuffer);
    if (!isBurst && frameHash === this.lastFrameHash) {
      log.debug('[ChessScreenshot] Frame unchanged — skipping fenExtract');
      pipelineLatency.endCycle(cycleId, 'frameUnchanged');
      return;
    }
    this.lastFrameHash = frameHash;

    log.debug(
      { bytes: pngBuffer.length, isBurst },
      '[ChessScreenshot] Screenshot captured, sending to gpt-5.4 for FEN extraction'
    );

    // ── Step 3: Parallel FEN + turn extraction ────────────────────────────
    // Two independent vision calls run concurrently:
    //   FEN call  — extracts <perspective> + <raw_board>; retries once on math errors.
    //   Turn call — extracts <turn>, <last_move_from>, <last_move_to>.
    // Results are merged before entering the vote buffer.
    const llm = getLLMService();
    pipelineLatency.startStep(cycleId, 'fenExtract');
    const fenExtractStart = Date.now();
    const rawResult = await llm.extractFenAndTurnFromImage(
      pngBuffer,
      'image/png',
      this.fenPrompt,
      this.turnPrompt,
      cycleId,
    );
    const fenExtractMs = Date.now() - fenExtractStart;

    // ── Step 3b: Debug frame save ──────────────────────────────────────────
    if (DEBUG_ENABLED) {
      this.debugSeq += 1;
      const peekBuffer = rawResult
        ? [...this.fenVoteBuffer, rawResult].slice(-FEN_VOTE_WINDOW)
        : [...this.fenVoteBuffer];
      const peekCounts = new Map<string, number>();
      for (const e of peekBuffer) peekCounts.set(e.fenBoard, (peekCounts.get(e.fenBoard) ?? 0) + 1);
      let peekBestFen: string | null = null;
      let peekBestCount = 0;
      for (const [fen, count] of peekCounts) {
        if (count > peekBestCount) { peekBestCount = count; peekBestFen = fen; }
      }
      const peekVoted = peekBestCount >= FEN_VOTE_THRESHOLD && peekBestFen !== null
        ? peekBuffer.slice().reverse().find((e) => e.fenBoard === peekBestFen) ?? null
        : null;

      saveDebugFrame({
        seq: this.debugSeq,
        pngBuffer,
        rawResult,
        voteBuffer: peekBuffer,
        votedEntry: peekVoted,
        isBurst,
      });
    }

    // ── Step 4: Handle null result ─────────────────────────────────────────
    if (rawResult === null) {
      pipelineLatency.endStep(cycleId, 'fenExtract', 'null result');
      pipelineLatency.endCycle(cycleId, 'fenNull');
      log.debug('[ChessScreenshot] FEN extraction returned null');
      return;
    }
    pipelineLatency.endStep(cycleId, 'fenExtract');

    // Stamp seenAt and fenExtractMs so pushToVoteBuffer can build VoteMeta
    // for the phase latency report on the confirming cycle.
    const voteEntry: VoteEntry = {
      ...rawResult,
      seenAt: Date.now(),
      fenExtractMs,
      noRetryNeeded: rawResult.noRetryNeeded,
    };

    // ── Confidence gate ────────────────────────────────────────────────────
    // Score this result before touching the vote buffer. A high-confidence
    // result is promoted immediately — we skip the second confirmation read
    // entirely, cutting the dominant fenStabilization latency roughly in half.
    //
    // Low-confidence results fall through to the existing vote-buffer path
    // unchanged: they are pushed into the ring buffer and the cycle ends with
    // voteInconclusive, waiting for a subsequent tick to provide consensus.
    const confidence = scoreFenConfidence(
      voteEntry,
      this.lastConfirmedFen,
      ChessScreenshotService.MAX_SQUARE_DELTA,
    );

    if (confidence.high) {
      // ── Fast path: promote immediately ──────────────────────────────────
      const isInitialBoard = voteEntry.fenBoard === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

      // Skip if this board is already the last confirmed FEN and not the
      // initial board (same dedup logic as the vote path).
      if (voteEntry.fenBoard === this.lastConfirmedFen && !isInitialBoard) {
        pipelineLatency.startStep(cycleId, 'voteConfirm');
        pipelineLatency.endStep(cycleId, 'voteConfirm');
        pipelineLatency.endCycle(cycleId, 'fenUnchanged');
        log.debug({ votedFen: voteEntry.fenBoard }, '[ChessScreenshot] Fast-path: FEN unchanged — no push needed');
        return;
      }

      // Temporal consistency gate applies on the fast-path too.
      if (this.lastConfirmedFen !== null && !isInitialBoard) {
        const delta = ChessScreenshotService.squareDelta(voteEntry.fenBoard, this.lastConfirmedFen);
        if (delta > ChessScreenshotService.MAX_SQUARE_DELTA) {
          log.warn(
            { delta, max: ChessScreenshotService.MAX_SQUARE_DELTA, votedFen: voteEntry.fenBoard, prevFen: this.lastConfirmedFen },
            '[ChessScreenshot] Fast-path temporal consistency REJECT — large delta, likely hallucination'
          );
          this.fenVoteBuffer = [];
          this.fenVoteMeta.clear();
          pipelineLatency.endCycle(cycleId, 'temporalReject');
          return;
        }
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
        '[ChessScreenshot] HIGH confidence — fast-path promotion, skipping second read'
      );

      // Record voteConfirm step with near-zero cost (no second LLM call needed).
      pipelineLatency.startStep(cycleId, 'voteConfirm');
      pipelineLatency.endStep(cycleId, 'voteConfirm');

      this.lastConfirmedFen = voteEntry.fenBoard;

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
      liveAssist.injectConfirmedFen(
        voteEntry.fenBoard,
        voteEntry.perspective,
        voteEntry.reportedTurn,
        cycleId,
        fastVoteMeta,
        voteEntry.reportedLastMoveFrom,
        voteEntry.reportedLastMoveTo,
      );

      if (!isBurst) {
        this.scheduleBurst();
      }
      return;
    }

    // ── Low confidence: fall through to existing vote-buffer slow-path ────
    log.debug(
      { confidence: confidence.reasons, fenBoard: voteEntry.fenBoard.slice(0, 30) },
      '[ChessScreenshot] LOW confidence — using vote-buffer slow-path'
    );

    // ── Step 5: Vote ───────────────────────────────────────────────────────
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
      pipelineLatency.endStep(cycleId, 'voteConfirm', 'inconclusive');
      pipelineLatency.endCycle(cycleId, 'voteInconclusive');
      log.debug('[ChessScreenshot] Vote inconclusive — waiting for consensus');
      return;
    }
    pipelineLatency.endStep(cycleId, 'voteConfirm');

    // ── Step 6: Promote voted FEN if changed ──────────────────────────────
    // Never skip the initial starting position: if the previous confirmed FEN
    // was also the initial board (e.g. game 1 just started), a new game starting
    // from the same position must still be pushed so live-assist can reseed
    // castling rights and other per-game state.
    const isInitialBoard = votedEntry.fenBoard === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
    if (votedEntry.fenBoard === this.lastConfirmedFen && !isInitialBoard) {
      pipelineLatency.endCycle(cycleId, 'fenUnchanged');
      log.debug({ votedFen: votedEntry.fenBoard }, '[ChessScreenshot] Voted FEN unchanged — no push needed');
      return;
    }

    // ── Temporal consistency gate ─────────────────────────────────────────────
    // A real chess move changes at most 4 squares. If the new FEN differs from
    // the last confirmed FEN by more than MAX_SQUARE_DELTA squares, it is almost
    // certainly a hallucination or mid-animation snapshot. Reject it, clear the
    // vote buffer, and wait for a stable frame.
    if (this.lastConfirmedFen !== null && !isInitialBoard) {
      const delta = ChessScreenshotService.squareDelta(votedEntry.fenBoard, this.lastConfirmedFen);
      if (delta > ChessScreenshotService.MAX_SQUARE_DELTA) {
        log.warn(
          { delta, max: ChessScreenshotService.MAX_SQUARE_DELTA, votedFen: votedEntry.fenBoard, prevFen: this.lastConfirmedFen },
          '[ChessScreenshot] Temporal consistency REJECT — voted FEN diffs by too many squares, likely hallucination'
        );
        // Purge the vote buffer so these bad frames don’t influence the next vote.
        this.fenVoteBuffer = [];
        this.fenVoteMeta.clear();
        pipelineLatency.endCycle(cycleId, 'temporalReject');
        return;
      }
    }

    log.info(
      { votedFen: votedEntry.fenBoard, perspective: votedEntry.perspective, reportedTurn: votedEntry.reportedTurn, lastMoveFrom: votedEntry.reportedLastMoveFrom, lastMoveTo: votedEntry.reportedLastMoveTo, prevConfirmed: this.lastConfirmedFen },
      '[ChessScreenshot] New majority-voted FEN confirmed — pushing to live-assist'
    );
    this.lastConfirmedFen = votedEntry.fenBoard;

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
    liveAssist.injectConfirmedFen(
      votedEntry.fenBoard,
      votedEntry.perspective,
      votedEntry.reportedTurn,
      cycleId,
      voteMeta,
      votedEntry.reportedLastMoveFrom,
      votedEntry.reportedLastMoveTo,
    );

    // ── Step 7: Burst to confirm new position quickly ─────────────────────
    if (!isBurst) {
      this.scheduleBurst();
    }
    // Note: cycle is NOT ended here — live-assist will end it after coachingTip.
  }
  /**
   * Clear the last confirmed FEN so the next screenshot cycle that produces
   * the same board will re-inject it into live-assist (e.g. after an engine
   * timeout that left the position without analysis).
   */
  invalidateLastConfirmed(): void {
    this.lastConfirmedFen = null;
    log.debug('[ChessScreenshot] lastConfirmedFen invalidated — next matching vote will re-inject');
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
