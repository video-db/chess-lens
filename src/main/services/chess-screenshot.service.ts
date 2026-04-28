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
 */

import { desktopCapturer, nativeImage } from 'electron';
import { logger } from '../lib/logger';
import { getLiveAssistService } from './live-assist.service';
import { getLLMService } from './llm.service';

const log = logger.child({ module: 'chess-screenshot' });

/** Interval in milliseconds between screenshot captures (matches SLOW_GAME_CADENCE). */
const SCREENSHOT_INTERVAL_MS = 3000;

class ChessScreenshotService {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private indexingPrompt = '';
  private inFlight = false; // prevent overlapping capture+LLM calls

  /**
   * Start the screenshot loop.
   * @param indexingPrompt - The chess board indexing prompt (from game-coaching.ts)
   */
  start(indexingPrompt: string): void {
    if (this.isRunning) {
      log.warn('Chess screenshot service already running');
      return;
    }

    // Only run when LiteLLM is configured — the direct image path requires it.
    if (!getLLMService().hasLitellmClient) {
      log.info('No LiteLLM key configured — chess screenshot service will not start. FEN extraction falls back to VideoDB text pipeline.');
      return;
    }

    this.indexingPrompt = indexingPrompt;
    this.isRunning = true;
    this.inFlight = false;

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

    log.info('[ChessScreenshot] Screenshot loop stopped');
  }

  private async captureAndExtract(): Promise<void> {
    if (!this.isRunning) return;

    // Skip if previous call is still in flight — don't stack up calls
    if (this.inFlight) {
      log.debug('[ChessScreenshot] Skipping tick — previous capture still in flight');
      return;
    }

    this.inFlight = true;
    try {
      // Capture the primary screen thumbnail
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 },
      });

      if (!sources.length) {
        log.warn('[ChessScreenshot] No screen sources available');
        return;
      }

      // Use the first source (primary screen)
      const primaryScreen = sources[0];
      const thumbnail = primaryScreen.thumbnail;

      if (!thumbnail || thumbnail.isEmpty()) {
        log.warn('[ChessScreenshot] Screen thumbnail is empty');
        return;
      }

      // Convert NativeImage to PNG buffer
      const pngBuffer = thumbnail.toPNG();
      if (!pngBuffer || pngBuffer.length === 0) {
        log.warn('[ChessScreenshot] Failed to encode screenshot as PNG');
        return;
      }

      log.debug({ bytes: pngBuffer.length }, '[ChessScreenshot] Screenshot captured, sending to LiteLLM for FEN extraction');

      // Pass to live-assist's addVisualFrame — this calls extractFenFromImage()
      // which is the exact benchmark pipeline: base64 PNG → gpt-5.4 → <raw_board> → FEN
      const liveAssist = getLiveAssistService();
      await liveAssist.addVisualFrame(pngBuffer, 'image/png', this.indexingPrompt);

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
