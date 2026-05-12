#!/usr/bin/env tsx
/**
 * tools/benchmarkChess.ts
 *
 * Combined FEN extraction + current-move benchmark.
 * Makes TWO parallel API calls per screenshot: one for FEN and one for
 * current-move / turn signals.
 *
 * The 57 screenshots in game2/ map 1-to-1 with game positions:
 *   index 0  → initial board (before any moves)
 *   index N  → board after ply N
 *
 * FEN metric  : exact-match of extracted board string vs chess.js ground truth
 * Move metric : LLM-only last-move square pair (from/to) derived from
 *               <last_move_from>, <last_move_to>, perspective, and the LLM FEN.
 *
 * Usage:
 * 
 *   npx tsx tools/benchmarkChess.ts <apiKey> [apiUrl]
 *
 * Output:
 *   Console report (FEN section + Turn section) + tools/benchmark-results.json
 */

import fs   from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { Chess } from 'chess.js';
import { getGameFenPrompt, getGameIndexingPrompt, getGameTurnPrompt } from '../src/shared/config/game-coaching';

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_API_URL  = 'https://api.videodb.io';
const VISION_MODEL     = 'openai/gpt-5.4';
const VISION_TIMEOUT   = 30_000;
const INTER_REQUEST_MS = 500;    // pause between calls to avoid rate limits
const GAME2_DIR        = path.join(__dirname, '..', 'game2');
const PGN_PATH         = path.join(GAME2_DIR, 'pgn.txt');
const OUTPUT_PATH      = path.join(__dirname, 'benchmark-results.json');
const EXTRA_PARAMS     = { reasoning_effort: 'low' } as Record<string, unknown>;
const INITIAL_BOARD    = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
const BASE_PROMPT      = getGameIndexingPrompt('chess');
const FEN_PROMPT       = getGameFenPrompt('chess');
const TURN_PROMPT      = getGameTurnPrompt('chess');

// ── Utility ───────────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── Ground-truth: boards from PGN (chess.js) ──────────────────────────────────

function buildGroundTruthBoards(): string[] {
  const pgn     = fs.readFileSync(PGN_PATH, 'utf-8').trim();
  const loader  = new Chess();
  loader.loadPgn(pgn);
  const moves   = loader.history();          // SAN list

  const board   = new Chess();               // fresh replay
  const boards: string[] = [];
  boards.push(board.fen().split(' ')[0]);    // ply 0 = starting position

  for (const move of moves) {
    board.move(move);
    boards.push(board.fen().split(' ')[0]);
  }
  return boards;                             // length == 57
}

interface GroundTruthMove {
  san: string;
  from: string;
  to: string;
  squarePair: string;
}

/** Ground-truth moves by screenshot index: index 0 = null, index N = move that produced board N. */
function buildGroundTruthMoves(): Array<GroundTruthMove | null> {
  const pgn = fs.readFileSync(PGN_PATH, 'utf-8').trim();
  const loader = new Chess();
  loader.loadPgn(pgn);
  const moves = loader.history({ verbose: true });

  const out: Array<GroundTruthMove | null> = [null];
  for (const move of moves) {
    out.push({
      san: move.san,
      from: move.from,
      to: move.to,
      squarePair: `${move.from}${move.to}`,
    });
  }
  return out;
}

// ── LLM extraction ─────────────────────────────────────────────────────────────

interface FenExtractResult {
  fenBoard:    string | null;
  perspective: 'white' | 'black';
  mathError:   string | null;
  rawText:     string;
  retried:     boolean;
}

interface TurnExtractResult {
  perspective:  'white' | 'black';
  reportedTurn: 'w' | 'b' | null;   // T2b: <turn> tag
  lastMoveFrom: string | null;       // algebraic e.g. "e2"
  lastMoveTo:   string | null;       // algebraic e.g. "e4"
  rawText:      string;
  retried:      boolean;
}

function getPieceAtBoardIndices(fenBoard: string, rankIdx: number, fileIdx: number): string | null {
  const ranks = fenBoard.split('/');
  if (ranks.length !== 8) return null;
  const rank = ranks[rankIdx];
  if (!rank) return null;
  let col = 0;
  for (const ch of rank) {
    if (/\d/.test(ch)) {
      const skip = parseInt(ch, 10);
      if (fileIdx < col + skip) return '';
      col += skip;
    } else {
      if (col === fileIdx) return ch;
      col += 1;
    }
    if (col > fileIdx) break;
  }
  return '';
}

function algebraicToIndices(sq: string): { rankIdx: number; fileIdx: number } | null {
  if (!sq || sq.length < 2) return null;
  const fileIdx = sq.charCodeAt(0) - 97; // 'a'=0 … 'h'=7
  const rankIdx = 8 - parseInt(sq[1], 10); // '1'→7, '8'→0
  if (fileIdx < 0 || fileIdx > 7 || rankIdx < 0 || rankIdx > 7) return null;
  return { rankIdx, fileIdx };
}

