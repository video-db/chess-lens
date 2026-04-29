#!/usr/bin/env tsx
/**
 * tools/checkModelAvailability.ts
 *
 * Checks whether 'openai/gpt-5.4' is available via VideoDB RTStream indexing,
 * using THE EXACT SAME code paths as the app:
 *
 *   1. WebSocket connection  (setupVisualIndexWebSocket in capture.ts)
 *      — connect({ apiKey, baseUrl }) → connectWebsocket() → ws.connect()
 *      — verifies the connectionId is returned (used as socketId for indexing)
 *
 *   2. RTStream discovery  (findScreenRTStream in visual-index.ts)
 *      — conn.getCaptureSession(sessionId) → session.refresh()
 *      — session.getRTStream('screen') with fallback name/channelId filter
 *      — prints the RTStream id
 *
 *   3. Visual indexing  (visualIndex.start mutation in visual-index.ts)
 *      — screenStream.indexVisuals({ batchConfig, prompt, modelName, socketId })
 *      — batchConfig and prompt taken from game-coaching.ts (chess profile)
 *      — modelName = 'openai/gpt-5.4'
 *      — prints sceneIndexId (rtstreamIndexId) and rtstreamId
 *      — immediately stops indexing (sceneIndex.stop()) to avoid side effects
 *
 * Usage:
 *   npx tsx tools/checkModelAvailability.ts <apiKey> <sessionId> [apiUrl]
 *
 *   apiKey     — Your VideoDB API key
 *   sessionId  — An active CaptureSession ID (must be in 'active' status with
 *                a screen RTStream present)
 *   apiUrl     — Optional base URL (default: https://api.videodb.io)
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed
 *   2 — bad arguments / setup error
 */

import { connect } from 'videodb';
import type { CaptureSessionFull, RTStream, WebSocketConnection } from 'videodb';
import { getGameIndexingPrompt, getGameVisualIndexTiming } from '../src/shared/config/game-coaching';
import { RTSTREAM_VISION_MODEL } from '../src/main/services/llm.service';

// ─── Constants — mirrors visual-index.ts exactly ────────────────────────────

const MODEL_NAME      = RTSTREAM_VISION_MODEL; // 'openai/gpt-5.4'
const DEFAULT_API_URL = 'https://api.videodb.io';
const MAX_RETRIES     = 60;
const RETRY_DELAY_MS  = 2000;

// ─── Real config from the app ────────────────────────────────────────────────

/** Exact same prompt passed to indexVisuals() for chess */
const INDEXING_PROMPT = getGameIndexingPrompt('chess');

