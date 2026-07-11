#!/usr/bin/env tsx
/**
 * Extracts FEN accuracy from app log files.
 *
 * Scans the log for all "Selected latest chess FEN" entries,
 * groups by source (screenshot vs rtstream), and compares
 * against the benchmark PGN ground truth.
 *
 * Usage:
 *   npx tsx tools/diagnostics/extract_fens_from_logs.ts [logPath]
 *
 * Default log: %APPDATA%/chess-lens/logs/app-2026-06-11.log
 */

import fs from 'fs';
import path from 'path';
import { Chess } from 'chess.js';

const BENCHMARK_PGN = `1. e4 e6 2. Nc3 b6 3. Nf3 Bb7 4. Bc4 d6 5. d3 Nf6 6. h3 Be7 7. O-O O-O 8. Bg5
Nbd7 9. Qd2 h6 10. Bxf6 Nxf6 11. Bb3 d5 12. e5 Nh7 13. d4 a6 14. Ne2 c5 15. c3
c4 16. Bc2 Ng5 17. Nh2 Bc6 18. Ng4 b5 19. h4 Nh7 20. Nxh6+ Kh8 21. g3 g6 22. Ng4
Bxh4 23. gxh4 Qxh4 24. Qf4 f5 25. Nf6 Qxf4 26. Nxf4 Nxf6 27. Nxg6+ Kg7 28. Nxf8
Rxf8 29. exf6+ Kxf6 30. Kg2 Rg8+ 31. Kf3 Be8 32. Rg1 Bh5+ 33. Ke3 Rg4 34. Rxg4
Bxg4 35. Bd1 Bxd1 36. Rxd1`;

function generateGroundTruth(): string[] {
  const game = new Chess();
  const fens: string[] = [game.fen().split(' ')[0]!];
  const cleaned = BENCHMARK_PGN.replace(/\n/g, ' ').replace(/\{.*?\}/g, '').trim();
  const tokens = cleaned.split(/\s+/);
  for (const tok of tokens) {
    if (/^\d+\./.test(tok)) continue;
    try { game.move(tok); fens.push(game.fen().split(' ')[0]!); } catch { /* skip */ }
  }
  return fens;
}

interface FenEntry {
  timestamp: string;
  time: number;
  source: string;
  fenBoard: string;
  gtMatch: boolean;
}

