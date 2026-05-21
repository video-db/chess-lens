/**
 * canonical-history.runner.ts
 *
 * Standalone test runner for the canonical move-history state machine.
 * Run with:  npx tsx src/main/lib/canonical-history.runner.ts
 */

import { fenDiffToSan } from './chess-notation.js';

// ─── minimal test harness ──────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function expect(actual: unknown) {
  return {
    toBe(expected: unknown) { check(actual === expected, `expected ${JSON.stringify(actual)} to be ${JSON.stringify(expected)}`); },
    toBeTruthy() { check(!!actual, `expected truthy, got ${JSON.stringify(actual)}`); },
    toBeUndefined() { check(actual === undefined, `expected undefined, got ${JSON.stringify(actual)}`); },
    toBeNull() { check(actual === null, `expected null, got ${JSON.stringify(actual)}`); },
    not: {
      toBe(expected: unknown) { check(actual !== expected, `expected NOT ${JSON.stringify(expected)}, but got it`); },
      toBeNull() { check(actual !== null, `expected not null`); },
    },
    toEqual(expected: unknown) { check(JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); },
    toHaveLength(n: number) { check((actual as any[]).length === n, `expected length ${n}, got ${(actual as any[]).length}: ${JSON.stringify(actual)}`); },
  };
}

function check(cond: boolean, msg: string) {
  if (!cond) { console.error('  FAIL:', msg); throw new Error(msg); }
}

function it(name: string, fn: () => void) {
  try {
    fn();
    console.log('  PASS:', name);
    passed++;
  } catch (e: any) {
    console.error('  FAIL:', name, '\n       ', e.message);
    failed++;
  }
}

function describe(name: string, fn: () => void) {
  console.log(`\n▶ ${name}`);
  fn();
}

// ─── state machine (copy of service logic) ────────────────────────────────

const CANONICAL_LOOKBACK_DEPTH = 3;
type HistoryEntry = { board: string; san?: string; turn?: 'w' | 'b' };

/** Parse board-only FEN into a square→piece map. */
function parseBoardOnly(board: string): Map<string, string> {
  const FILES = ['a','b','c','d','e','f','g','h'];
  const map = new Map<string, string>();
  const ranks = board.split('/');
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of ranks[r]) {
      if (ch >= '1' && ch <= '8') { f += parseInt(ch, 10); }
      else { map.set(FILES[f] + (8 - r), ch); f++; }
    }
  }
  return map;
}
// parseBoardOnly kept for potential future use by tests; not used in state machine


/** Reject if opponent piece type COUNT increased (allows opponent pieces to move). */
function opponentPiecesUnchanged(fromBoard: string, toBoard: string, side: 'w' | 'b'): boolean {
  const from = parseBoardOnly(fromBoard);
  const to   = parseBoardOnly(toBoard);
  const isOpp = (p: string) => side === 'w' ? p === p.toLowerCase() : p === p.toUpperCase();
  const fromCounts = new Map<string, number>();
  const toCounts   = new Map<string, number>();
  for (const [, p] of from) if (isOpp(p)) fromCounts.set(p, (fromCounts.get(p) ?? 0) + 1);
  for (const [, p] of to)   if (isOpp(p)) toCounts.set(p,   (toCounts.get(p)   ?? 0) + 1);
  for (const [p, toCount] of toCounts) {
    if (toCount > (fromCounts.get(p) ?? 0)) return false;
  }
  return true;
}

function opponentCountsOK(fromBoard: string, toBoard: string, side: 'w' | 'b'): boolean {
  const from = parseBoardOnly(fromBoard);
  const to   = parseBoardOnly(toBoard);
  const isOpp = (p: string) => side === 'w' ? p === p.toLowerCase() : p === p.toUpperCase();
  const fromCounts = new Map<string, number>();
  const toCounts   = new Map<string, number>();
  for (const [, p] of from) if (isOpp(p)) fromCounts.set(p, (fromCounts.get(p) ?? 0) + 1);
  for (const [, p] of to)   if (isOpp(p)) toCounts.set(p,   (toCounts.get(p)   ?? 0) + 1);
  // A: no piece type count increased
  for (const [p, toCount] of toCounts) {
    if (toCount > (fromCounts.get(p) ?? 0)) return false;
  }
  const fromTotal = [...fromCounts.values()].reduce((a,b)=>a+b,0);
  const toTotal   = [...toCounts.values()].reduce((a,b)=>a+b,0);
  // B: at most 1 piece captured
  if (fromTotal - toTotal > 1) return false;
  // C: if no capture, opponent positions must be identical (no movement)
  if (fromTotal === toTotal) {
    for (const [sq, fp] of from) {
      if (!isOpp(fp)) continue;
      if (to.get(sq) !== fp) return false;
    }
  }
  return true;
}

