#!/usr/bin/env tsx
/**
 * Pipeline Latency Log Analyser
 *
 * Parses pino JSON log files (or stdin) for "[PipelineLatency] Cycle summary"
 * entries and prints a per-stage / per-phase breakdown with percentiles.
 *
 * Usage:
 *   # From a saved log file
 *   npx tsx tools/diagnostics/analyzeLatencyLogs.ts path/to/app-YYYY-MM-DD.log
 *
 *   # From multiple files
 *   npx tsx tools/diagnostics/analyzeLatencyLogs.ts logs/app-*.log
 *
 *   # Pipe live dev output  (strip pino-pretty ANSI codes first)
 *   npm run dev 2>&1 | npx tsx tools/diagnostics/analyzeLatencyLogs.ts --stdin
 *
 *   # From Electron userData logs directory (auto-detected)
 *   npx tsx tools/diagnostics/analyzeLatencyLogs.ts --auto
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import os from 'os';

// ─── Types mirroring PipelineLatencyTracker output ───────────────────────────

interface StepRecord {
  [step: string]: number | string; // ms value or "Nms [ERR: ...]"
}

interface PhaseRecord {
  fenStabilizationMs?: number;
  engineAnalysisMs?: number;
  tipGenerationMs?: number;
}

interface CycleSummary {
  cycleId: number;
  reason: string;
  e2eMs?: number;
  totalMs?: number;
  phases?: PhaseRecord;
  steps: StepRecord;
  promotionPath?: 'fast' | 'slow' | 'unknown';
  fenRetried?: boolean;
  turnTimedOut?: boolean;
}

// ─── Percentile helpers ───────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function stats(values: number[]): {
  n: number; min: number; p50: number; p90: number; p95: number; max: number; mean: number;
} {
  if (values.length === 0) return { n: 0, min: 0, p50: 0, p90: 0, p95: 0, max: 0, mean: 0 };
  const s = [...values].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    n:   s.length,
    min: s[0]!,
    p50: percentile(s, 50),
    p90: percentile(s, 90),
    p95: percentile(s, 95),
    max: s[s.length - 1]!,
    mean: Math.round(sum / s.length),
  };
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

const SUMMARY_MSG = '[PipelineLatency] Cycle summary';

/** Strip ANSI escape codes from a string. */
function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[0-9;]*m/g, '');
}

/**
 * pino-pretty (dev mode) emits multi-line blocks like:
 *
 *   [timestamp] INFO: [PipelineLatency] Cycle summary
 *       module: "pipeline-latency"
 *       cycleId: 1
 *       reason: "coachingTip"
 *       e2eMs: 13910
 *       phases: {
 *         "fenStabilizationMs": 9010,
 *         ...
 *       }
 *       steps: {
 *         "screenshot": 900,
 *         ...
 *       }
 *
 * We accumulate lines from the header until we hit the next log entry or EOF,
 * then reconstruct a JSON object from the indented key-value block.
 */
function parsePinoPrettyBlock(block: string): CycleSummary | null {
  const lines = block.split('\n');
  // Collect indented key-value lines after the header
  const kvLines: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const l = stripAnsi(lines[i] ?? '').trimEnd();
    if (!l.trim()) continue;
    kvLines.push(l);
  }
  if (kvLines.length === 0) return null;

  // Reconstruct JSON: wrap in { } and parse
  const jsonBody = '{\n' + kvLines.join('\n') + '\n}';
  try {
    return JSON.parse(jsonBody) as CycleSummary;
  } catch {
    // Try extracting the steps/phases objects directly via regex
    const extract = (key: string): Record<string, unknown> | null => {
      const re = new RegExp(`"?${key}"?\\s*:\\s*(\\{[\\s\\S]*?\\})`, 'm');
      const m = jsonBody.match(re);
      if (!m) return null;
      try { return JSON.parse(m[1]) as Record<string, unknown>; } catch { return null; }
    };
    const extractNum = (key: string): number | undefined => {
      const re = new RegExp(`"?${key}"?\\s*:\\s*(\\d+)`, 'm');
      const m = jsonBody.match(re);
      return m ? parseInt(m[1], 10) : undefined;
    };
    const extractStr = (key: string): string | undefined => {
      const re = new RegExp(`"?${key}"?\\s*:\\s*"([^"]+)"`, 'm');
      const m = jsonBody.match(re);
      return m ? m[1] : undefined;
    };
    return {
      cycleId:       extractNum('cycleId') ?? 0,
      reason:        extractStr('reason')  ?? '',
      e2eMs:         extractNum('e2eMs'),
      totalMs:       extractNum('totalMs'),
      phases:        extract('phases')  as PhaseRecord | undefined,
      steps:         (extract('steps') ?? {}) as StepRecord,
      promotionPath: extractStr('promotionPath') as 'fast' | 'slow' | 'unknown' | undefined,
      fenRetried:    jsonBody.includes('"fenRetried": true')  || jsonBody.includes('fenRetried: true'),
      turnTimedOut:  jsonBody.includes('"turnTimedOut": true') || jsonBody.includes('turnTimedOut: true'),
    };
  }
}

