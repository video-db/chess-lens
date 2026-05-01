#!/usr/bin/env tsx
/**
 * Simulate one successful chess coaching pipeline cycle and emit the exact
 * pipeline latency summary log shape used by the app.
 *
 * This uses virtual time by temporarily overriding Date.now(), so it runs
 * instantly while still exercising the real PipelineLatency tracker.
 *
 * Usage:
 *   npx tsx tools/simulatePipelineLatency.ts
 *   npx tsx tools/simulatePipelineLatency.ts --screenshot 850 --fenExtract1 4300 --fenExtract2 3900 --engineCall 700 --coachingLLM 4200
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
  fenExtract1: 3800,
  gapAfterFen1: 700,
  screenshot: 900,
  fenExtract2: 3600,
  voteConfirm: 10,
  engineCall: 650,
  engineTip: 15,
  coachingLLM: 4200,
  coachingTip: 35,
};

function printUsage(): void {
  console.log(`
Simulates a successful chess coaching latency cycle.

Flags:
  --fenExtract1 <ms>   Vote-read-1 FEN extraction latency
  --gapAfterFen1 <ms>  Scheduler delay between read 1 and read 2
  --screenshot <ms>    Screenshot capture + encode latency
  --fenExtract2 <ms>   Vote-read-2 FEN extraction latency
  --voteConfirm <ms>   Vote confirmation latency
  --engineCall <ms>    Engine analysis latency
  --engineTip <ms>     Engine fallback emit latency
  --coachingLLM <ms>   Coaching LLM latency
  --coachingTip <ms>   Coaching parse + emit latency

Example:
  npx tsx tools/simulatePipelineLatency.ts --fenExtract1 4200 --screenshot 1100 --coachingLLM 5000
`);
}

function parseArgs(argv: string[]): Record<ConfigKey, number> {
  const config = { ...defaults };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    if (!arg.startsWith('--')) continue;

    const key = arg.slice(2) as ConfigKey;
    if (!(key in config)) {
      throw new Error(`Unknown flag: ${arg}`);
    }

    const raw = argv[i + 1];
    if (!raw) {
      throw new Error(`Missing value for ${arg}`);
    }

    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid numeric value for ${arg}: ${raw}`);
    }

    config[key] = value;
    i += 1;
  }

  return config;
}

function advance(nowRef: { value: number }, ms: number): void {
  nowRef.value += ms;
}

function simulateSuccessfulCycle(config: Record<ConfigKey, number>): void {
  const realDateNow = Date.now;
  const nowRef = { value: realDateNow() };

  try {
    Date.now = () => nowRef.value;

    const cycleId = pipelineLatency.newCycle();
    const seenAt = nowRef.value - config.gapAfterFen1 - config.fenExtract1;

    pipelineLatency.setVoteMeta(cycleId, {
      seenAt,
      fenExtract1Ms: config.fenExtract1,
    });

    pipelineLatency.startStep(cycleId, 'screenshot');
    advance(nowRef, config.screenshot);
    pipelineLatency.endStep(cycleId, 'screenshot');

    pipelineLatency.startStep(cycleId, 'fenExtract');
    advance(nowRef, config.fenExtract2);
    pipelineLatency.endStep(cycleId, 'fenExtract');

    pipelineLatency.startStep(cycleId, 'voteConfirm');
    advance(nowRef, config.voteConfirm);
    pipelineLatency.endStep(cycleId, 'voteConfirm');

    pipelineLatency.startStep(cycleId, 'engineCall');
    advance(nowRef, config.engineCall);
    pipelineLatency.endStep(cycleId, 'engineCall');

    pipelineLatency.startStep(cycleId, 'engineTip');
    advance(nowRef, config.engineTip);
    pipelineLatency.endStep(cycleId, 'engineTip');

    pipelineLatency.startStep(cycleId, 'coachingLLM');
    advance(nowRef, config.coachingLLM);
    pipelineLatency.endStep(cycleId, 'coachingLLM');

    pipelineLatency.startStep(cycleId, 'coachingTip');
    advance(nowRef, config.coachingTip);
    pipelineLatency.endStep(cycleId, 'coachingTip');

    pipelineLatency.endCycle(cycleId, 'coachingTip');
  } finally {
    Date.now = realDateNow;
  }
}

function main(): void {
  try {
    const config = parseArgs(process.argv.slice(2));

    console.log('[simulate-pipeline-latency] Running successful coaching cycle simulation');
    console.log('[simulate-pipeline-latency] Input timings (ms):');
    for (const [key, value] of Object.entries(config)) {
      console.log(`  ${key}: ${value}`);
    }

    simulateSuccessfulCycle(config);

    console.log('[simulate-pipeline-latency] Done');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[simulate-pipeline-latency] ${message}`);
    process.exit(1);
  }
}

main();