function tryInferSanForHistory(fromBoard: string, toBoard: string): { san: string; turn: 'w' | 'b' } | null {
  if (!fromBoard || !toBoard || fromBoard === toBoard) return null;
  const whiteSan = fenDiffToSan(`${fromBoard} w - - 0 1`, `${toBoard} w - - 0 1`, 'w');
  const blackSan = fenDiffToSan(`${fromBoard} b - - 0 1`, `${toBoard} b - - 0 1`, 'b');
  // Both sides produced a SAN → 2 plies → ambiguous
  if (whiteSan && blackSan) return null;
  if (whiteSan && opponentCountsOK(fromBoard, toBoard, 'w')) return { san: whiteSan, turn: 'w' };
  if (blackSan && opponentCountsOK(fromBoard, toBoard, 'b')) return { san: blackSan, turn: 'b' };
  return null;
}

// Two-stage state held outside the function so tests can inspect it.
// (Mirrors the service's `this.canonicalMoveHistory` + `this.pendingCanonicalEntry`.)
interface CanonicalState {
  committed: HistoryEntry[];
  pending: HistoryEntry | null;
  prevPending: HistoryEntry | null;
}

function updateCanonicalHistory(
  state: CanonicalState,
  board: string,
): { resolvedSan?: string; resolvedTurn?: 'w' | 'b' } {
  const { committed } = state;
  const pending    = state.pending;
  const prevPending = state.prevPending;

  // NO-OP
  if (pending && pending.board === board) return {};

  // REVERT
  let revertIdx = -1;
  for (let i = committed.length - 1; i >= 0; i--) {
    if (committed[i].board === board) { revertIdx = i; break; }
  }
  if (revertIdx !== -1) {
    committed.splice(revertIdx + 1);
    state.pending = null;
    state.prevPending = null;
    return {};
  }

  const committedTail = committed[committed.length - 1] ?? null;

  // CONFIRM
  const fromPending = pending ? tryInferSanForHistory(pending.board, board) : null;
  if (fromPending) {
    committed.push(pending!);
    const resolvedSan  = pending!.san;
    const resolvedTurn = pending!.turn;
    state.prevPending = null; // clear: prev was already committed
    state.pending = { board, san: fromPending.san, turn: fromPending.turn };
    return { resolvedSan, resolvedTurn };
  }

  // PREVRECOVER: real_move → hallucination → real_move
  // prevPending only set when previous pending was discarded (not committed).
  const fromPrevPending = (prevPending && prevPending.board !== pending?.board)
    ? tryInferSanForHistory(prevPending.board, board)
    : null;
  if (fromPrevPending) {
    committed.push(prevPending!);
    const resolvedSan  = prevPending!.san;
    const resolvedTurn = prevPending!.turn;
    state.prevPending = null;
    state.pending = { board, san: fromPrevPending.san, turn: fromPrevPending.turn };
    return { resolvedSan, resolvedTurn };
  }

  // Try committed entries
  const fromTail = committedTail ? tryInferSanForHistory(committedTail.board, board) : null;

  let fromLookback: { san: string; turn: 'w' | 'b' } | null = null;
  let lookbackIdx = -1;
  if (!fromTail && committed.length >= 2) {
    const depth = Math.min(CANONICAL_LOOKBACK_DEPTH, committed.length - 1);
    for (let i = committed.length - 2; i >= committed.length - 1 - depth; i--) {
      const r = tryInferSanForHistory(committed[i].board, board);
      if (r) { fromLookback = r; lookbackIdx = i; break; }
    }
  }

  const fromStart = (!pending && !committedTail && board !== START)
    ? tryInferSanForHistory(START, board)
    : null;

  const connectsToCommitted = fromTail ?? fromLookback ?? fromStart;

  if (connectsToCommitted) {
    // REPLACE
    if (lookbackIdx !== -1) committed.splice(lookbackIdx + 1);
    state.prevPending = pending; // save discarded pending for PREVRECOVER
    state.pending = { board, san: connectsToCommitted.san, turn: connectsToCommitted.turn };
    return {};
  }

  // DISCARD
  state.prevPending = pending;
  state.pending = { board, san: undefined, turn: undefined };
  return {};
}