function main() {
  const logPath = process.argv[2]
    || path.join(process.env['APPDATA'] || '', 'chess-lens', 'logs', 'app-2026-06-11.log');

  if (!fs.existsSync(logPath)) {
    console.error(`Log file not found: ${logPath}`);
    process.exit(1);
  }

  const gt = generateGroundTruth();
  console.log(`Ground truth: ${gt.length} positions`);

  const entries: FenEntry[] = [];
  const lines = fs.readFileSync(logPath, 'utf8').split('\n');

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (!obj.msg || !obj.msg.includes('Selected latest chess FEN')) continue;

      const source = obj.source || 'unknown';
      const fen = obj.fen || '';
      const fenBoard = fen.split(' ')[0]!;

      entries.push({
        timestamp: new Date(obj.time).toISOString(),
        time: obj.time,
        source,
        fenBoard,
        gtMatch: gt.includes(fenBoard),
      });
    } catch { /* skip */ }
  }

  console.log(`Total FEN selections logged: ${entries.length}`);

  const bySource = new Map<string, FenEntry[]>();
  for (const e of entries) {
    const list = bySource.get(e.source) ?? [];
    list.push(e);
    bySource.set(e.source, list);
  }

  for (const [source, sourceEntries] of bySource) {
    const seen = new Set<string>();
    const uniqueFens: FenEntry[] = [];
    for (const e of sourceEntries) {
      if (!seen.has(e.fenBoard)) {
        seen.add(e.fenBoard);
        uniqueFens.push(e);
      }
    }

    // Deduplicate consecutive duplicates (keep only first occurrence)
    const nonConsecutive: FenEntry[] = [];
    for (let i = 0; i < sourceEntries.length; i++) {
      const curr = sourceEntries[i]!;
      const prev = sourceEntries[i - 1];
      if (!prev || curr.fenBoard !== prev.fenBoard) {
        nonConsecutive.push(curr);
      }
    }

    const correct = uniqueFens.filter((e) => e.gtMatch).length;

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Source: ${source}`);
    console.log(`${'─'.repeat(60)}`);
    console.log(`Total selections:            ${sourceEntries.length}`);
    console.log(`Unique FENs:                 ${uniqueFens.length}`);
    console.log(`Non-consecutive selections:  ${nonConsecutive.length}`);
    console.log(`Matched to GT:               ${correct}/${uniqueFens.length}  (${uniqueFens.length > 0 ? (100 * correct / uniqueFens.length).toFixed(1) : 'N/A'}%)`);

    console.log(`\nUnique FENs:`);
    for (const e of uniqueFens) {
      const marker = e.gtMatch ? '✓' : '✗';
      console.log(`  ${marker} [${e.timestamp.slice(11, 19)}] ${e.fenBoard}`);
    }

    const errors = uniqueFens.filter((e) => !e.gtMatch);
    if (errors.length > 0) {
      console.log(`\nUnmatched (${errors.length}):`);
      for (const e of errors) {
        console.log(`    ${e.fenBoard}`);
      }
    }
  }

  // ── Head-to-head ──────────────────────────────────────────────────
  const sEntries = bySource.get('screenshot_raw_board') ?? [];
  const rEntries = bySource.get('rtstream_raw_board') ?? [];

  if (sEntries.length > 0 && rEntries.length > 0) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`HEAD-TO-HEAD`);
    console.log(`${'='.repeat(60)}`);

    const timeline = [...sEntries, ...rEntries].sort((a, b) => a.time - b.time);
    let sCorrections = 0;
    let rCorrections = 0;

    for (let i = 1; i < timeline.length; i++) {
      const prev = timeline[i - 1]!;
      const curr = timeline[i]!;
      if (prev.source === 'screenshot_raw_board' && curr.source === 'rtstream_raw_board') {
        if (!prev.gtMatch && curr.gtMatch) {
          rCorrections++;
          console.log(`\n  RTStream corrected screenshot:`);
          console.log(`    WRONG (screenshot): ${prev.fenBoard}`);
          console.log(`    RTStream:           ${curr.fenBoard}`);
        }
      }
      if (prev.source === 'rtstream_raw_board' && curr.source === 'screenshot_raw_board') {
        if (!prev.gtMatch && curr.gtMatch) {
          sCorrections++;
          console.log(`\n  Screenshot corrected RTStream:`);
          console.log(`    WRONG (RTStream):   ${prev.fenBoard}`);
          console.log(`    Screenshot:         ${curr.fenBoard}`);
        }
      }
    }

    console.log(`\nRTStream corrections of screenshot:  ${rCorrections}`);
    console.log(`Screenshot corrections of RTStream:   ${sCorrections}`);
  }

  // ── RTStream FEN latency ───────────────────────────────────────────
  const rtMsgs = (() => {
    const msgLines: Array<{ time: number; preview: string }> = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.msg === '[WS] Forwarded RTStream chess FEN via raw path' && obj.preview) {
          msgLines.push({ time: obj.time, preview: obj.preview });
        }
      } catch { /* skip */ }
    }
    return msgLines;
  })();

  if (rtMsgs.length > 0) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`RTStream WebSocket messages: ${rtMsgs.length}`);
    if (rtMsgs.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < rtMsgs.length; i++) {
        intervals.push(rtMsgs[i]!.time - rtMsgs[i - 1]!.time);
      }
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      console.log(`Average interval between messages: ${(avgInterval / 1000).toFixed(1)}s`);
    }
  }
}

main();