/** Exact same batchConfig used in visualIndex.start mutation */
const timing = getGameVisualIndexTiming('chess');
const BATCH_CONFIG = {
  type: 'time' as const,
  value: timing.visualIndexBatchSeconds,   // 3
  frameCount: timing.visualIndexFrameCount, // 1
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pass(label: string, detail?: string) {
  const extra = detail ? `  →  ${detail}` : '';
  console.log(`  ✓  ${label}${extra}`);
}

function fail(label: string, detail?: string) {
  const extra = detail ? `  →  ${detail}` : '';
  console.error(`  ✗  ${label}${extra}`);
}

function section(title: string) {
  console.log(`\n${'─'.repeat(64)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(64));
}

// ─── Check 1: WebSocket connection — mirrors setupVisualIndexWebSocket() ─────

async function checkWebSocket(
  apiKey: string,
  apiUrl?: string
): Promise<{ ok: boolean; connectionId: string | null; ws: WebSocketConnection | null }> {
  section('Check 1 — WebSocket connection  (setupVisualIndexWebSocket path)');

  // Exact same connect() call as setupVisualIndexWebSocket() in capture.ts
  const connectOptions: { apiKey: string; baseUrl?: string } = { apiKey };
  if (apiUrl) connectOptions.baseUrl = apiUrl;

  console.log(`  connect({ apiKey, baseUrl: ${apiUrl ?? DEFAULT_API_URL} })`);
  console.log(`  → connectWebsocket() → ws.connect()`);

  try {
    const conn = connect(connectOptions);
    const wsConnection = await conn.connectWebsocket();
    const ws = await wsConnection.connect();

    const connectionId = ws.connectionId || null;

    if (!connectionId) {
      fail('WebSocket connected but connectionId is null/empty');
      return { ok: false, connectionId: null, ws };
    }

    pass('WebSocket connected', `connectionId=${connectionId}`);
    return { ok: true, connectionId, ws };
  } catch (err) {
    const msg    = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number }).status;
    fail(`WebSocket connection failed (HTTP ${status ?? 'N/A'})`, msg);
    return { ok: false, connectionId: null, ws: null };
  }
}

// ─── Check 2: RTStream discovery — mirrors findScreenRTStream() exactly ──────

async function checkRTStream(
  sessionId: string,
  apiKey: string,
  apiUrl?: string
): Promise<{ ok: boolean; stream: RTStream | null }> {
  section('Check 2 — RTStream discovery  (findScreenRTStream path)');

  // Exact same connect() call as findScreenRTStream() in visual-index.ts
  const connectOptions: { apiKey: string; baseUrl?: string } = { apiKey };
  if (apiUrl) connectOptions.baseUrl = apiUrl;
  const conn = connect(connectOptions);

  console.log(`  sessionId : ${sessionId}`);
  console.log(`  Polling up to ${MAX_RETRIES} attempts at ${RETRY_DELAY_MS}ms intervals…`);

  // Verbatim copy of findScreenRTStream() loop
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const session: CaptureSessionFull = await conn.getCaptureSession(sessionId);
      if (!session) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      await session.refresh();

      let screens = session.getRTStream('screen');
      if (screens.length === 0) {
        screens = (session.rtstreams || []).filter((stream) => {
          const name      = (stream.name      || '').toLowerCase();
          const channelId = (stream.channelId || '').toLowerCase();
          return (
            name.includes('display') || name.includes('screen') ||
            channelId.includes('display') || channelId.includes('screen')
          );
        });
      }

      if (screens.length > 0) {
        const stream = screens[0];
        pass(
          'Screen RTStream found',
          `rtstreamId=${stream.id}  name=${stream.name ?? '(none)'}  status=${stream.status ?? '(none)'}`
        );
        return { ok: true, stream };
      }

      console.log(`  Attempt ${attempt + 1}/${MAX_RETRIES}: screen RTStream not ready, waiting…`);
      await sleep(RETRY_DELAY_MS);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  Attempt ${attempt + 1}/${MAX_RETRIES} error: ${msg}`);
      await sleep(RETRY_DELAY_MS);
    }
  }

  fail('Screen RTStream not found after all attempts');
  return { ok: false, stream: null };
}

// ─── Check 3: indexVisuals() — mirrors visualIndex.start mutation exactly ────