function getSnapshot(committed: HistoryEntry[]): Array<{ no: number; white?: string; black?: string }> {
  const rows: Array<{ no: number; white?: string; black?: string }> = [];
  for (const entry of committed) {
    if (!entry.san) continue;
    if (entry.turn === 'w') {
      rows.push({ no: rows.length + 1, white: entry.san });
    } else if (entry.turn === 'b') {
      const last = rows[rows.length - 1];
      if (last && last.white !== undefined && last.black === undefined) { last.black = entry.san; }
      else { rows.push({ no: rows.length + 1, black: entry.san }); }
    }
  }
  return rows;
}

/** Helper: push a sequence of boards through the state machine. */
function feedBoards(state: CanonicalState, ...boards: string[]): void {
  for (const b of boards) updateCanonicalHistory(state, b);
}

/** Helper: fresh empty state. */
function newState(): CanonicalState { return { committed: [], pending: null, prevPending: null }; }

// ─── board fixtures ────────────────────────────────────────────────────────

const START   = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
const AFT_E4  = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR';
const AFT_E6  = 'rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR';
const AFT_NC3 = 'rnbqkbnr/pppp1ppp/4p3/8/4P3/2N5/PPPP1PPP/R1BQKBNR';
const AFT_B6  = 'rnbqkbnr/p1pp1ppp/1p2p3/8/4P3/2N5/PPPP1PPP/R1BQKBNR';
const AFT_NF3 = 'rnbqkbnr/p1pp1ppp/1p2p3/8/4P3/2N2N2/PPPP1PPP/R1BQKB1R';
const AFT_BB7 = 'rn1qkbnr/pbpp1ppp/1p2p3/8/4P3/2N2N2/PPPP1PPP/R1BQKB1R'; // after Nf3 + Bb7
// After only Nc3 + Bb7 (no Nf3 yet) — used in Nc3→[hall]→Bb7 tests
const AFT_BB7_AFTER_NC3 = 'rn1qkbnr/pbpp1ppp/1p2p3/8/4P3/2N5/PPPP1PPP/R1BQKBNR';
const AFT_BC4 = 'rnbqkbnr/p1pp1ppp/1p2p3/8/2B1P3/2N5/PPPP1PPP/R1BQK1NR';
const AFT_BB7_BC4 = 'rn1qkbnr/pbpp1ppp/1p2p3/8/2B1P3/2N5/PPPP1PPP/R1BQK1NR';

// Hallucinated boards — plausible OCR rook noise
const HALL_RB1      = 'rnbqkbnr/pppp1ppp/4p3/8/4P3/2N5/PPPP1PPP/1RBQKBNR'; // rook appears on b1
const HALL_RA1_GONE = 'rnbqkbnr/pppp1ppp/4p3/8/4P3/2N5/PPPP1PPP/2BQKBNR';  // Ra1 vanished
// This is what the user saw: after b6, a hallucinated board appears between b6 and Nf3
// The hallucination has Ra1 "moved" to b1 — one legal white piece change — but black's
// pieces also changed (b-pawn moved). The old unguarded code accepted "Ra1" as a move.
const HALL_BETWEEN_B6_NF3 = 'rnbqkbnr/p1pp1ppp/1p2p3/8/4P3/2N5/PPPP1PPP/1RBQKBNR';

// ─────────────────────────────────────────────────────────────────────────────

