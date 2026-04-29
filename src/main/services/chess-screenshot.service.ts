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
import fs from 'fs';
import path from 'path';
import { logger } from '../lib/logger';
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
const BURST_INTERVAL_MS = 500;

/**
 * Majority-vote parameters.
 *
 * FEN_VOTE_WINDOW  — number of most-recent raw extractions to keep.
 * FEN_VOTE_THRESHOLD — minimum occurrences needed to promote a FEN.
 *
 * N=2, M=2: both of the last 2 readings must agree before the FEN is
 * promoted to live-assist.
 */
const FEN_VOTE_WINDOW = 2;
const FEN_VOTE_THRESHOLD = 2;

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

    log.info('[ChessScreenshot] Screenshot loop stopped');
  }

  // ─── Vote helpers ─────────────────────────────────────────────────────────

  private pushToVoteBuffer(entry: VoteEntry): void {
    this.fenVoteBuffer.push(entry);
    if (this.fenVoteBuffer.length > FEN_VOTE_WINDOW) {
      this.fenVoteBuffer.shift();
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
      const latestEntry = [...this.fenVoteBuffer]
        .reverse()
        .find((e) => e.fenBoard === bestFen);
      return latestEntry ?? null;
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
    // ── Step 1: Capture full primary screen ────────────────────────────────
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    });

    if (!sources.length) {
      log.warn('[ChessScreenshot] No screen sources available');
      return;
    }

    const thumbnail = sources[0].thumbnail;

    if (!thumbnail || thumbnail.isEmpty()) {
      log.warn('[ChessScreenshot] Screen thumbnail is empty');
      return;
    }

    // ── Step 2: Encode full screenshot to PNG ─────────────────────────────
    const pngBuffer = thumbnail.toPNG();
    if (!pngBuffer || pngBuffer.length === 0) {
      log.warn('[ChessScreenshot] Failed to encode screenshot as PNG');
      return;
    }

    log.debug(
      { bytes: pngBuffer.length, isBurst },
      '[ChessScreenshot] Screenshot captured, sending to gpt-5.4 for FEN extraction'
    );

    // ── Step 3: Raw FEN extraction ─────────────────────────────────────────
    const llm = getLLMService();
    const rawResult = await llm.extractFenFromImage(pngBuffer, 'image/png', this.indexingPrompt);

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
      log.debug('[ChessScreenshot] FEN extraction returned null');
      return;
    }

    // ── Step 5: Vote ───────────────────────────────────────────────────────
    this.pushToVoteBuffer(rawResult);
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
      log.debug('[ChessScreenshot] Vote inconclusive — waiting for consensus');
      return;
    }

    // ── Step 6: Promote voted FEN if changed ──────────────────────────────
    if (votedEntry.fenBoard === this.lastConfirmedFen) {
      log.debug({ votedFen: votedEntry.fenBoard }, '[ChessScreenshot] Voted FEN unchanged — no push needed');
      return;
    }

    log.info(
      { votedFen: votedEntry.fenBoard, perspective: votedEntry.perspective, reportedTurn: votedEntry.reportedTurn, prevConfirmed: this.lastConfirmedFen },
      '[ChessScreenshot] New majority-voted FEN confirmed — pushing to live-assist'
    );
    this.lastConfirmedFen = votedEntry.fenBoard;

    const liveAssist = getLiveAssistService();
    liveAssist.injectConfirmedFen(votedEntry.fenBoard, votedEntry.perspective, votedEntry.reportedTurn);

    // ── Step 7: Burst to confirm new position quickly ─────────────────────
    if (!isBurst) {
      this.scheduleBurst();
    }
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