function parseLine(line: string): CycleSummary | null {
  const stripped = stripAnsi(line).trim();

  // Production: single-line pino JSON
  if (stripped.startsWith('{')) {
    try {
      const obj = JSON.parse(stripped) as Record<string, unknown>;
      if (typeof obj.msg === 'string' && obj.msg.includes('Cycle summary')) {
        return obj as unknown as CycleSummary;
      }
    } catch { /* not JSON */ }
  }

  // pino-pretty: inline JSON on same line as message (some versions)
  if (stripped.includes(SUMMARY_MSG)) {
    const jsonStart = stripped.indexOf('{"cycleId"');
    if (jsonStart !== -1) {
      try { return JSON.parse(stripped.slice(jsonStart)) as CycleSummary; } catch { /* ignore */ }
    }
  }

  return null;
}

/**
 * Process a stream of lines, handling both:
 *   - Single-line pino JSON (production)
 *   - Multi-line pino-pretty blocks (dev / --stdin)
 */
function extractStepMs(raw: number | string | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'number') return raw;
  // "1234ms [ERR: ...]" or "1234ms"
  const m = String(raw).match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

interface Accumulator {
  [key: string]: number[];
}

interface Counters {
  fast: number;
  slow: number;
  unknown: number;
  fenRetried: number;
  turnTimedOut: number;
  total: number;
}

function processCycle(cycle: CycleSummary, acc: Accumulator, counters: Counters): void {
  const add = (key: string, val: number | null | undefined) => {
    if (val == null || !Number.isFinite(val)) return;
    if (!acc[key]) acc[key] = [];
    acc[key]!.push(val);
  };

  add('e2e', cycle.e2eMs);
  add('totalMs', cycle.totalMs);
  add('phase.fenStabilization', cycle.phases?.fenStabilizationMs);
  add('phase.engineAnalysis',   cycle.phases?.engineAnalysisMs);
  add('phase.tipGeneration',    cycle.phases?.tipGenerationMs);

  for (const [step, raw] of Object.entries(cycle.steps ?? {})) {
    add(`step.${step}`, extractStepMs(raw as number | string));
  }

  // Per-path e2e breakdowns
  const path = cycle.promotionPath ?? 'unknown';
  add(`e2e.${path}`, cycle.e2eMs);
  add(`phase.fenStabilization.${path}`, cycle.phases?.fenStabilizationMs);

  // Counters
  counters.total++;
  if (path === 'fast')        counters.fast++;
  else if (path === 'slow')   counters.slow++;
  else                        counters.unknown++;
  if (cycle.fenRetried)   counters.fenRetried++;
  if (cycle.turnTimedOut) counters.turnTimedOut++;
}

// ─── Formatting ──────────────────────────────────────────────────────────────

const COL = { label: 28, n: 5, min: 7, mean: 7, p50: 7, p90: 7, p95: 7, max: 7 };

function pad(s: string | number, w: number, right = false): string {
  const str = String(s);
  return right ? str.padStart(w) : str.padEnd(w);
}

function header(): string {
  return [
    pad('Metric', COL.label),
    pad('N',    COL.n,    true),
    pad('min',  COL.min,  true),
    pad('mean', COL.mean, true),
    pad('p50',  COL.p50,  true),
    pad('p90',  COL.p90,  true),
    pad('p95',  COL.p95,  true),
    pad('max',  COL.max,  true),
  ].join('  ');
}

function separator(): string {
  return '─'.repeat(header().length);
}

function row(label: string, values: number[]): string {
  const s = stats(values);
  if (s.n === 0) return '';
  return [
    pad(label, COL.label),
    pad(s.n,    COL.n,    true),
    pad(s.min,  COL.min,  true),
    pad(s.mean, COL.mean, true),
    pad(s.p50,  COL.p50,  true),
    pad(s.p90,  COL.p90,  true),
    pad(s.p95,  COL.p95,  true),
    pad(s.max,  COL.max,  true),
  ].join('  ');
}