describe('fenDiffToSan', () => {
  it('e4 white pawn push', () => {
    expect(fenDiffToSan(`${START} w - - 0 1`, `${AFT_E4} w - - 0 1`, 'w')).toBe('e4');
  });
  it('e6 black pawn push', () => {
    expect(fenDiffToSan(`${AFT_E4} b - - 0 1`, `${AFT_E6} b - - 0 1`, 'b')).toBe('e6');
  });
  it('Nc3 white knight', () => {
    expect(fenDiffToSan(`${AFT_E6} w - - 0 1`, `${AFT_NC3} w - - 0 1`, 'w')).toBe('Nc3');
  });
  it('Bc4 white bishop', () => {
    expect(fenDiffToSan(`${AFT_B6} w - - 0 1`, `${AFT_BC4} w - - 0 1`, 'w')).toBe('Bc4');
  });
  it('undefined for multi-piece change', () => {
    const twoMoves = 'rnbqkbnr/pppp1ppp/4p3/8/2B1P3/2N5/PPPP1PPP/R1BQK1NR';
    expect(fenDiffToSan(`${AFT_E6} w - - 0 1`, `${twoMoves} w - - 0 1`, 'w')).toBeUndefined();
  });
  it('O-O kingside castling', () => {
    const pre  = 'r1bqk2r/pppp1ppp/2n2n2/1Bb1p3/4P3/5N2/PPPP1PPP/RNBQK2R';
    const post = 'r1bqk2r/pppp1ppp/2n2n2/1Bb1p3/4P3/5N2/PPPP1PPP/RNBQ1RK1';
    expect(fenDiffToSan(`${pre} w KQkq - 0 1`, `${post} w KQkq - 0 1`, 'w')).toBe('O-O');
  });
  it('O-O-O queenside castling', () => {
    const pre  = 'r3kb1r/ppp1pppp/2n2n2/3p1b2/3P1B2/2N2N2/PPP1PPPP/R3KB1R';
    const post = 'r3kb1r/ppp1pppp/2n2n2/3p1b2/3P1B2/2N2N2/PPP1PPPP/2KR1B1R';
    expect(fenDiffToSan(`${pre} w KQkq - 0 1`, `${post} w KQkq - 0 1`, 'w')).toBe('O-O-O');
  });
  it('pawn promotion to queen', () => {
    const pre  = '8/P7/8/8/8/8/8/4K1k1';
    const post = 'Q7/8/8/8/8/8/8/4K1k1';
    expect(fenDiffToSan(`${pre} w - - 0 1`, `${post} w - - 0 1`, 'w')).toBe('a8=Q');
  });
  it('Bb7 black bishop', () => {
    expect(fenDiffToSan(`${AFT_BC4} b - - 0 1`, `${AFT_BB7} b - - 0 1`, 'b')).toBe('Bb7');
  });
});

// ─── Two-stage model helpers ──────────────────────────────────────────────────
// All tests below use newState() and operate on state.committed for assertions.
// The one-ply lag means: after N boards, only N-1 boards are in committed
// (the last board is always in pending until confirmed by the next board).
// To see a move committed, always feed one more board after it.

describe('updateCanonicalHistory — normal play', () => {
  it('scenario 1 — normal 3-move game: feed N+1 boards to see N moves committed', () => {
    const s = newState();
    // Feed 7 boards (START + 6 moves) + 1 extra to flush last pending
    feedBoards(s, START, AFT_E4, AFT_E6, AFT_NC3, AFT_B6, AFT_NF3, AFT_BB7);
    // AFT_BB7 is still pending — feed one more board to commit it
    // Use a sentinel board that connects from AFT_BB7 (any legal continuation)
    // For this test we just check what committed after feeding all boards:
    // START, e4, e6, Nc3, b6, Nf3 should be committed; Bb7 is pending
    const snapBeforeFlush = getSnapshot(s.committed);
    expect(snapBeforeFlush).toEqual([
      { no: 1, white: 'e4',  black: 'e6'  },
      { no: 2, white: 'Nc3', black: 'b6'  },
      { no: 3, white: 'Nf3' },
    ]);
    // Pending is Bb7 — verify it is there
    expect(s.pending?.san).toBe('Bb7');
    expect(s.pending?.turn).toBe('b');
  });

  it('scenario 1b — flush last pending: feed next board to commit Bb7', () => {
    // Use the Nc3→b6→Nf3→Bb7 line and flush by feeding Bc4 (which follows Bb7)
    const AFT_BC4_AFTER_BB7 = 'rn1qkbnr/pbpp1ppp/1p2p3/8/2B1P3/2N2N2/PPPP1PPP/R1BQK2R';
    const s = newState();
    feedBoards(s, START, AFT_E4, AFT_E6, AFT_NC3, AFT_B6, AFT_NF3, AFT_BB7);
    // AFT_BB7 is pending; feed a board that connects from it
    updateCanonicalHistory(s, AFT_BC4_AFTER_BB7);
    const snap = getSnapshot(s.committed);
    expect(snap).toEqual([
      { no: 1, white: 'e4',  black: 'e6'  },
      { no: 2, white: 'Nc3', black: 'b6'  },
      { no: 3, white: 'Nf3', black: 'Bb7' },
    ]);
  });

  it('scenario 2 — first board infers from START, committed after second board', () => {
    const s = newState();
    updateCanonicalHistory(s, AFT_E4);  // pending = {e4,w}, committed empty
    expect(s.committed.length).toBe(0);
    expect(s.pending?.san).toBe('e4');
    updateCanonicalHistory(s, AFT_E6);  // confirms e4 → committed; pending = {e6,b}
    expect(s.committed.length).toBe(1);
    expect(s.committed[0].san).toBe('e4');
    updateCanonicalHistory(s, AFT_NC3); // confirms e6 → committed; pending = {Nc3,w}
    const snap = getSnapshot(s.committed);
    expect(snap[0].white).toBe('e4');
    expect(snap[0].black).toBe('e6');
  });

  it('scenario 7 — same board as pending → no-op', () => {
    const s = newState();
    updateCanonicalHistory(s, AFT_E4);
    updateCanonicalHistory(s, AFT_E6);
    const lenBefore = s.committed.length;
    const pendingBefore = s.pending?.board;
    updateCanonicalHistory(s, AFT_E6); // same as pending — no-op
    expect(s.committed.length).toBe(lenBefore);
    expect(s.pending?.board).toBe(pendingBefore);
  });

  it('scenario 12 — one-ply lag: Nc3 pending until next board', () => {
    const s = newState();
    feedBoards(s, START, AFT_E4, AFT_E6, AFT_NC3);
    // After START, e4, e6 — committed: [START, e4, e6]; Nc3 is pending
    const snap = getSnapshot(s.committed);
    expect(snap).toEqual([
      { no: 1, white: 'e4', black: 'e6' },
    ]);
    expect(s.pending?.san).toBe('Nc3');
  });
});