/** Parse an algebraic tag like <last_move_from>e2</last_move_from> */
function parseAlgebraicTag(text: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>\\s*([a-h][1-8])\\s*</${tag}>`, 'i');
  const m = text.match(re);
  return m ? m[1].toLowerCase() : null;
}

/** Derive turn from algebraic squares — mirrors live-assist.service.ts exactly. */
function deriveTurnFromAlgebraicMove(
  fromSq:   string,
  toSq:     string,
  fenBoard: string,
): 'w' | 'b' | null {
  const fi = algebraicToIndices(fromSq);
  const ti = algebraicToIndices(toSq);
  if (!fi || !ti) return null;
  const fp = getPieceAtBoardIndices(fenBoard, fi.rankIdx, fi.fileIdx);
  const tp = getPieceAtBoardIndices(fenBoard, ti.rankIdx, ti.fileIdx);
  if (fp === null || tp === null) return null;
  let actualTo: string;
  if (tp !== '' && fp === '')      actualTo = tp;
  else if (fp !== '' && tp === '') actualTo = fp;
  else                              return null;
  if (/[A-Z]/.test(actualTo)) return 'b';
  if (/[a-z]/.test(actualTo)) return 'w';
  return null;
}

/** Derive exact move square pair from algebraic squares reported by the LLM. */
function deriveMoveSquarePairFromAlgebraicMove(
  fromSq:   string,
  toSq:     string,
  fenBoard: string,
): { from: string; to: string; squarePair: string } | null {
  const fi = algebraicToIndices(fromSq);
  const ti = algebraicToIndices(toSq);
  if (!fi || !ti) return null;
  const fp = getPieceAtBoardIndices(fenBoard, fi.rankIdx, fi.fileIdx);
  const tp = getPieceAtBoardIndices(fenBoard, ti.rankIdx, ti.fileIdx);
  if (fp === null || tp === null) return null;
  // swap if LLM labelled from/to backwards
  if (tp !== '' && fp === '') return { from: fromSq, to: toSq, squarePair: `${fromSq}${toSq}` };
  if (fp !== '' && tp === '') return { from: toSq, to: fromSq, squarePair: `${toSq}${fromSq}` };
  return null;
}

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function callLLMOnce(
  client:      OpenAI,
  imageBuffer: Buffer,
  prompt:      string,
): Promise<string> {
  const dataUrl = `data:image/png;base64,${imageBuffer.toString('base64')}`;

  type Msg = {
    role: 'user' | 'assistant';
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  };
  const messages: Msg[] = [{
    role: 'user',
    content: [
      { type: 'text',      text: prompt },
      { type: 'image_url', image_url: { url: dataUrl } },
    ],
  }];

  const response = await withTimeout(
    client.chat.completions.create({
      model:      VISION_MODEL,
      messages:   messages as Parameters<typeof client.chat.completions.create>[0]['messages'],
      max_tokens: 1024,
      stream:     false,
      ...EXTRA_PARAMS,
    } as Parameters<typeof client.chat.completions.create>[0]) as Promise<OpenAI.Chat.ChatCompletion>,
    VISION_TIMEOUT,
    'LLM call',
  );

  return response.choices[0]?.message?.content?.trim() ?? '';
}

function parseFenRawText(rawText: string): Omit<FenExtractResult, 'rawText' | 'retried'> {
  const perspMatch = rawText.match(/<perspective>\s*(.*?)\s*<\/perspective>/is);
  const perspective: 'white' | 'black' =
    perspMatch?.[1]?.toLowerCase().includes('black') ? 'black' : 'white';

  const rawBoardMatches = [...rawText.matchAll(/<raw_board>\s*(.*?)\s*<\/raw_board>/gis)];
  if (!rawBoardMatches.length) {
    return { fenBoard: null, perspective, mathError: 'No <raw_board> tag' };
  }

  const rawBoard = rawBoardMatches[rawBoardMatches.length - 1][1]
    .replace(/\s+/g, '').replace(/\n/g, '');

  const ranks = rawBoard.split('/');
  let mathError: string | null = null;
  if (ranks.length !== 8) {
    mathError = `Board has ${ranks.length} ranks instead of 8.`;
  } else {
    for (let i = 0; i < ranks.length; i++) {
      let sq = 0;
      for (const ch of ranks[i]) {
        if (/\d/.test(ch))            sq += parseInt(ch, 10);
        else if (/[a-zA-Z]/.test(ch)) sq += 1;
        else { mathError = `Invalid char '${ch}' in rank ${i + 1}.`; break; }
      }
      if (mathError) break;
      if (sq !== 8) { mathError = `Rank ${i + 1} sums to ${sq} not 8.`; break; }
    }
  }

  if (mathError) return { fenBoard: null, perspective, mathError };

  let fenBoard = rawBoard;
  if (perspective === 'black') {
    const rows = rawBoard.split('/');
    rows.reverse();
    fenBoard = rows.map(r => r.split('').reverse().join('')).join('/');
  }

  return { fenBoard, perspective, mathError: null };
}

function parseTurnRawText(rawText: string): Omit<TurnExtractResult, 'rawText' | 'retried'> {
  const perspMatch = rawText.match(/<perspective>\s*(.*?)\s*<\/perspective>/is);
  const perspective: 'white' | 'black' =
    perspMatch?.[1]?.toLowerCase().includes('black') ? 'black' : 'white';

  const turnMatch = rawText.match(/<turn>\s*(.*?)\s*<\/turn>/is);
  const reportedTurn: 'w' | 'b' | null = turnMatch
    ? (turnMatch[1].toLowerCase().includes('black') ? 'b' : 'w')
    : null;

  return {
    perspective,
    reportedTurn,
    lastMoveFrom: parseAlgebraicTag(rawText, 'last_move_from'),
    lastMoveTo:   parseAlgebraicTag(rawText, 'last_move_to'),
  };
}

async function callFenLLM(
  client: OpenAI,
  imageBuffer: Buffer,
): Promise<{ value: FenExtractResult | null; retried: boolean; error: string | null; latencyMs: number }> {
  const started = Date.now();

  // Retry once only when the board fails strict rank-sum validation.
  let lastError: string | null = null;
  let retried = false;

  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      const correction = attempt === 0 || lastError === null
        ? ''
        : `\n\nYour previous <raw_board> had a mathematical FEN error: ${lastError}\n` +
          `Recount every rank carefully. Each of the 8 ranks must sum to exactly 8 squares.\n` +
          `Correct only <raw_board> and keep <perspective> accurate. Output ONLY <perspective> and <raw_board>.`;

      const rawText = await callLLMOnce(client, imageBuffer, FEN_PROMPT + correction);
      const parsed = parseFenRawText(rawText);

      if (!parsed.mathError && parsed.fenBoard) {
        return {
          value: { ...parsed, rawText, retried },
          retried,
          error: null,
          latencyMs: Date.now() - started,
        };
      }

      lastError = parsed.mathError ?? 'invalid FEN output';
      if (attempt === 0 && parsed.mathError) {
        retried = true;
        continue;
      }

      return {
        value: null,
        retried,
        error: lastError,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      lastError = stringifyError(err);
      return {
        value: null,
        retried,
        error: lastError,
        latencyMs: Date.now() - started,
      };
    }
  }

  return {
    value: null,
    retried,
    error: lastError ?? 'exhausted retries',
    latencyMs: Date.now() - started,
  };
}

async function callTurnLLM(client: OpenAI, imageBuffer: Buffer): Promise<{ value: TurnExtractResult | null; retried: boolean; error: string | null; latencyMs: number }> {
  const started = Date.now();
  try {
    const rawText = await callLLMOnce(client, imageBuffer, TURN_PROMPT);
    const parsed = parseTurnRawText(rawText);
    return {
      value: { ...parsed, rawText, retried: false },
      retried: false,
      error: null,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      value: null,
      retried: false,
      error: stringifyError(err),
      latencyMs: Date.now() - started,
    };
  }
}

// ── Per-square FEN diff helpers ───────────────────────────────────────────────

interface SquareDiff {
  square:   string;   // e.g. 'e4'
  expected: string;   // '' = empty
  got:      string;
}

function expandFen(board: string): string[] {
  const squares: string[] = [];
  for (const rank of board.split('/')) {
    for (const ch of rank) {
      if (/\d/.test(ch)) for (let j = 0; j < parseInt(ch, 10); j++) squares.push('');
      else squares.push(ch);
    }
  }
  return squares;
}

function diffBoards(expected: string, got: string): SquareDiff[] {
  const ea = expandFen(expected);
  const ga = expandFen(got);
  const out: SquareDiff[] = [];
  for (let i = 0; i < 64; i++) {
    if (ea[i] !== ga[i]) {
      const rank = 8 - Math.floor(i / 8);
      const file = String.fromCharCode(97 + (i % 8));
      out.push({ square: `${file}${rank}`, expected: ea[i], got: ga[i] });
    }
  }
  return out;
}

// ── Result type ───────────────────────────────────────────────────────────────

interface ScreenshotResult {
  index:     number;
  filename:  string;
  plyIndex:  number;

  // Ground truth
  expectedBoard: string;
  expectedMoveSan: string | null;
  expectedMoveFrom: string | null;
  expectedMoveTo: string | null;
  expectedMoveSquarePair: string | null;

  // LLM raw output
  fenBoard:        string | null;
  perspective:     'white' | 'black' | null;
  reportedTurn:    'w' | 'b' | null;   // T2b: <turn> tag
  lastMoveFrom:    string | null;       // algebraic e.g. "e2"
  lastMoveTo:      string | null;       // algebraic e.g. "e4"
  llmMoveFrom:     string | null;
  llmMoveTo:       string | null;
  llmMoveSquarePair: string | null;
  gridDerivedTurn: 'w' | 'b' | null;   // T2a: cross-validated against FEN
  finalTurn:       'w' | 'b' | null;
  mathError:       string | null;
  retried:         boolean;
  apiError:        string | null;
  fenLatencyMs:    number | null;
  turnLatencyMs:   number | null;
  totalLatencyMs:  number | null;

  // FEN accuracy
  fenExactMatch: boolean | null;
  wrongSquares:  number | null;
  squareDiffs:   SquareDiff[];
  pieceAccuracy: number | null;

  // Current-move accuracy
  moveSquarePairCorrect: boolean | null;
  t2aCorrect:            boolean | null;
  t2bCorrect:            boolean | null;
  /** Final turn is derived only from LLM signals (T2a/T2b). */
  finalTurnCorrect:      boolean | null;
  tierUsed:              '2a' | '2b' | 'none';
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!args[0] || args[0] === '--help' || args[0] === '-h') {
    console.log('Usage: npx tsx tools/benchmarkChess.ts <apiKey> [apiUrl]');
    process.exit(args[0] ? 0 : 2);
  }

  const apiKey = args[0];
  const apiUrl = args[1] ?? DEFAULT_API_URL;

  const client = new OpenAI({ apiKey, baseURL: apiUrl, timeout: 90_000 });

  // ── Ground truth ────────────────────────────────────────────────────────────
  const gtBoards = buildGroundTruthBoards();
  const gtMoves = buildGroundTruthMoves();
  if (gtBoards.length !== 57) {
    console.error(`Expected 57 ground-truth boards, got ${gtBoards.length}`);
    process.exit(2);
  }
  if (gtMoves.length !== 57) {
    console.error(`Expected 57 ground-truth moves, got ${gtMoves.length}`);
    process.exit(2);
  }

  // ── Screenshot list ─────────────────────────────────────────────────────────
  const pngFiles = fs.readdirSync(GAME2_DIR)
    .filter(f => f.endsWith('.png'))
    .sort();

  if (pngFiles.length !== 57) {
    console.error(`Expected 57 screenshots in game2/, found ${pngFiles.length}`);
    process.exit(2);
  }

  console.log('\nchess-lens — FEN + Turn Detection Benchmark');
  console.log('============================================');
  console.log(`Model   : ${VISION_MODEL}`);
  console.log(`API     : ${apiUrl}`);
  console.log(`Images  : ${pngFiles.length} screenshots (game2/)`);
  console.log(`Prompt  : base=${BASE_PROMPT.length} chars, fen=${FEN_PROMPT.length}, turn=${TURN_PROMPT.length}`);
  console.log(`Tokens  : max_tokens=1024\n`);

  // ── Per-screenshot loop ─────────────────────────────────────────────────────
  const results: ScreenshotResult[] = [];
  for (let i = 0; i < pngFiles.length; i++) {
    const filename      = pngFiles[i];
    const plyIndex      = i;
    const expectedBoard = gtBoards[i];
    const gtMove        = gtMoves[i];
    const shortName     = filename.replace('Screenshot 2026-04-25 ', '').replace('.png', '');

    process.stdout.write(`[${String(i + 1).padStart(2, '0')}/57] ${shortName} (ply ${plyIndex}, gtMove=${gtMove?.squarePair ?? '-'}) ... `);

    const result: ScreenshotResult = {
      index: i,
      filename,
      plyIndex,
      expectedBoard,
      expectedMoveSan: gtMove?.san ?? null,
      expectedMoveFrom: gtMove?.from ?? null,
      expectedMoveTo: gtMove?.to ?? null,
      expectedMoveSquarePair: gtMove?.squarePair ?? null,
      fenBoard: null, perspective: null,
      reportedTurn: null, lastMoveFrom: null, lastMoveTo: null,
      llmMoveFrom: null, llmMoveTo: null, llmMoveSquarePair: null,
      gridDerivedTurn: null, finalTurn: null,
      mathError: null, retried: false, apiError: null,
      fenLatencyMs: null, turnLatencyMs: null, totalLatencyMs: null,
      fenExactMatch: null, wrongSquares: null, squareDiffs: [], pieceAccuracy: null,
      moveSquarePairCorrect: null, t2aCorrect: null, t2bCorrect: null,
      finalTurnCorrect: null, tierUsed: 'none',
    };

    try {
      const imgBuf = fs.readFileSync(path.join(GAME2_DIR, filename));

      const startedAt = Date.now();
      const [fenOutcome, turnOutcome] = await Promise.all([
        callFenLLM(client, imgBuf),
        callTurnLLM(client, imgBuf),
      ]);

      result.totalLatencyMs = Date.now() - startedAt;
      result.fenLatencyMs = fenOutcome.latencyMs;
      result.turnLatencyMs = turnOutcome.latencyMs;
      result.retried = fenOutcome.retried || turnOutcome.retried;

      const errors = [fenOutcome.error, turnOutcome.error].filter((err): err is string => Boolean(err));
      if (errors.length > 0) result.apiError = errors.join(' | ');

      const fenResult = fenOutcome.value;
      const turnResult = turnOutcome.value;

      // ── Store raw LLM output ──────────────────────────────────────────────
      if (fenResult) {
        result.fenBoard = fenResult.fenBoard;
        result.perspective = fenResult.perspective;
        result.mathError = fenResult.mathError;
      }
      if (turnResult) {
        result.reportedTurn = turnResult.reportedTurn;
        result.lastMoveFrom = turnResult.lastMoveFrom;
        result.lastMoveTo = turnResult.lastMoveTo;
        if (!result.perspective) result.perspective = turnResult.perspective;
      }

      // ── FEN accuracy ──────────────────────────────────────────────────────
      if (result.fenBoard) {
        const diffs         = diffBoards(expectedBoard, result.fenBoard);
        result.fenExactMatch = diffs.length === 0;
        result.wrongSquares  = diffs.length;
        result.squareDiffs   = diffs;
        result.pieceAccuracy = (64 - diffs.length) / 64;
      }

      if (result.fenBoard && result.lastMoveFrom && result.lastMoveTo) {
        const movePair = deriveMoveSquarePairFromAlgebraicMove(
          result.lastMoveFrom,
          result.lastMoveTo,
          result.fenBoard,
        );
        result.llmMoveFrom = movePair?.from ?? null;
        result.llmMoveTo = movePair?.to ?? null;
        result.llmMoveSquarePair = movePair?.squarePair ?? null;
        result.gridDerivedTurn = deriveTurnFromAlgebraicMove(
          result.lastMoveFrom,
          result.lastMoveTo,
          result.fenBoard,
        );
      }

      if (result.expectedMoveSquarePair !== null) {
        result.moveSquarePairCorrect = result.llmMoveSquarePair === null
          ? null
          : result.llmMoveSquarePair === result.expectedMoveSquarePair;
      }

      // ── Turn detection — LLM-only (T2a primary, T2b fallback) ────────────
      const t2a = result.gridDerivedTurn;
      const t2b = result.reportedTurn;

      // Cross-validation: when T2a and T2b disagree, T2b wins
      const effectiveT2a = (t2a !== null && t2b !== null && t2a !== t2b) ? null : t2a;
      result.finalTurn = effectiveT2a ?? t2b;
      result.tierUsed  =
        effectiveT2a != null ? '2a' :
        t2b          != null ? '2b' : 'none';

      // ── Per-signal accuracy flags ─────────────────────────────────────────
      const expectedTurn = plyIndex === 0 ? 'w' : (plyIndex % 2 === 1 ? 'b' : 'w');
      if (result.gridDerivedTurn !== null) result.t2aCorrect       = result.gridDerivedTurn === expectedTurn;
      if (result.reportedTurn    !== null) result.t2bCorrect       = result.reportedTurn    === expectedTurn;
      if (result.finalTurn       !== null) result.finalTurnCorrect = result.finalTurn       === expectedTurn;

      // ── Progress line ─────────────────────────────────────────────────────
      const fenMark  = result.fenExactMatch === true  ? '✓'
                     : result.fenExactMatch === false ? `✗(${result.wrongSquares}sq)` : '!(fail)';
      const moveMark = result.moveSquarePairCorrect === true  ? '✓'
                     : result.moveSquarePairCorrect === false ? `✗(${result.llmMoveSquarePair ?? '?'})` : '?';
      const retryNote = result.retried ? ' [retried]' : '';
      console.log(`fen=${fenMark}  move=${moveMark}  tier=${result.tierUsed}  latency=${result.totalLatencyMs ?? 0}ms${retryNote}`);

    } catch (err) {
      result.apiError = err instanceof Error ? err.message : String(err);
      console.log(`ERROR: ${result.apiError}`);
    }

    results.push(result);

    if (i < pngFiles.length - 1) await sleep(INTER_REQUEST_MS);
  }

  // ── Compute stats ────────────────────────────────────────────────────────────
  const total = results.length;

  // FEN
  const fenExtracted   = results.filter(r => r.fenBoard !== null);
  const fenExact       = results.filter(r => r.fenExactMatch === true);
  const fenMismatch    = results.filter(r => r.fenExactMatch === false);
  const fenFailed      = results.filter(r => r.fenExactMatch === null);
  const fenMathErrors  = results.filter(r => r.mathError !== null).length;
  const fenRetried     = results.filter(r => r.retried).length;
  const meanPieceAcc   = fenExtracted.length > 0
    ? fenExtracted.reduce((s, r) => s + (r.pieceAccuracy ?? 0), 0) / fenExtracted.length : 0;

  // Misidentification pairs
  const pairCounts: Record<string, number> = {};
  for (const r of fenMismatch) {
    for (const d of r.squareDiffs) {
      const key = `${d.expected || '.'} → ${d.got || '.'}`;
      pairCounts[key] = (pairCounts[key] ?? 0) + 1;
    }
  }
  const topPairs = Object.entries(pairCounts).sort(([, a], [, b]) => b - a).slice(0, 10);

  // Current move (LLM only)
  const moveScored    = results.filter(r => r.expectedMoveSquarePair !== null);
  const moveDetected  = results.filter(r => r.llmMoveSquarePair !== null);
  const moveCorrect   = results.filter(r => r.moveSquarePairCorrect === true).length;
  const moveIncorrect = results.filter(r => r.moveSquarePairCorrect === false).length;
  const moveMissed    = moveScored.filter(r => r.moveSquarePairCorrect === null).length;

  // Turn
  const turnScored    = results.filter(r => r.finalTurnCorrect !== null);
  const turnCorrect   = results.filter(r => r.finalTurnCorrect === true).length;
  const turnIncorrect = results.filter(r => r.finalTurnCorrect === false).length;
  const t2aFired      = results.filter(r => r.gridDerivedTurn !== null);
  const t2bFired      = results.filter(r => r.reportedTurn    !== null);
  const t2aCorrect    = t2aFired.filter(r => r.t2aCorrect === true).length;
  const t2bCorrect    = t2bFired.filter(r => r.t2bCorrect === true).length;
  const tierCounts: Record<string, number> = { '2a': 0, '2b': 0, 'none': 0 };
  for (const r of results) tierCounts[r.tierUsed] = (tierCounts[r.tierUsed] ?? 0) + 1;
  const hasT2a     = results.filter(r => r.lastMoveFrom !== null && r.lastMoveTo !== null).length;
  const hasT2b     = results.filter(r => r.reportedTurn !== null).length;
  const hasNeither = results.filter(r => r.lastMoveFrom === null && r.lastMoveTo === null && r.reportedTurn === null).length;
  const turnFailures = results.filter(r => r.finalTurnCorrect === false);
  const t2aT2bDisagree = results.filter(r =>
    r.gridDerivedTurn !== null && r.reportedTurn !== null && r.gridDerivedTurn !== r.reportedTurn
  );
  const totalLatencies = results.map(r => r.totalLatencyMs).filter((v): v is number => v !== null);
  const fenLatencies = results.map(r => r.fenLatencyMs).filter((v): v is number => v !== null);
  const turnLatencies = results.map(r => r.turnLatencyMs).filter((v): v is number => v !== null);
  const avgLatency = (values: number[]) => values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
  const avgTotalLatencyMs = avgLatency(totalLatencies);
  const avgFenLatencyMs = avgLatency(fenLatencies);
  const avgTurnLatencyMs = avgLatency(turnLatencies);

  // ── Print report ─────────────────────────────────────────────────────────────
  const SEP = '═'.repeat(70);

  console.log('\n' + SEP);
  console.log('  FEN EXTRACTION ACCURACY');
  console.log(SEP);
  console.log(`\n  Exact-match accuracy  : ${fenExact.length}/${total} = ${(fenExact.length / total * 100).toFixed(1)}%`);
  console.log(`  Exact matches         : ${fenExact.length}`);
  console.log(`  Mismatches            : ${fenMismatch.length}`);
  console.log(`  Failed (no board)     : ${fenFailed.length}`);
  console.log(`  Math errors           : ${fenMathErrors}`);
  console.log(`  Auto-retried          : ${fenRetried}`);
  console.log(`  Mean piece accuracy   : ${(meanPieceAcc * 100).toFixed(1)}% (over ${fenExtracted.length} boards)`);

  if (fenMismatch.length > 0 || fenFailed.length > 0) {
    console.log('\n  ── Mismatches ────────────────────────────────────────────────────────');
    console.log(`  ${'Ply'.padEnd(4)} ${'File'.padEnd(14)} ${'Wrong'.padEnd(7)} ${'Piece%'.padEnd(8)} Retried`);
    console.log('  ' + '─'.repeat(48));
    for (const r of [...fenMismatch, ...fenFailed]) {
      const fn    = r.filename.replace('Screenshot 2026-04-25 ', '').replace('.png', '');
      const wrong = r.wrongSquares != null ? String(r.wrongSquares) : (r.mathError ?? r.apiError ?? '?');
      const pct   = r.pieceAccuracy != null ? `${(r.pieceAccuracy * 100).toFixed(1)}%` : 'N/A';
      console.log(`  ${String(r.plyIndex).padEnd(4)} ${fn.padEnd(14)} ${wrong.padEnd(7)} ${pct.padEnd(8)} ${r.retried ? 'yes' : ''}`);
    }

    console.log('\n  ── Wrong Squares ─────────────────────────────────────────────────────');
    for (const r of fenMismatch) {
      const fn = r.filename.replace('Screenshot 2026-04-25 ', '').replace('.png', '');
      console.log(`\n  Ply ${r.plyIndex}  ${fn}  (${r.wrongSquares} wrong)`);
      for (const d of r.squareDiffs) {
        console.log(`    ${d.square}: expected '${d.expected || '(empty)'}' got '${d.got || '(empty)'}'`);
      }
    }
  }

  if (topPairs.length > 0) {
    console.log('\n  ── Top Misidentification Pairs ───────────────────────────────────────');
    for (const [pair, count] of topPairs) {
      console.log(`    ${pair.padEnd(16)} × ${count}`);
    }
  }

  console.log('\n' + SEP);
  console.log('  CURRENT MOVE ACCURACY');
  console.log(SEP);
  console.log(`\n  Overall accuracy : ${moveCorrect}/${moveScored.length} = ${(moveCorrect / moveScored.length * 100).toFixed(1)}%`);
  console.log(`  Correct          : ${moveCorrect}`);
  console.log(`  Incorrect        : ${moveIncorrect}`);
  console.log(`  Missed           : ${moveMissed}`);
  console.log(`  Detected         : ${moveDetected.length}/${moveScored.length}`);

  const moveFailures = results.filter(r => r.expectedMoveSquarePair !== null && r.moveSquarePairCorrect !== true);
  if (moveFailures.length > 0) {
    console.log('\n  ── Move Failures ─────────────────────────────────────────────────────');
    console.log(`  ${'#'.padEnd(4)} ${'File'.padEnd(14)} ${'Ply'.padEnd(4)} ${'GT'.padEnd(8)} ${'LLM'.padEnd(8)} ${'From'.padEnd(5)} ${'To'.padEnd(5)} Note`);
    console.log('  ' + '─'.repeat(70));
    for (const r of moveFailures) {
      const fn = r.filename.replace('Screenshot 2026-04-25 ', '').replace('.png', '');
      console.log(
        `  ${String(r.index + 1).padEnd(4)} ${fn.padEnd(14)} ${String(r.plyIndex).padEnd(4)} ` +
        `${(r.expectedMoveSquarePair ?? '-').padEnd(8)} ${(r.llmMoveSquarePair ?? '-').padEnd(8)} ` +
        `${(r.llmMoveFrom ?? '-').padEnd(5)} ${(r.llmMoveTo ?? '-').padEnd(5)} ` +
        `${r.mathError ?? r.apiError ?? ''}`,
      );
    }
  } else {
    console.log('\n  ✅  No current-move failures — 100% accuracy!');
  }

  console.log('\n' + SEP);
  console.log('  TURN DETECTION ACCURACY');
  console.log(SEP);
  console.log(`\n  Overall accuracy : ${turnCorrect}/${turnScored.length} = ${(turnCorrect / turnScored.length * 100).toFixed(1)}%`);
  console.log(`  Correct          : ${turnCorrect}`);
  console.log(`  Incorrect        : ${turnIncorrect}`);
  console.log(`  Skipped/error    : ${total - turnScored.length}`);

  console.log('\n  ── Per-Signal Accuracy ───────────────────────────────────────────────');
  const t2aStr = t2aFired.length > 0 ? `${t2aCorrect}/${t2aFired.length} = ${(t2aCorrect/t2aFired.length*100).toFixed(1)}%` : 'N/A';
  const t2bStr = t2bFired.length > 0 ? `${t2bCorrect}/${t2bFired.length} = ${(t2bCorrect/t2bFired.length*100).toFixed(1)}%` : 'N/A';
  console.log(`  T2a (grid-derived, PRIMARY) : ${t2aStr}`);
  console.log(`  T2b (<turn> tag, fallback)  : ${t2bStr}`);

  console.log('\n  ── Tier Usage ────────────────────────────────────────────────────────');
  const tierLabels: Record<string, string> = {
    '2a': 'T2a (grid-derived, single-frame)', '2b': 'T2b (<turn> tag, single-frame)',
    'none': 'None (no LLM move signal)',
  };
  for (const [tier, count] of Object.entries(tierCounts)) {
    if (count > 0) console.log(`  ${(tierLabels[tier] ?? tier).padEnd(36)} : ${count}`);
  }

  console.log('\n  ── Signal Availability ───────────────────────────────────────────────');
  console.log(`  Has grid coords (T2a source) : ${hasT2a}/${total} (${(hasT2a/total*100).toFixed(1)}%)`);
  console.log(`  Has <turn> tag (T2b)         : ${hasT2b}/${total} (${(hasT2b/total*100).toFixed(1)}%)`);
  console.log(`  Has neither                  : ${hasNeither}/${total}`);
  if (t2aT2bDisagree.length > 0) {
    console.log(`  T2a vs T2b disagree          : ${t2aT2bDisagree.length} cases  plies=${t2aT2bDisagree.map(r=>r.plyIndex).join(',')}`);
  }

  console.log('\n  ── Latency ───────────────────────────────────────────────────────────');
  console.log(`  Average total latency : ${avgTotalLatencyMs.toFixed(1)} ms`);
  console.log(`  Average FEN latency   : ${avgFenLatencyMs.toFixed(1)} ms`);
  console.log(`  Average turn latency  : ${avgTurnLatencyMs.toFixed(1)} ms`);

  if (turnFailures.length > 0) {
    console.log('\n  ── Turn Failures ─────────────────────────────────────────────────────');
    console.log(`  ${'#'.padEnd(4)} ${'File'.padEnd(14)} ${'Ply'.padEnd(4)} ${'GT'.padEnd(3)} ${'Got'.padEnd(4)} ${'T2a'.padEnd(4)} ${'T2b'.padEnd(4)} ${'T3'.padEnd(4)} ${'Tier'} Note`);
    console.log('  ' + '─'.repeat(68));
    for (const r of turnFailures) {
      const fn = r.filename.replace('Screenshot 2026-04-25 ', '').replace('.png', '');
      console.log(
        `  ${String(r.index+1).padEnd(4)} ${fn.padEnd(14)} ${String(r.plyIndex).padEnd(4)} ` +
        `${r.expectedTurn.padEnd(3)} ${(r.finalTurn??'?').padEnd(4)} ` +
        `${(r.gridDerivedTurn??'-').padEnd(4)} ${(r.reportedTurn??'-').padEnd(4)} ` +
        `${'-'.padEnd(4)} ${r.tierUsed.padEnd(4)} ` +
        `${r.mathError ?? r.apiError ?? ''}`,
      );
    }
  } else {
    console.log('\n  ✅  No turn failures — 100% accuracy!');
  }

  console.log('\n' + SEP);

  // ── Save JSON ────────────────────────────────────────────────────────────────
  const output = {
    meta: {
      timestamp:    new Date().toISOString(),
      model:        VISION_MODEL,
      apiUrl,
      totalImages:  total,
      promptLength: BASE_PROMPT.length,
    },
    summary: {
      fen: {
        exactMatchAccuracy: `${fenExact.length}/${total} = ${(fenExact.length / total * 100).toFixed(1)}%`,
        exactMatches:       fenExact.length,
        mismatches:         fenMismatch.length,
        failed:             fenFailed.length,
        mathErrors:         fenMathErrors,
        retriedCount:       fenRetried,
        meanPieceAccuracy:  `${(meanPieceAcc * 100).toFixed(1)}%`,
        topMisidentifications: topPairs.map(([pair, count]) => ({ pair, count })),
      },
      move: {
        squarePairAccuracy: `${moveCorrect}/${moveScored.length} = ${(moveCorrect / moveScored.length * 100).toFixed(1)}%`,
        correct: moveCorrect,
        incorrect: moveIncorrect,
        missed: moveMissed,
        detected: moveDetected.length,
      },
      turn: {
        finalAccuracy:  `${turnCorrect}/${turnScored.length} = ${(turnCorrect/turnScored.length*100).toFixed(1)}%`,
        correct:        turnCorrect,
        incorrect:      turnIncorrect,
        t2aAccuracy:    t2aStr,
        t2bAccuracy:    t2bStr,
        tierUsage:      tierCounts,
        signalAvailability: { hasGridTags: hasT2a, hasTurnTag: hasT2b, hasNeither },
        failures:       turnFailures.length,
      },
      latency: {
        averageTotalMs: avgTotalLatencyMs.toFixed(1),
        averageFenMs: avgFenLatencyMs.toFixed(1),
        averageTurnMs: avgTurnLatencyMs.toFixed(1),
      },
    },
    results,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\n  Results saved → ${OUTPUT_PATH}\n`);

  const allOk = fenMismatch.length === 0 && fenFailed.length === 0 && turnFailures.length === 0;
  process.exit(allOk ? 0 : 1);
}

main().catch(err => {
  console.error('\nUnhandled error:', err);
  process.exit(2);
});
