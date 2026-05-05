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
 *   capture full screen → encode PNG → extractFenFromImage (gpt-5.4)
 *   → majority-vote (N=2, M=2) → injectConfirmedFen → live-assist
 *
 * Accuracy improvements:
 *   - Capture interval 1s to reduce mid-animation captures.
 *   - Burst confirmation: 2 rapid follow-up captures at 500ms after a new
 *     voted FEN is detected to fill the window quickly.
 *   - Majority-vote: FEN must appear in 2 of the last 2 readings before
 *     being promoted. Single-frame glitches never reach live-assist.
 */

import { desktopCapturer, app } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { logger } from '../lib/logger';
import { pipelineLatency } from '../lib/pipeline-latency';
import type { VoteMeta } from '../lib/pipeline-latency';
import { getLiveAssistService } from './live-assist.service';
import { getLLMService } from './llm.service';

const log = logger.child({ module: 'chess-screenshot' });

/** Interval in milliseconds between regular screenshot captures. */
const SCREENSHOT_INTERVAL_MS = 1000;

/**
 * After a voted FEN changes, fire this many rapid follow-up captures
 * to fill the vote window quickly and confirm the new position.
 */
const BURST_COUNT = 2;
const BURST_INTERVAL_MS = 200; // was 500 — capture while the move highlight is still visible

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
  /** Whose turn it is as reported by the LLM from UI indicators. Null when the
   *  LLM could not determine the turn (no clock/indicator visible). */
  reportedTurn: 'w' | 'b' | null;
  /** Wall-clock time (Date.now()) when this entry was added to the buffer.
   *  Used as the start anchor for fenStabilization phase latency. */
  seenAt: number;
  /** How long the fenExtract LLM call took for this entry, in ms.
   *  Stored so the confirming cycle can report fenExtract1Ms in its summary. */
  fenExtractMs: number;
}

class ChessScreenshotService {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private indexingPrompt = '';
  private inFlight = false;

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
    this.isRunning = true;
    this.inFlight = false;
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

      // Prefer the entry that has a non-null reportedTurn — this means the LLM
      // successfully read the move highlight and the turn value is reliable.
      // Use the *earliest* matching entry with a turn: it was captured closest in
      // time to when the move was made, so the highlight was most likely still
      // visible. Later burst frames may have missed the highlight entirely.
      const withTurn = matchingEntries.filter((e) => e.reportedTurn !== null);
      return withTurn[0] ?? matchingEntries[matchingEntries.length - 1] ?? null;
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

    if (this.inFlight) {
      log.debug('[ChessScreenshot] Skipping tick — previous capture still in flight');
      return;
    }

    this.inFlight = true;
    try {
      // Hard timeout: if doCapture hangs for any reason, release inFlight
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
      log.warn({ error: msg }, '[ChessScreenshot] Capture tick failed or timed out — releasing inFlight');
    } finally {
      this.inFlight = false;
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

    // ── Step 3: Raw FEN extraction ─────────────────────────────────────────
    const llm = getLLMService();
    pipelineLatency.startStep(cycleId, 'fenExtract');
    const fenExtractStart = Date.now();
    const rawResult = await llm.extractFenFromImage(pngBuffer, 'image/png', this.indexingPrompt, 1, cycleId);
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
    };

    // ── Step 5: Vote ───────────────────────────────────────────────────────
    pipelineLatency.startStep(cycleId, 'voteConfirm');
    this.pushToVoteBuffer(voteEntry);
    const votedEntry = this.computeVotedFen();

    log.debug(
      {
        rawFen: rawResult.fenBoard,
        rawPerspective: rawResult.perspective,
        rawReportedTurn: rawResult.reportedTurn,
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

    log.info(
      { votedFen: votedEntry.fenBoard, perspective: votedEntry.perspective, reportedTurn: votedEntry.reportedTurn, prevConfirmed: this.lastConfirmedFen },
      '[ChessScreenshot] New majority-voted FEN confirmed — pushing to live-assist'
    );
    this.lastConfirmedFen = votedEntry.fenBoard;

    // Look up vote-read-1 metadata and clean up now that the FEN is promoted.
    const voteMeta = this.fenVoteMeta.get(votedEntry.fenBoard);
    this.fenVoteMeta.delete(votedEntry.fenBoard);

    const liveAssist = getLiveAssistService();
    // Pass cycleId and voteMeta so live-assist can attach them to the tracker
    // and report the full fenStabilization phase in the cycle summary.
    liveAssist.injectConfirmedFen(votedEntry.fenBoard, votedEntry.perspective, votedEntry.reportedTurn, cycleId, voteMeta);

    // ── Step 7: Burst to confirm new position quickly ─────────────────────
    if (!isBurst) {
      this.scheduleBurst();
    }
    // Note: cycle is NOT ended here — live-assist will end it after coachingTip.
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