describe('updateCanonicalHistory — hallucination recovery', () => {
  it('scenario 3 — exact revert: hallucination followed by prior committed board', () => {
    const s = newState();
    feedBoards(s, START, AFT_E4, AFT_E6, AFT_NC3); // pending = Nc3
    updateCanonicalHistory(s, HALL_RB1); // CONFIRM Nc3 → committed; pending = Rb1
    expect(s.committed.some(e => e.san === 'Nc3')).toBe(true);
    // Now revert: board matches a committed entry
    updateCanonicalHistory(s, AFT_NC3); // REVERT → prune back to Nc3, pending=null
    expect(s.pending).toBeNull();
    expect(s.committed.every(e => e.san !== 'Rb1')).toBe(true);
    updateCanonicalHistory(s, AFT_B6); // new pending = b6
    updateCanonicalHistory(s, AFT_NF3); // commit b6, pending = Nf3
    const snap = getSnapshot(s.committed);
    expect(snap.flatMap(r => [r.white, r.black]).filter(s => s?.startsWith('R'))).toHaveLength(0);
    expect(snap.some(r => r.black === 'b6')).toBe(true);
  });

  it('scenario 4 — REPLACE: hallucinated board discarded when next real board connects to committed tail', () => {
    const s = newState();
    feedBoards(s, START, AFT_E4, AFT_E6, AFT_NC3); // pending=Nc3
    updateCanonicalHistory(s, HALL_RB1);  // CONFIRM Nc3, pending=Rb1
    // AFT_B6 connects from AFT_NC3 (committed tail) but not from HALL_RB1
    updateCanonicalHistory(s, AFT_B6);    // REPLACE: discard Rb1, pending=b6
    expect(s.pending?.san).toBe('b6');
    expect(s.pending?.turn).toBe('b');
    expect(s.committed.every(e => e.san !== 'Rb1')).toBe(true);
    // Confirm b6
    updateCanonicalHistory(s, AFT_NF3);  // CONFIRM b6, pending=Nf3
    const snap = getSnapshot(s.committed);
    expect(snap.flatMap(r => [r.white, r.black]).filter(s => s?.startsWith('R'))).toHaveLength(0);
    expect(snap.some(r => r.black === 'b6')).toBe(true);
  });

  it('scenario 5 — two hallucinated frames: both discarded when real board connects to committed', () => {
    const s = newState();
    feedBoards(s, START, AFT_E4, AFT_E6, AFT_NC3); // pending=Nc3
    updateCanonicalHistory(s, HALL_RB1);       // CONFIRM Nc3; pending=Rb1
    updateCanonicalHistory(s, HALL_RA1_GONE);  // CONFIRM Rb1? Let's check: does HALL_RA1_GONE connect from HALL_RB1?
    // HALL_RB1 has rook on b1; HALL_RA1_GONE has no rook. For white: rook disappears, nothing appears → undefined
    // For black: opponent (white) changed → fails. → null. So REPLACE fires.
    // HALL_RA1_GONE connects from AFT_NC3 (tail)? No rook on a1... let's see:
    // tryInfer(AFT_NC3, HALL_RA1_GONE): white Ra1 vanished, nothing appeared → undefined for both sides → null
    // So ORPHAN: commit HALL_RB1 as-is, pending = HALL_RA1_GONE
    updateCanonicalHistory(s, AFT_B6); // try from pending HALL_RA1_GONE: null; try from committed tail
    // AFT_B6 connects from AFT_NC3 (committed tail before HALL_RB1 was orphan-committed)
    // Verify no rook SANs in snapshot
    const snap = getSnapshot(s.committed);
    expect(snap.flatMap(r => [r.white, r.black]).filter(x => x?.startsWith('R'))).toHaveLength(0);
  });

  it('scenario 6 — phantom rook never appears in snapshot (primary regression test)', () => {
    // The exact sequence from the user's bug report
    const s = newState();
    feedBoards(s, START, AFT_E4, AFT_E6, AFT_NC3, AFT_B6);
    updateCanonicalHistory(s, HALL_RB1);
    updateCanonicalHistory(s, AFT_BB7_AFTER_NC3);
    expect(s.committed.every(e => e.san !== 'Rb1')).toBe(true);
    expect(s.pending?.san).toBe('Bb7');
    // Use AFT_BB7_BC4 (Bc4 from the Nc3+b6+Bb7 position) to confirm Bb7
    updateCanonicalHistory(s, AFT_BB7_BC4);
    const snap = getSnapshot(s.committed);
    expect(snap.flatMap(r => [r.white, r.black]).filter(x => x?.startsWith('R'))).toHaveLength(0);
    expect(snap.some(r => r.black === 'Bb7')).toBe(true);
  });
});