function print(acc: Accumulator, counters: Counters): void {
  const cycleCount = counters.total;
  console.log('');
  console.log(`  Chess-Lens Pipeline Latency Analysis  (${cycleCount} completed coaching cycles)`);
  console.log('  All times in milliseconds');
  console.log('');

  // ── Promotion path summary ────────────────────────────────────────────────
  const pct = (n: number) => cycleCount > 0 ? `${Math.round((n / cycleCount) * 100)}%` : '–';
  console.log(`  Promotion path:  fast=${counters.fast} (${pct(counters.fast)})  slow=${counters.slow} (${pct(counters.slow)})  unknown=${counters.unknown}`);
  console.log(`  FEN retried:     ${counters.fenRetried}/${cycleCount} (${pct(counters.fenRetried)})`);
  console.log(`  Turn timed out:  ${counters.turnTimedOut}/${cycleCount} (${pct(counters.turnTimedOut)})`);
  console.log('');

  console.log('  ' + header());
  console.log('  ' + separator());

  // End-to-end (all cycles)
  const e2eRow = row('e2e (all cycles)', acc['e2e'] ?? []);
  if (e2eRow) console.log('  ' + e2eRow);

  // Per-path e2e breakdown
  const e2eFastRow = row('  e2e fast-path', acc['e2e.fast'] ?? []);
  if (e2eFastRow) console.log('  ' + e2eFastRow);
  const e2eSlowRow = row('  e2e slow-path', acc['e2e.slow'] ?? []);
  if (e2eSlowRow) console.log('  ' + e2eSlowRow);

  const totalRow = row('totalMs (cycle window)', acc['totalMs'] ?? []);
  if (totalRow) console.log('  ' + totalRow);

  console.log('  ' + separator());
  console.log('  PHASES');
  console.log('  ' + separator());

  const phases = [
    ['phase.fenStabilization',       'fenStabilization (all)'],
    ['phase.fenStabilization.fast',  '  fenStabilization fast'],
    ['phase.fenStabilization.slow',  '  fenStabilization slow'],
    ['phase.engineAnalysis',         'engineAnalysis'],
    ['phase.tipGeneration',          'tipGeneration'],
  ] as const;
  for (const [key, label] of phases) {
    const r = row(label, acc[key] ?? []);
    if (r) console.log('  ' + r);
  }

  console.log('  ' + separator());
  console.log('  STEPS');
  console.log('  ' + separator());

  const stepOrder = [
    'step.screenshot',
    'step.fenExtract1',
    'step.fenExtract2',
    'step.fenExtract',   // fallback when split not available
    'step.voteConfirm',
    'step.engineCall',
    'step.engineTip',
    'step.coachingLLM',
    'step.coachingTip',
  ];

  // Print known steps in order, then any extras
  const printed = new Set<string>();
  for (const key of stepOrder) {
    const vals = acc[key] ?? [];
    if (vals.length === 0) continue;
    const r = row(key.replace('step.', ''), vals);
    if (r) { console.log('  ' + r); printed.add(key); }
  }
  for (const [key, vals] of Object.entries(acc)) {
    if (!key.startsWith('step.') || printed.has(key)) continue;
    const r = row(key.replace('step.', ''), vals);
    if (r) console.log('  ' + r);
  }

  console.log('  ' + separator());
  console.log('');

  // Dominant stage callout — exclude per-path e2e keys, only compare real steps
  const stageKeys = stepOrder.filter(k => (acc[k] ?? []).length > 0);
  if (stageKeys.length > 0) {
    const dominant = stageKeys.reduce((best, k) => {
      const bP90 = stats(acc[best] ?? []).p90;
      const kP90 = stats(acc[k]    ?? []).p90;
      return kP90 > bP90 ? k : best;
    });
    const dStats = stats(acc[dominant] ?? []);
    console.log(`  ⚡ Dominant stage (p90): ${dominant.replace('step.','')}  →  ${dStats.p90} ms`);
    console.log('');
  }
}

// ─── Auto-detect log directory ────────────────────────────────────────────────