async function checkIndexVisuals(
  stream: RTStream,
  connectionId: string
): Promise<boolean> {
  section('Check 3 — RTStream.indexVisuals()  (visualIndex.start path)');

  console.log(`  rtstreamId   : ${stream.id}`);
  console.log(`  modelName    : ${MODEL_NAME}`);
  console.log(`  socketId     : ${connectionId}`);
  console.log(`  batchConfig  : type=time  value=${BATCH_CONFIG.value}s  frameCount=${BATCH_CONFIG.frameCount}`);
  console.log(`  prompt       : chess indexingPrompt from game-coaching.ts (${INDEXING_PROMPT.length} chars)`);
  console.log(`\n  Calling screenStream.indexVisuals(…)…`);

  try {
    // Exact same call as in visual-index.ts start mutation
    const sceneIndex = await stream.indexVisuals({
      batchConfig: BATCH_CONFIG,
      prompt: INDEXING_PROMPT,
      modelName: MODEL_NAME,
      socketId: connectionId,
    });

    if (!sceneIndex) {
      fail('indexVisuals() returned null — model may not be available or session is not active');
      return false;
    }

    pass(
      `indexVisuals() succeeded`,
      `sceneIndexId=${sceneIndex.rtstreamIndexId}  rtstreamId=${sceneIndex.rtstreamId}`
    );

    console.log(`\n  SceneIndex details:`);
    console.log(`    rtstreamIndexId : ${sceneIndex.rtstreamIndexId}`);
    console.log(`    rtstreamId      : ${sceneIndex.rtstreamId}`);
    console.log(`    status          : ${sceneIndex.status ?? '(none)'}`);
    console.log(`    extractionType  : ${sceneIndex.extractionType ?? '(none)'}`);

    // Stop indexing immediately — we only needed to verify it starts
    console.log(`\n  Stopping scene index (sceneIndex.stop())…`);
    try {
      await sceneIndex.stop();
      console.log(`  Scene index stopped cleanly.`);
    } catch (stopErr) {
      // Non-fatal — the check succeeded; just warn
      const msg = stopErr instanceof Error ? stopErr.message : String(stopErr);
      console.warn(`  ⚠  sceneIndex.stop() failed (non-fatal): ${msg}`);
    }

    return true;

  } catch (err) {
    const msg    = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number }).status;

    if (status === 404 || (msg.toLowerCase().includes('model') && msg.toLowerCase().includes('not found'))) {
      fail(`Model not found (404) — openai/gpt-5.4 is not available on this endpoint`, msg);
    } else if (status === 400 && msg.toLowerCase().includes('model')) {
      fail(`400 Bad Request — model may not be supported for RTStream indexing`, msg);
    } else if (status === 401 || status === 403) {
      fail(`Authentication error — check your API key`, msg);
    } else {
      fail(`indexVisuals() failed (HTTP ${status ?? 'N/A'})`, msg);
    }
    return false;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length < 2 || args[0] === '--help' || args[0] === '-h') {
    console.log('Usage: npx tsx tools/checkModelAvailability.ts <apiKey> <sessionId> [apiUrl]');
    console.log('');
    console.log('  apiKey     Your VideoDB API key');
    console.log('  sessionId  An active CaptureSession ID (must have a screen RTStream)');
    console.log(`  apiUrl     Optional base URL (default: ${DEFAULT_API_URL})`);
    console.log('');
    console.log('Checks that openai/gpt-5.4 is available via VideoDB RTStream indexing');
    console.log('using the exact same code paths as chess-lens:');
    console.log('  1. WebSocket connection  (setupVisualIndexWebSocket)');
    console.log('  2. RTStream discovery    (findScreenRTStream)');
    console.log('  3. RTStream.indexVisuals (visualIndex.start mutation)');
    process.exit(args.length < 2 ? 2 : 0);
  }

  const [apiKey, sessionId, apiUrl] = args;
  const effectiveApiUrl = apiUrl || DEFAULT_API_URL;

  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║       chess-lens — RTStream Model Availability Check          ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Model      : ${MODEL_NAME}`);
  console.log(`  Endpoint   : ${effectiveApiUrl}`);
  console.log(`  API key    : ${apiKey.slice(0, 6)}${'*'.repeat(Math.max(0, apiKey.length - 6))}`);
  console.log(`  Session ID : ${sessionId}`);

  let ws: WebSocketConnection | null = null;

  try {
    // ── Check 1: WebSocket ─────────────────────────────────────────────────
    const wsResult = await checkWebSocket(apiKey, apiUrl);
    const wsOk          = wsResult.ok;
    const connectionId  = wsResult.connectionId;
    ws = wsResult.ws;

    if (!wsOk || !connectionId) {
      section('Summary');
      fail('WebSocket connection');
      fail('RTStream discovery   (skipped — requires WebSocket)');
      fail('indexVisuals()       (skipped — requires WebSocket)');
      console.log('\n  ❌  Cannot proceed without a WebSocket connectionId.');
      process.exit(1);
    }

    // ── Check 2: RTStream discovery ────────────────────────────────────────
    const { ok: streamOk, stream } = await checkRTStream(sessionId, apiKey, apiUrl);

    if (!streamOk || !stream) {
      section('Summary');
      pass('WebSocket connection');
      fail('RTStream discovery');
      fail('indexVisuals()  (skipped — no RTStream found)');
      console.log('\n  ❌  Screen RTStream not found. Ensure the session is active and capturing.');
      process.exit(1);
    }

    // ── Check 3: indexVisuals ──────────────────────────────────────────────
    const indexOk = await checkIndexVisuals(stream, connectionId);

    // ── Summary ────────────────────────────────────────────────────────────
    section('Summary');
    if (wsOk)     pass('WebSocket connection'); else fail('WebSocket connection');
    if (streamOk) pass('RTStream discovery');   else fail('RTStream discovery');
    if (indexOk)  pass('indexVisuals()');        else fail('indexVisuals()');

    console.log('');
    const allOk = wsOk && streamOk && indexOk;
    if (allOk) {
      console.log(`  ✅  openai/gpt-5.4 is fully available for RTStream indexing — chess-lens will work correctly.`);
    } else {
      console.error(`  ❌  One or more checks failed. See details above.`);
      console.error('');
      console.error('  Possible fixes:');
      console.error('    • Verify your API key has access to openai/gpt-5.4 for RTStream indexing');
      console.error('    • Ensure the sessionId belongs to an active capture session with a screen RTStream');
      console.error('    • Check the apiUrl points to the correct VideoDB proxy');
      console.error('    • Contact VideoDB support to enable openai/gpt-5.4 on your account');
    }

    console.log('');
    process.exit(allOk ? 0 : 1);

  } finally {
    // Always close the WebSocket cleanly
    if (ws) {
      try { await ws.close(); } catch { /* ignore */ }
    }
  }
}

main().catch((err) => {
  console.error('\nUnhandled error:', err);
  process.exit(2);
});