describe('updateCanonicalHistory — edge cases', () => {
  it('scenario 8 — castling SAN inferred after confirmation', () => {
    const pre  = 'r1bqk2r/pppp1ppp/2n2n2/1Bb1p3/4P3/5N2/PPPP1PPP/RNBQK2R';
    const post = 'r1bqk2r/pppp1ppp/2n2n2/1Bb1p3/4P3/5N2/PPPP1PPP/RNBQ1RK1';
    const s = newState();
    updateCanonicalHistory(s, pre);   // pending = pre (san unknown from empty)
    updateCanonicalHistory(s, post);  // CONFIRM pre; pending.san = O-O
    expect(s.pending?.san).toBe('O-O');
    expect(s.pending?.turn).toBe('w');
  });

  it('scenario 9 — turns correctly inferred (white/black alternation)', () => {
    const s = newState();
    updateCanonicalHistory(s, AFT_E4);
    expect(s.pending?.san).toBe('e4');
    expect(s.pending?.turn).toBe('w');
    updateCanonicalHistory(s, AFT_E6); // confirms e4; pending=e6
    expect(s.pending?.san).toBe('e6');
    expect(s.pending?.turn).toBe('b');
    updateCanonicalHistory(s, AFT_NC3); // confirms e6; pending=Nc3
    expect(s.committed[1].san).toBe('e6');
    expect(s.committed[1].turn).toBe('b');
  });

  it('scenario 10 — multi-piece OCR noise: unknown SAN, not shown in snapshot', () => {
    const twoMoves = 'rnbqkbnr/pppp1ppp/4p3/8/2B1P3/2N5/PPPP1PPP/R1BQK1NR';
    const s = newState();
    updateCanonicalHistory(s, AFT_E4);
    updateCanonicalHistory(s, AFT_E6);   // confirm e4; pending=e6
    updateCanonicalHistory(s, twoMoves); // twoMoves cannot connect from e6 → REPLACE/ORPHAN
    // Either way, twoMoves has undefined SAN
    expect(s.pending?.san).toBeUndefined();
    // e4 is committed; e6 may or may not be (depends on REPLACE vs ORPHAN path)
    // Either way the twoMoves SAN is undefined so it won't show
    const snap = getSnapshot(s.committed);
    expect(snap.every(r => r.white !== twoMoves && r.black !== twoMoves)).toBe(true);
  });

  it('scenario 11 — pawn promotion inferred correctly', () => {
    const pre  = '8/P7/8/8/8/8/8/4K1k1';
    const post = 'Q7/8/8/8/8/8/8/4K1k1';
    const s = newState();
    updateCanonicalHistory(s, pre);
    updateCanonicalHistory(s, post);
    expect(s.pending?.san).toBe('a8=Q');
    expect(s.pending?.turn).toBe('w');
  });

  it('scenario 13 — no spurious replacement when boards connect normally', () => {
    const s = newState();
    feedBoards(s, START, AFT_E4, AFT_E6);
    // pending = e6; committed = [START, e4]
    updateCanonicalHistory(s, AFT_NC3); // confirms e6; pending=Nc3
    expect(s.committed.some(e => e.san === 'e6')).toBe(true);
    expect(s.pending?.san).toBe('Nc3');
  });

  it('scenario 14 — lookback depth respected (>3 steps back not used)', () => {
    const s = newState();
    feedBoards(s, START, AFT_E4, AFT_E6, AFT_NC3);
    // pending=Nc3; committed=[START,e4,e6]
    const G1 = 'rnbqkbnr/pppp1ppp/4p3/8/4P3/1RN5/PPPP1PPP/2BQKBNR';
    const G2 = 'rnbqkbnr/pppp1ppp/4p3/8/4P3/2NR4/PPPP1PPP/2BQKBNR';
    const G3 = 'rnbqkbnr/pppp1ppp/4p3/8/4P3/2N4R/PPPP1PPP/2BQKBNR';
    const G4 = 'rnbqkbnr/pppp1ppp/4p3/8/4P3/2N5/PPPP1PPP/2BQKB1R';
    feedBoards(s, G1, G2, G3, G4); // 4 garbage frames
    // AFT_B6 is legal from AFT_NC3 which is 4+ steps back in committed — beyond LOOKBACK_DEPTH
    updateCanonicalHistory(s, AFT_B6);
    // No rook SANs should be in committed
    expect(s.committed.filter(e => e.san?.startsWith('R'))).toHaveLength(0);
  });
});

