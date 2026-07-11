import type { NativeImage } from 'electron';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { logger } from '../logger';

const log = logger.child({ module: 'chess-screenshot-debug' });

export const DEBUG_FRAMES_ENABLED = process.env.CHESS_DEBUG_FRAMES === '1';

interface DebugVoteEntry {
  fenBoard: string;
  perspective: 'white' | 'black';
  fenExtractMs: number;
  noRetryNeeded: boolean;
  fenRawText: string | null;
  fenRawBoard: string | null;
  fenRetried: boolean;
  fenAutoFixed: boolean;
  rankFixApplied?: boolean;
  rankFixFrom?: string;
  rankFixTo?: string;
  perspectiveFlipRejected?: boolean;
  confidenceDecision?: 'fast' | 'slow' | 'rejected';
  confidenceReasons?: string[];
}

export function getDebugDir(): string {
  const userData = app.getPath('userData');
  const dir = path.join(userData, 'fen-debug');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function saveDebugFrame(opts: {
  seq: number;
  pngBuffer: Buffer;
  rawResult: DebugVoteEntry | null;
  voteBuffer: Array<{ fenBoard: string; perspective: 'white' | 'black' }>;
  votedEntry: DebugVoteEntry | null;
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

    const r = opts.rawResult;
    const v = opts.votedEntry;

    const lines: string[] = [
      `seq:              ${opts.seq}`,
      `timestamp:        ${new Date().toISOString()}`,
      `isBurst:          ${opts.isBurst}`,
      `rawFen:           ${r?.fenBoard ?? 'NULL'}`,
      `perspective:      ${r?.perspective ?? 'N/A'}`,
      `fenExtractMs:     ${r?.fenExtractMs ?? 'N/A'}`,
      `noRetryNeeded:    ${r?.noRetryNeeded ?? 'N/A'}`,
      `fenRetried:       ${r?.fenRetried ?? 'N/A'}`,
      `fenAutoFixed:     ${r?.fenAutoFixed ?? 'N/A'}`,
    ];

    if (r?.fenRawBoard) {
      lines.push(`fenRawBoard:      ${r.fenRawBoard}`);
    }
    if (r?.confidenceDecision) {
      lines.push(`confidence:       ${r.confidenceDecision}`);
    }
    if (r?.confidenceReasons && r.confidenceReasons.length > 0) {
      lines.push(`confidenceReasons: ${r.confidenceReasons.join(', ')}`);
    }
    if (r?.rankFixApplied) {
      lines.push(`rankFixFrom:       ${r.rankFixFrom ?? 'N/A'}`);
      lines.push(`rankFixTo:         ${r.rankFixTo ?? 'N/A'}`);
    }
    if (r?.perspectiveFlipRejected !== undefined) {
      lines.push(`perspFlipRejected: ${r.perspectiveFlipRejected}`);
    }

    lines.push(`voteBuffer:       [${opts.voteBuffer.map((e) => `${e.fenBoard}(${e.perspective})`).join(', ')}]`);
    lines.push(`votedFen:         ${v?.fenBoard ?? 'no consensus'}`);

    if (r?.fenRawText) {
      lines.push('---RAW_LLM_TEXT---');
      lines.push(r.fenRawText);
      lines.push('---END_RAW_LLM_TEXT---');
    }

    fs.writeFileSync(path.join(dir, `${base}.txt`), lines.join('\n'), 'utf8');
  } catch (err) {
    log.warn({ err }, '[ChessScreenshot] Failed to write debug frame');
  }
}

function getRawDebugDir(): string {
  const userData = app.getPath('userData');
  const dir = path.join(userData, 'fen-raw');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function saveRawScreenshot(thumbnail: NativeImage, seq: number, isBurst: boolean): void {
  try {
    const dir = getRawDebugDir();
    const seqStr = String(seq).padStart(4, '0');
    const pngBuffer = thumbnail.toPNG();
    if (!pngBuffer || pngBuffer.length === 0) return;

    fs.writeFileSync(path.join(dir, `${seqStr}_raw.png`), pngBuffer);

    const size = thumbnail.getSize();
    const meta = [
      `seq:         ${seq}`,
      `timestamp:   ${new Date().toISOString()}`,
      `isBurst:     ${isBurst}`,
      `width:       ${size.width}`,
      `height:      ${size.height}`,
    ].join('\n');
    fs.writeFileSync(path.join(dir, `${seqStr}_raw.txt`), meta, 'utf8');
  } catch (err) {
    log.warn({ err }, '[ChessScreenshot] Failed to write raw screenshot');
  }
}