function autoDetectLogs(): string[] {
  const candidates = [
    // Windows — APPDATA env var takes priority (matches Electron userData exactly)
    process.env.APPDATA ? path.join(process.env.APPDATA, 'chess-lens', 'logs') : null,
    path.join(os.homedir(), 'AppData', 'Roaming', 'chess-lens', 'logs'),
    path.join(os.homedir(), 'AppData', 'Local', 'chess-lens', 'logs'),
    // macOS
    path.join(os.homedir(), 'Library', 'Application Support', 'chess-lens', 'logs'),
    // Linux
    path.join(os.homedir(), '.config', 'chess-lens', 'logs'),
  ].filter((p): p is string => p !== null);
  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.log'))
      .map(f => path.join(dir, f))
      .sort()
      .reverse()
      .slice(0, 5); // most recent 5 days
    if (files.length) {
      console.log(`  Auto-detected logs in: ${dir}`);
      return files;
    }
  }
  return [];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function makeCounters(): Counters {
  return { fast: 0, slow: 0, unknown: 0, fenRetried: 0, turnTimedOut: 0, total: 0 };
}

async function processLineStream(
  lines: AsyncIterable<string>,
  acc: Accumulator,
  counters: Counters,
): Promise<number> {
  let count = 0;
  let inBlock = false;
  let blockLines: string[] = [];

  const flushBlock = () => {
    if (blockLines.length === 0) return;
    const cycle = parsePinoPrettyBlock(blockLines.join('\n'));
    if (cycle) { processCycle(cycle, acc, counters); count++; }
    blockLines = [];
    inBlock = false;
  };

  for await (const rawLine of lines) {
    const line = rawLine;
    const stripped = stripAnsi(line).trim();

    const isNewEntry = /^\[[\d\-: .+]+\]/.test(stripped);

    if (isNewEntry) {
      if (inBlock) flushBlock();
      if (stripped.includes(SUMMARY_MSG)) {
        inBlock = true;
        blockLines = [line];
      } else {
        const cycle = parseLine(line);
        if (cycle) { processCycle(cycle, acc, counters); count++; }
      }
    } else if (inBlock) {
      blockLines.push(line);
    } else {
      const cycle = parseLine(line);
      if (cycle) { processCycle(cycle, acc, counters); count++; }
    }
  }

  if (inBlock) flushBlock();
  return count;
}

// kept for compatibility
async function processLines(lines: AsyncIterable<string>, acc: Accumulator, counters: Counters): Promise<number> {
  return processLineStream(lines, acc, counters);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const acc: Accumulator = {};
  const counters = makeCounters();

  if (args.includes('--stdin')) {
    console.log('  Reading from stdin … (press Ctrl+C to stop and print results)');
    const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    await processLines(rl, acc, counters);
  } else {
    let files: string[] = args.filter(a => !a.startsWith('--'));

    if (args.includes('--auto') || files.length === 0) {
      files = autoDetectLogs();
      if (files.length === 0) {
        console.error([
          '',
          '  No log files found.',
          '',
          '  Log files are written to:',
          `    Windows: %APPDATA%\\chess-lens\\logs\\app-YYYY-MM-DD.log`,
          `    macOS:   ~/Library/Application Support/chess-lens/logs/app-YYYY-MM-DD.log`,
          '  The file is created on first app run (dev or production).',
          '  In dev mode, run the app with npm run dev and pipe stdout:',
          '',
          '    npm run dev 2>&1 | npx tsx tools/diagnostics/analyzeLatencyLogs.ts --stdin',
          '',
          '  Or pass a log file path directly:',
          '    npx tsx tools/diagnostics/analyzeLatencyLogs.ts path/to/app-YYYY-MM-DD.log',
          '',
        ].join('\n'));
        process.exit(1);
      }
    }

    for (const file of files) {
      if (!fs.existsSync(file)) {
        console.warn(`  Skipping missing file: ${file}`);
        continue;
      }
      console.log(`  Reading: ${file}`);
      const rl = readline.createInterface({
        input: fs.createReadStream(file, { encoding: 'utf8' }),
        crlfDelay: Infinity,
      });
      await processLines(rl, acc, counters);
    }
  }

  if (counters.total === 0) {
    console.error([
      '',
      '  No [PipelineLatency] Cycle summary lines found.',
      '',
      '  Tips:',
      '  - Coaching cycles only log when they complete successfully (reason = coachingTip).',
      '  - Make at least one move and wait for the coaching tip to appear in the overlay.',
      '  - In dev mode use --stdin to capture live output.',
      '',
    ].join('\n'));
    process.exit(1);
  }

  print(acc, counters);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