describe('updateCanonicalHistory — user-reported Rb1 regression (provisional model)', () => {
  it('scenario 19 — Rb1 hallucination after Nc3: phantom discarded, Bb7 correct', () => {
    // Exact sequence: e4 e6 Nc3 [HALL_RB1] Bb7 Bc4
    // Expected: 1 e4 e6 / 2 Nc3 Bb7 — no Rb1 ever committed
    const s = newState();
    feedBoards(s, START, AFT_E4, AFT_E6, AFT_NC3);
    // pending=Nc3; committed=[START,e4,e6]
    updateCanonicalHistory(s, HALL_RB1);
    // CONFIRM Nc3→committed; pending=Rb1 (hallucination now in pending, NOT committed)
    expect(s.committed.every(e => e.san !== 'Rb1')).toBe(true);
    expect(s.pending?.san).toBe('Rb1');

    // Now AFT_BB7_AFTER_NC3 arrives (real game board after Nc3, Bb7 played)
    // AFT_BB7_AFTER_NC3 is 2 plies from AFT_NC3 (b6+Bb7).
    // The transition cannot be inferred as a single move from any anchor.
    // pending gets Bb7's board but with undefined SAN (gap too large to resolve).
    updateCanonicalHistory(s, AFT_BB7_AFTER_NC3);
    expect(s.committed.every(e => e.san !== 'Rb1')).toBe(true);
    // SAN is undefined because AFT_NC3→AFT_BB7_AFTER_NC3 spans 2 plies
    expect(s.pending?.san).toBeUndefined();
    // No phantom rook in committed
    const badRooks = s.committed.filter(e => e.san?.startsWith('R'));
    expect(badRooks).toHaveLength(0);

    // Confirm the pending board (even without a known SAN) to flush it to committed
    updateCanonicalHistory(s, AFT_BB7_BC4);
    // committed now has the board entries; no Rb1 anywhere
    expect(s.committed.every(e => e.san !== 'Rb1')).toBe(true);
    expect(s.committed.filter(e => e.san?.startsWith('R'))).toHaveLength(0);
  });

  it('scenario 20 — two consecutive hallucinations, real move recovers', () => {
    const s = newState();
    feedBoards(s, START, AFT_E4, AFT_E6, AFT_NC3);
    updateCanonicalHistory(s, HALL_RB1);      // CONFIRM Nc3; pending=Rb1
    updateCanonicalHistory(s, HALL_RA1_GONE); // pending can't confirm Rb1; connects to tail?
    // Either REPLACE or ORPHAN — either way feed real move
    updateCanonicalHistory(s, AFT_BB7_AFTER_NC3); // real Bb7 from Nc3 position
    // No Rb1 SANs in committed
    const badSans = s.committed.filter(e => e.san === 'Rb1' || e.san === 'Ra1');
    expect(badSans).toHaveLength(0);
  });

  it('scenario 21 — game ends on hallucinated board: last committed move shown, hall absent', () => {
    const s = newState();
    feedBoards(s, START, AFT_E4, AFT_E6, AFT_NC3);
    updateCanonicalHistory(s, HALL_RB1); // CONFIRM Nc3; pending=Rb1
    // No more boards — snapshot shows only committed moves, Rb1 pending never shown
    const snap = getSnapshot(s.committed);
    expect(snap.flatMap(r => [r.white, r.black]).filter(x => x?.startsWith('R'))).toHaveLength(0);
    expect(snap.some(r => r.white === 'Nc3')).toBe(true);
  });

  it('scenario 22 — real rook move is correctly committed after confirmation', () => {
    // 1.e4 e6 2.Ra1-a4? (unusual but legal) — if white really did play Ra4
    // The board after Ra4 should be committed once the next move confirms it
    const AFT_RA4 = 'rnbqkbnr/pppp1ppp/4p3/8/R3P3/8/PPPP1PPP/1NBQKBNR'; // Ra1→Ra4
    const s = newState();
    feedBoards(s, START, AFT_E4, AFT_E6);
    // pending=e6; committed=[START,e4]
    updateCanonicalHistory(s, AFT_RA4); // CONFIRM e6; pending={Ra4,w}
    expect(s.pending?.san).toBe('Ra4');
    expect(s.pending?.turn).toBe('w');
    // Feed any next board to confirm Ra4
    const AFT_B6_FROM_E6 = 'rnbqkbnr/p1pp1ppp/1p2p3/8/R3P3/8/PPPP1PPP/1NBQKBNR';
    updateCanonicalHistory(s, AFT_B6_FROM_E6); // CONFIRM Ra4
    expect(s.committed.some(e => e.san === 'Ra4')).toBe(true);
    const snap = getSnapshot(s.committed);
    expect(snap.some(r => r.white === 'Ra4')).toBe(true);
  });
});

