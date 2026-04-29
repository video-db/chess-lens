/**
 * Chess Screenshot Service
 *
 * Takes periodic screenshots of the primary screen using Electron's
 * desktopCapturer and sends them directly to the LiteLLM vision model
 * (gpt-5.4) for FEN extraction — matching the Python benchmark pipeline
 * that achieves 98.61% FEN accuracy.
 *
 * This bypasses the VideoDB indexVisuals() text pipeline which:
 *   1. Uses model 'pro' (not the vision-capable gpt-5.4)
 *   2. Returns JSON that strips all <raw_board> / <board_mapping> XML tags
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TO SWITCH BACK TO VIDEODB WHEN THEY SUPPORT gpt-5.4 VISION:
 *   1. Stop calling this service (comment out start() call in capture.ts)
 *   2. Change modelName from 'pro' → 'gpt-5.4' in visual-index.ts line ~29
 *   3. The rest of the FEN pipeline (live-assist.service.ts) is unchanged.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Accuracy improvements applied:
 *   - Board region auto-detection via LLM: the first capture sends the full
 *     screenshot to the model with a cheap bounding-box prompt; subsequent
 *     captures are cropped to just the board area (NativeImage.crop()).
 *     The cache is invalidated after BOARD_DETECT_FAILURE_THRESHOLD consecutive
 *     null FEN results so it re-detects if the user resizes/moves the board.
 *   - Capture interval reduced from 3 s → 1 s to avoid mid-animation captures.
 *   - Burst confirmation: when a voted FEN changes, 2 rapid follow-up captures
 *     fire at BURST_INTERVAL_MS to fill the vote window quickly.
 *   - Majority-vote (N=3, M=2): raw FEN extractions are collected in a rolling
 *     ring buffer; only the FEN that appears in ≥ 2 of the last 3 readings is
 *     promoted to the live-assist pipeline. Single-frame glitches are absorbed
 *     and never reach the overlay or coaching engine.
 */

import { desktopCapturer, app } from 'electron';
import type { NativeImage } from 'electron';
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
 * How many consecutive null-FEN results trigger a board-region re-detection.
 * A null can mean the board moved/resized or the crop drifted off the board.
 */
const BOARD_DETECT_FAILURE_THRESHOLD = 5;

/**
 * Majority-vote parameters.
 *
 * FEN_VOTE_WINDOW  — number of most-recent raw extractions to keep.
 * FEN_VOTE_THRESHOLD — minimum occurrences needed to promote a FEN.
 *
 * With N=2, M=2: both of the last 2 readings must agree before the FEN is
 * promoted to live-assist. Tighter than N=3,M=2 but confirms faster — paired
 * with the 1s capture interval and burst captures, single-frame glitches are
 * still filtered because the vote never passes with disagreeing readings.
 */
const FEN_VOTE_WINDOW = 2;
const FEN_VOTE_THRESHOLD = 2;

