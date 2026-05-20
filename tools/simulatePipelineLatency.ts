#!/usr/bin/env tsx
/**
 * Simulate chess coaching pipeline latency cycles and emit the exact
 * pipeline latency summary log shape used by the app.
 *
 * Supports both the FAST PATH (single-read promotion) and the SLOW PATH
 * (majority-vote two-read confirmation) so the analyser can show per-path
 * breakdowns.
 *
 * Usage:
 *   # Slow path (default, two reads)
 *   npx tsx tools/simulatePipelineLatency.ts
 *
 *   # Fast path (single read, no second read)
 *   npx tsx tools/simulatePipelineLatency.ts --fast
 *
 *   # Custom timings
 *   npx tsx tools/simulatePipelineLatency.ts --fenExtract1 4300 --engineCall 700 --coachingLLM 4200
 *
 *   # Fast path with a turn timeout
 *   npx tsx tools/simulatePipelineLatency.ts --fast --turnTimedOut
 *
 *   # Fast path with a FEN retry
 *   npx tsx tools/simulatePipelineLatency.ts --fast --fenRetried
 */

import { pipelineLatency } from '../src/main/lib/pipeline-latency';

type ConfigKey =
  | 'fenExtract1'
  | 'gapAfterFen1'
  | 'screenshot'
  | 'fenExtract2'
  | 'voteConfirm'
  | 'engineCall'
  | 'engineTip'
  | 'coachingLLM'
  | 'coachingTip';

const defaults: Record<ConfigKey, number> = {
  fenExtract1:  3800,
  gapAfterFen1:  700,
  screenshot:    900,
  fenExtract2:  3600,
  voteConfirm:    10,
  engineCall:    650,
  engineTip:      15,
  coachingLLM:  4200,
  coachingTip:    35,
};

function printUsage(): void {
  console.log(`
Simulates a successful chess coaching latency cycle.

Path flags:
  --fast                  Simulate fast-path (single read, skip second read)
  --slow                  Simulate slow-path (two reads, majority vote) [default]

Timing flags:
  --fenExtract1 <ms>      FEN extraction latency (first / only read)
  --gapAfterFen1 <ms>     Scheduler delay between read 1 and read 2 (slow path only)
  --screenshot <ms>       Screenshot capture + encode latency
  --fenExtract2 <ms>      Vote-read-2 FEN extraction latency (slow path only)
  --voteConfirm <ms>      Vote confirmation latency
  --engineCall <ms>       Engine analysis latency
  --engineTip <ms>        Engine fallback emit latency
  --coachingLLM <ms>      Coaching LLM latency
  --coachingTip <ms>      Coaching parse + emit latency

Metadata flags:
  --fenRetried            Mark this cycle as having needed a FEN retry
  --turnTimedOut          Mark this cycle as having had a turn call timeout

Examples:
  npx tsx tools/simulatePipelineLatency.ts --fast --fenExtract1 12000 --coachingLLM 3500
  npx tsx tools/simulatePipelineLatency.ts --slow --fenExtract1 12000 --fenExtract2 11500
`);
}

interface SimConfig {
  timings: Record<ConfigKey, number>;
  path: 'fast' | 'slow';
  fenRetried: boolean;
  turnTimedOut: boolean;
}

function parseArgs(argv: string[]): SimConfig {
  const timings = { ...defaults };
  let path: 'fast' | 'slow' = 'slow';
  let fenRetried = false;
  let turnTimedOut = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === '--help' || arg === '-h') { printUsage(); process.exit(0); }
    if (arg === '--fast')         { path = 'fast'; continue; }
    if (arg === '--slow')         { path = 'slow'; continue; }
    if (arg === '--fenRetried')   { fenRetried = true; continue; }
    if (arg === '--turnTimedOut') { turnTimedOut = true; continue; }
    if (!arg.startsWith('--')) continue;

    const key = arg.slice(2) as ConfigKey;
    if (!(key in timings)) throw new Error(`Unknown flag: ${arg}`);

    const raw = argv[i + 1];
    if (!raw) throw new Error(`Missing value for ${arg}`);
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid value for ${arg}: ${raw}`);
    timings[key] = value;
    i += 1;
  }

  return { timings, path, fenRetried, turnTimedOut };
}

function advance(nowRef: { value: number }, ms: number): void {
  nowRef.value += ms;
}

function simulateCycle(config: SimConfig): void {
  const realDateNow = Date.now;
  const nowRef = { value: realDateNow() };
  const { timings, path, fenRetried, turnTimedOut } = config;

  try {
    Date.now = () => nowRef.value;

    const cycleId = pipelineLatency.newCycle();

    // seenAt = start of the first FEN read (before screenshot capture in this cycle)
    const seenAt = nowRef.value - timings.gapAfterFen1 - timings.fenExtract1;

    pipelineLatency.setVoteMeta(cycleId, {
      seenAt,
      fenExtract1Ms: timings.fenExtract1,
    });

    pipelineLatency.setPromotionMeta(cycleId, {
      promotionPath: path,
      fenRetried,
      turnTimedOut,
    });

    // ── Steps common to both paths ──────────────────────────────────────────
    pipelineLatency.startStep(cycleId, 'screenshot');
    advance(nowRef, timings.screenshot);
    pipelineLatency.endStep(cycleId, 'screenshot');

    if (path === 'slow') {
      // Slow path: pay for the second FEN extraction read
      pipelineLatency.startStep(cycleId, 'fenExtract');
      advance(nowRef, timings.fenExtract2);
      pipelineLatency.endStep(cycleId, 'fenExtract');
    }
    // Fast path: no second read — fenExtract step is skipped entirely

    pipelineLatency.startStep(cycleId, 'voteConfirm');
    advance(nowRef, path === 'fast' ? 0 : timings.voteConfirm);
    pipelineLatency.endStep(cycleId, 'voteConfirm');

    pipelineLatency.startStep(cycleId, 'engineCall');
    advance(nowRef, timings.engineCall);
    pipelineLatency.endStep(cycleId, 'engineCall');

    pipelineLatency.startStep(cycleId, 'engineTip');
    advance(nowRef, timings.engineTip);
    pipelineLatency.endStep(cycleId, 'engineTip');

    pipelineLatency.startStep(cycleId, 'coachingLLM');
    advance(nowRef, timings.coachingLLM);
    pipelineLatency.endStep(cycleId, 'coachingLLM');

    pipelineLatency.startStep(cycleId, 'coachingTip');
    advance(nowRef, timings.coachingTip);
    pipelineLatency.endStep(cycleId, 'coachingTip');

    pipelineLatency.endCycle(cycleId, 'coachingTip');
  } finally {
    Date.now = realDateNow;
  }
}

function main(): void {
  try {
    const config = parseArgs(process.argv.slice(2));

    console.log(`[simulate-pipeline-latency] path=${config.path} fenRetried=${config.fenRetried} turnTimedOut=${config.turnTimedOut}`);
    console.log('[simulate-pipeline-latency] Input timings (ms):');
    for (const [key, value] of Object.entries(config.timings)) {
      console.log(`  ${key}: ${value}`);
    }

    simulateCycle(config);

    console.log('[simulate-pipeline-latency] Done');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[simulate-pipeline-latency] ${message}`);
    process.exit(1);
  }
}

main();