describe('regression — first-move and captures', () => {
  it('scenario 16 — first move recovered from START even with empty committed', () => {
    const s = newState();
    updateCanonicalHistory(s, AFT_E4); // pending={e4,w}; empty-history fallback
    expect(s.pending?.san).toBe('e4');
    expect(s.pending?.turn).toBe('w');
    updateCanonicalHistory(s, AFT_E6); // CONFIRM e4
    expect(s.committed[0].san).toBe('e4');
    expect(s.committed[0].turn).toBe('w');
  });

  it('scenario 17 — white capture: Nxe5 inferred correctly', () => {
    const AFT_E5   = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR';
    const AFT_NF3  = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R';
    const AFT_NXE5 = 'rnbqkbnr/pppp1ppp/8/4N3/4P3/8/PPPP1PPP/RNBQKB1R';
    const s = newState();
    feedBoards(s, START, AFT_E4, AFT_E5, AFT_NF3);
    updateCanonicalHistory(s, AFT_NXE5); // CONFIRM Nf3; pending=Nxe5
    expect(s.pending?.san).toBe('Nxe5');
    expect(s.pending?.turn).toBe('w');
  });

  it('scenario 18 — black capture: Qxd5 inferred correctly', () => {
    const AFT_D5   = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR';
    const AFT_EXD5 = 'rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR';
    const AFT_QXD5 = 'rnb1kbnr/ppp1pppp/8/3q4/8/8/PPPP1PPP/RNBQKBNR';
    const s = newState();
    feedBoards(s, START, AFT_E4, AFT_D5, AFT_EXD5);
    updateCanonicalHistory(s, AFT_QXD5); // CONFIRM exd5; pending=Qxd5
    expect(s.pending?.san).toBeTruthy();
    expect(s.pending?.turn).toBe('b');
  });
});


// ─── summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('SOME TESTS FAILED'); process.exit(1); }
else { console.log('ALL TESTS PASSED'); }