// ─── Debug frame writer ───────────────────────────────────────────────────────
//
// Saves every frame sent to the LLM alongside its extraction result to
// <userData>/fen-debug/.  Enabled when the CHESS_DEBUG_FRAMES environment
// variable is set to "1" (or any truthy string).
//
// Each extraction produces two files:
//   <seq>_<label>_<fenBoard|NULL>.png   — the exact PNG sent to the LLM
//   <seq>_<label>_<fenBoard|NULL>.txt   — sidecar with full metadata
//
// <label> is "cropped" when the board region was used, "full" otherwise.
// <seq> is a zero-padded 4-digit counter that resets on service start.
//
// Example:
//   0001_cropped_rnbqkbnr-pppppppp-8-8-4P3-8-PPPP1PPP-RNBQKBNR.png
//   0001_cropped_rnbqkbnr-pppppppp-8-8-4P3-8-PPPP1PPP-RNBQKBNR.txt
//   0002_cropped_NULL.png   ← extraction returned null

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
  cropped: boolean;
  rawResult: { fenBoard: string; perspective: 'white' | 'black' } | null;
  voteBuffer: Array<{ fenBoard: string; perspective: 'white' | 'black' }>;
  votedEntry: { fenBoard: string; perspective: 'white' | 'black' } | null;
  isBurst: boolean;
  boardRegion: { x: number; y: number; w: number; h: number } | null;
}): void {
  try {
    const dir = getDebugDir();
    const seq = String(opts.seq).padStart(4, '0');
    const label = opts.cropped ? 'cropped' : 'full';
    const fenLabel = opts.rawResult
      ? opts.rawResult.fenBoard.replace(/\//g, '-').slice(0, 60)
      : 'NULL';
    const base = `${seq}_${label}_${fenLabel}`;

    // Save PNG
    fs.writeFileSync(path.join(dir, `${base}.png`), opts.pngBuffer);

    // Save sidecar text
    const meta = [
      `seq:         ${opts.seq}`,
      `timestamp:   ${new Date().toISOString()}`,
      `isBurst:     ${opts.isBurst}`,
      `cropped:     ${opts.cropped}`,
      `boardRegion: ${opts.boardRegion ? JSON.stringify(opts.boardRegion) : 'none (full image)'}`,
      `rawFen:      ${opts.rawResult?.fenBoard ?? 'NULL'}`,
      `perspective: ${opts.rawResult?.perspective ?? 'N/A'}`,
      `voteBuffer:  [${opts.voteBuffer.map((e) => `${e.fenBoard}(${e.perspective})`).join(', ')}]`,
      `votedFen:    ${opts.votedEntry?.fenBoard ?? 'no consensus'}`,
    ].join('\n');
    fs.writeFileSync(path.join(dir, `${base}.txt`), meta, 'utf8');
  } catch (err) {
    // Never let debug I/O crash the main pipeline
    log.warn({ err }, '[ChessScreenshot] Failed to write debug frame');
  }
}

/** Fractional bounding box as returned by the board-detection LLM call. */
interface BoardRegion {
  x: number; // 0–1 fraction of image width
  y: number; // 0–1 fraction of image height
  w: number; // 0–1 fraction of image width
  h: number; // 0–1 fraction of image height
}

/** One raw FEN extraction result stored in the vote ring buffer. */
interface VoteEntry {
  fenBoard: string;
  perspective: 'white' | 'black';
}

class ChessScreenshotService {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private indexingPrompt = '';
  private inFlight = false; // prevent overlapping capture+LLM calls

  // Board region cache
  private boardRegion: BoardRegion | null = null;
  private consecutiveNullCount = 0;

  // Majority-vote ring buffer — stores the last FEN_VOTE_WINDOW raw extractions
  private fenVoteBuffer: VoteEntry[] = [];

  // Last FEN that passed the vote and was pushed to live-assist
  private lastConfirmedFen: string | null = null;

  // Burst state
  private burstPending = false;

  // Debug frame sequence counter (resets on start)
  private debugSeq = 0;

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Start the screenshot loop.
   * @param indexingPrompt - The chess board indexing prompt (from game-coaching.ts)
   */
  start(indexingPrompt: string): void {
    if (this.isRunning) {
      log.warn('Chess screenshot service already running');
      return;
    }

    this.indexingPrompt = indexingPrompt;
    this.isRunning = true;
    this.inFlight = false;
    this.boardRegion = null;
    this.consecutiveNullCount = 0;
    this.fenVoteBuffer = [];
    this.lastConfirmedFen = null;
    this.burstPending = false;
    this.debugSeq = 0;

    if (DEBUG_ENABLED) {
      log.info({ dir: getDebugDir() }, '[ChessScreenshot] Debug frame saving ENABLED');
    }

    log.info({ intervalMs: SCREENSHOT_INTERVAL_MS }, '[ChessScreenshot] Starting screenshot loop for direct FEN extraction');

    // Run immediately on start, then on interval
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

    // Reset all stateful fields so the next start() is clean
    this.boardRegion = null;
    this.consecutiveNullCount = 0;
    this.fenVoteBuffer = [];
    this.lastConfirmedFen = null;
    this.burstPending = false;

    log.info('[ChessScreenshot] Screenshot loop stopped');
  }

  // ─── Board region detection ───────────────────────────────────────────────

  /**
   * Ask the LLM to locate the chessboard bounding box in a full screenshot.
   *
   * Sends a cheap, short prompt (no board analysis) requesting only a JSON
   * bounding box as fractions of image dimensions.  The result is cached in
   * this.boardRegion and reused for every subsequent capture until invalidated.
   *
   * Returns null if detection fails (caller falls back to the full image).
   */
  private async detectBoardRegion(fullPngBuffer: Buffer): Promise<BoardRegion | null> {
    const llm = getLLMService();
    log.info('[ChessScreenshot] Detecting chessboard region via LLM...');

    try {
      const region = await llm.detectChessBoardRegion(fullPngBuffer);
      if (region) {
        log.info({ region }, '[ChessScreenshot] Board region detected and cached');
      } else {
        log.warn('[ChessScreenshot] Board region detection returned null — will use full image');
      }
      return region;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ error: msg }, '[ChessScreenshot] Board region detection failed — will use full image');
      return null;
    }
  }

  /**
   * Crop a NativeImage to the cached board region.
   *
   * @param thumbnail - Full-screen NativeImage from desktopCapturer
   * @param region    - Fractional bounding box (0–1 per axis)
   * @returns Cropped NativeImage, or the original if the crop rect is invalid
   */
  private cropToBoard(thumbnail: NativeImage, region: BoardRegion): NativeImage {
    const { width, height } = thumbnail.getSize();

    const x = Math.round(region.x * width);
    const y = Math.round(region.y * height);
    const w = Math.round(region.w * width);
    const h = Math.round(region.h * height);

    // Clamp to image bounds to avoid out-of-range crop errors
    const safeX = Math.max(0, Math.min(x, width - 1));
    const safeY = Math.max(0, Math.min(y, height - 1));
    const safeW = Math.max(1, Math.min(w, width - safeX));
    const safeH = Math.max(1, Math.min(h, height - safeY));

    log.debug(
      { x: safeX, y: safeY, w: safeW, h: safeH, imgW: width, imgH: height },
      '[ChessScreenshot] Cropping to board region'
    );

    return thumbnail.crop({ x: safeX, y: safeY, width: safeW, height: safeH });
  }

  // ─── Majority-vote helpers ────────────────────────────────────────────────

  /**
   * Push a raw FEN extraction into the vote ring buffer.
   * The buffer is capped at FEN_VOTE_WINDOW entries (oldest evicted first).
   */
  private pushToVoteBuffer(entry: VoteEntry): void {
    this.fenVoteBuffer.push(entry);
    if (this.fenVoteBuffer.length > FEN_VOTE_WINDOW) {
      this.fenVoteBuffer.shift();
    }
  }

  /**
   * Compute the mode of the vote buffer (keyed on fenBoard string only).
   *
   * Returns the winning VoteEntry only if its fenBoard appears at least
   * FEN_VOTE_THRESHOLD times in the current window.
   * The perspective of the most-recent entry with the winning fenBoard is used.
   * Returns null when no FEN has reached the threshold yet.
   */
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
      // Use the perspective from the most recent entry that has this fenBoard
      const latestEntry = [...this.fenVoteBuffer]
        .reverse()
        .find((e) => e.fenBoard === bestFen);
      return latestEntry ?? null;
    }
    return null;
  }

  // ─── Burst confirmation ───────────────────────────────────────────────────

  /**
   * Schedule BURST_COUNT rapid follow-up captures after a new voted FEN is
   * detected.  These quickly fill the vote window for the new position,
   * minimising the lag between a real board change and its confirmation.
   */
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

    // Skip if previous call is still in flight — don't stack up calls.
    if (this.inFlight) {
      log.debug('[ChessScreenshot] Skipping tick — previous capture still in flight');
      return;
    }

    this.inFlight = true;
    try {
      // ── Step 1: Capture full primary screen ──────────────────────────────
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 },
      });

      if (!sources.length) {
        log.warn('[ChessScreenshot] No screen sources available');
        return;
      }

      const primaryScreen = sources[0];
      const thumbnail = primaryScreen.thumbnail;

      if (!thumbnail || thumbnail.isEmpty()) {
        log.warn('[ChessScreenshot] Screen thumbnail is empty');
        return;
      }

      // ── Step 2: Detect / use cached board region ─────────────────────────
      //
      // On the very first capture (boardRegion === null) or after the cache
      // has been invalidated by too many consecutive nulls, run board detection
      // on the full screenshot.  All subsequent captures are cropped.
      if (this.boardRegion === null) {
        const fullPng = thumbnail.toPNG();
        if (fullPng && fullPng.length > 0) {
          const detected = await this.detectBoardRegion(fullPng);
          this.boardRegion = detected;
        }
      }

      // ── Step 3: Crop to board region if we have one ──────────────────────
      let imageSource: NativeImage = thumbnail;
      if (this.boardRegion) {
        imageSource = this.cropToBoard(thumbnail, this.boardRegion);
      }

      // ── Step 4: Encode to PNG ────────────────────────────────────────────
      const pngBuffer = imageSource.toPNG();
      if (!pngBuffer || pngBuffer.length === 0) {
        log.warn('[ChessScreenshot] Failed to encode screenshot as PNG');
        return;
      }

      log.debug(
        { bytes: pngBuffer.length, cropped: !!this.boardRegion, isBurst },
        '[ChessScreenshot] Screenshot captured, sending to LiteLLM for FEN extraction'
      );

      // ── Step 5: Raw FEN extraction ────────────────────────────────────────
      //
      // Extract the FEN directly from the LLM — do NOT push to live-assist yet.
      // The raw result goes into the vote buffer first.
      const llm = getLLMService();
      const rawResult = await llm.extractFenFromImage(pngBuffer, 'image/png', this.indexingPrompt);

      // ── Step 5b: Debug frame save ─────────────────────────────────────────
      // Compute what the voted entry would be after pushing rawResult, so the
      // sidecar shows the vote state at the moment of this extraction.
      if (DEBUG_ENABLED) {
        this.debugSeq += 1;
        // Peek at what the vote buffer would look like after pushing (without mutating yet)
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
          cropped: !!this.boardRegion,
          rawResult,
          voteBuffer: peekBuffer,
          votedEntry: peekVoted,
          isBurst,
          boardRegion: this.boardRegion,
        });
      }

      // ── Step 6: Null-streak tracking and board-region invalidation ────────
      if (rawResult === null) {
        this.consecutiveNullCount += 1;
        log.debug(
          { consecutiveNulls: this.consecutiveNullCount, threshold: BOARD_DETECT_FAILURE_THRESHOLD },
          '[ChessScreenshot] FEN extraction returned null'
        );

        if (this.consecutiveNullCount >= BOARD_DETECT_FAILURE_THRESHOLD) {
          log.warn(
            { consecutiveNulls: this.consecutiveNullCount },
            '[ChessScreenshot] Too many consecutive null FENs — invalidating board region cache for re-detection'
          );
          this.boardRegion = null;
          this.consecutiveNullCount = 0;
          // Also clear the vote buffer so stale votes from the wrong crop region
          // don't influence the next detection cycle.
          this.fenVoteBuffer = [];
        }
        // Null readings are not pushed into the vote buffer — only valid FENs vote.
        return;
      }

      // Good extraction — reset null counter
      this.consecutiveNullCount = 0;

      // ── Step 7: Vote ──────────────────────────────────────────────────────
      this.pushToVoteBuffer(rawResult);
      const votedEntry = this.computeVotedFen();

      log.debug(
        {
          rawFen: rawResult.fenBoard,
          rawPerspective: rawResult.perspective,
          votedFen: votedEntry?.fenBoard ?? null,
          votedPerspective: votedEntry?.perspective ?? null,
          bufferSize: this.fenVoteBuffer.length,
          window: FEN_VOTE_WINDOW,
          threshold: FEN_VOTE_THRESHOLD,
        },
        '[ChessScreenshot] FEN vote tick'
      );

      if (votedEntry === null) {
        // No consensus yet — keep showing the last confirmed FEN on the overlay
        // (do nothing; lastConfirmedFen is unchanged).
        log.debug('[ChessScreenshot] Vote inconclusive — waiting for consensus');
        return;
      }

      // ── Step 8: Promote voted FEN if it changed ───────────────────────────
      if (votedEntry.fenBoard === this.lastConfirmedFen) {
        // Same position confirmed again — no need to re-push to live-assist
        log.debug({ votedFen: votedEntry.fenBoard }, '[ChessScreenshot] Voted FEN unchanged — no push needed');
        return;
      }

      // New confirmed position — push to live-assist pipeline
      log.info(
        { votedFen: votedEntry.fenBoard, perspective: votedEntry.perspective, prevConfirmed: this.lastConfirmedFen },
        '[ChessScreenshot] New majority-voted FEN confirmed — pushing to live-assist'
      );
      this.lastConfirmedFen = votedEntry.fenBoard;

      const liveAssist = getLiveAssistService();
      liveAssist.injectConfirmedFen(votedEntry.fenBoard, votedEntry.perspective);

      // ── Step 9: Burst to fill the window quickly for the new position ─────
      if (!isBurst) {
        this.scheduleBurst();
      }

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error({ error: msg }, '[ChessScreenshot] Error during capture+extract cycle');
    } finally {
      this.inFlight = false;
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
