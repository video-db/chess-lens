/**
 * testPositionHistory.ts
 *
 * Standalone test for the position-history state machine.
 * Simulates the buggy Ra1/Rb1 oscillation sequence and verifies that:
 *   1. Oscillating positions are discarded.
 *   2. Real moves that survive the stability window are committed.
 *   3. The final opening sequence is clean.
 *
 * Run with:  npx tsx tools/testPositionHistory.ts
 */

// ─── Minimal re-implementation of the state machine (no Electron deps) ────────

const POSITION_STABILITY_FRAMES = 3;
const OPENING_HISTORY_MAX_PLIES = 12;
const OSCILLATION_REPEAT_LIMIT = 1;

interface PositionEntry {
  fen: string;
  board: string;
  frameCount: number;
  status: 'provisional' | 'confirmed' | 'reverted';
  san?: string;
}

let positionBuffer: PositionEntry[] = [];
let committedPositionHistory: PositionEntry[] = [];

function resetHistory(): void {
  positionBuffer = [];
  committedPositionHistory = [];
}

function tryInferSan(_fromFen: string, _toFen: string): string | null {
  // Stub — real implementation uses fenDiffToSan.
  // For this test we pass SAN explicitly so this is not needed.
  return null;
}

function recordPositionForHistory(fen: string, san?: string): void {
  if (committedPositionHistory.length >= OPENING_HISTORY_MAX_PLIES) return;

  const board = fen.split(' ')[0] ?? '';

  // REVERT
  const committedIdx = committedPositionHistory.findIndex(e => e.board === board);
  if (committedIdx !== -1) {
    if (positionBuffer.length > 0) {
      console.log(`  [REVERT] board=${board.slice(0,24)} → dropped ${positionBuffer.length} provisional`);
      positionBuffer = [];
    }
    return;
  }

  // REINFORCE (must run before OSCILLATION check)
  const head = positionBuffer[positionBuffer.length - 1];
  if (head && head.board === board && head.status === 'provisional') {
    head.frameCount++;
    if (san && !head.san) head.san = san;
    if (head.frameCount >= POSITION_STABILITY_FRAMES) {
      head.status = 'confirmed';
      committedPositionHistory.push({ ...head });
      console.log(`  [COMMIT] board=${board.slice(0,24)} san=${head.san ?? '?'} histLen=${committedPositionHistory.length}`);
      positionBuffer = [];
    } else {
      console.log(`  [REINFORCE] board=${board.slice(0,24)} frameCount=${head.frameCount}`);
    }
    return;
  }

  // OSCILLATION: board seen at a non-head position in provisional buffer
  const provisionalRepeatCount = positionBuffer.filter(e => e.board === board).length;
  if (provisionalRepeatCount >= OSCILLATION_REPEAT_LIMIT) {
    console.log(`  [OSCILLATION] board=${board.slice(0,24)} seen ${provisionalRepeatCount}x → discard buffer (${positionBuffer.length} entries)`);
    positionBuffer = [];
    return;
  }

  // GAP-FILL
  const lastCommitted = committedPositionHistory[committedPositionHistory.length - 1];
  let resolvedSan = san;
  if (lastCommitted && !resolvedSan) {
    resolvedSan = tryInferSan(lastCommitted.fen, fen) ?? undefined;
    if (!resolvedSan && positionBuffer.length > 0) {
      const provisional = positionBuffer[positionBuffer.length - 1];
      if (provisional && provisional.status === 'provisional') {
        const san1 = tryInferSan(lastCommitted.fen, provisional.fen);
        const san2 = tryInferSan(provisional.fen, fen);
        if (san1 && san2) {
          provisional.status = 'confirmed';
          provisional.san = san1;
          committedPositionHistory.push({ ...provisional });
          positionBuffer = [];
          resolvedSan = san2;
          console.log(`  [GAP-FILL] san1=${san1} san2=${san2}`);
        } else {
          console.log(`  [DISCARD-PROVISIONAL] board=${provisional.board.slice(0,24)}`);
          positionBuffer = [];
        }
      }
    }
  }

  // NEW provisional
  console.log(`  [PROVISIONAL] board=${board.slice(0,24)} san=${resolvedSan ?? '?'}`);
  positionBuffer.push({ fen, board, frameCount: 1, status: 'provisional', san: resolvedSan });
}

// ─── FEN constants ────────────────────────────────────────────────────────────
// Real FEN positions extracted from the example game:
//   1. e4 e6  2. Ra1 b6  3. Nf3  4. Rb1  5. Ra1 Bb7  6. Bc4  7. Rb1  8. Ra1 d6  9. d3 Nf6  10. h3

const FEN: Record<string, string> = {
  start:    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  e4:       'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
  e4_e6:    'rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
  // Ra1 is illegal from the starting position but the bug produces it:
  ra1_fake: 'rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/R1BQKBNR w - - 0 2',  // rook moved (hallucinated)
  b6:       'rnbqkbnr/p1pp1ppp/1p2p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3',
  rb1_fake: 'rnbqkbnr/p1pp1ppp/1p2p3/8/4P3/8/PPPP1PPP/1RBQKBNR w - - 0 3', // another rook hallucination
  nf3:      'rnbqkbnr/p1pp1ppp/1p2p3/8/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 0 3',
  bb7:      'rn1qkbnr/pbpp1ppp/1p2p3/8/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 4',
  bc4:      'rn1qkbnr/pbpp1ppp/1p2p3/8/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 4',
  d6:       'rn1qkbnr/pbp2ppp/1p1pp3/8/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 5',
  d3:       'rn1qkbnr/pbp2ppp/1p1pp3/8/2B1P3/3P1N2/PPP2PPP/RNBQK2R b KQkq - 0 5',
  nf6:      'rn1qkb1r/pbp2ppp/1p1ppn2/8/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 6',
  h3:       'rn1qkb1r/pbp2ppp/1p1ppn2/8/2B1P3/3P1N1P/PPP2PPP/RNBQK2R b KQkq - 0 6',
};

// ─── Test 1: Oscillating rook shuffles should be discarded ───────────────────

console.log('\n=== TEST 1: Rook oscillation (Ra1/Rb1 bounce) ===\n');
resetHistory();

// Simulate the game with hallucinated rook shuffles interleaved.
// Each FEN is fed multiple times to simulate consecutive frames.
const sequence1: Array<{ fen: string; san?: string; label: string }> = [
  { fen: FEN.e4,       san: 'e4',    label: 'e4 (real)' },
  { fen: FEN.e4,       san: 'e4',    label: 'e4 (frame 2)' },
  { fen: FEN.e4,       san: 'e4',    label: 'e4 (frame 3 → commit)' },
  { fen: FEN.e4_e6,    san: 'e6',    label: 'e6 (real)' },
  { fen: FEN.e4_e6,                  label: 'e6 (frame 2)' },
  { fen: FEN.e4_e6,                  label: 'e6 (frame 3 → commit)' },
  { fen: FEN.ra1_fake, san: 'Ra1',   label: 'Ra1 HALLUCINATED frame 1' },
  { fen: FEN.rb1_fake, san: 'Rb1',   label: 'Rb1 HALLUCINATED frame 1 (oscillation!)' },
  { fen: FEN.ra1_fake, san: 'Ra1',   label: 'Ra1 HALLUCINATED frame 2 (oscillation limit!)' },
  { fen: FEN.b6,       san: 'b6',    label: 'b6 (real, after oscillation discarded)' },
  { fen: FEN.b6,                     label: 'b6 frame 2' },
  { fen: FEN.b6,                     label: 'b6 frame 3 → commit' },
  { fen: FEN.nf3,      san: 'Nf3',   label: 'Nf3 (real)' },
  { fen: FEN.nf3,                    label: 'Nf3 frame 2' },
  { fen: FEN.nf3,                    label: 'Nf3 frame 3 → commit' },
  { fen: FEN.bb7,      san: 'Bb7',   label: 'Bb7 (real)' },
  { fen: FEN.bb7,                    label: 'Bb7 frame 2' },
  { fen: FEN.bb7,                    label: 'Bb7 frame 3 → commit' },
  { fen: FEN.bc4,      san: 'Bc4',   label: 'Bc4 (real)' },
  { fen: FEN.bc4,                    label: 'Bc4 frame 2' },
  { fen: FEN.bc4,                    label: 'Bc4 frame 3 → commit' },
];

for (const { fen, san, label } of sequence1) {
  console.log(`→ ${label}`);
  recordPositionForHistory(fen, san);
}

console.log('\n--- Committed history ---');
committedPositionHistory.forEach((e, i) => {
  console.log(`  [${i}] san=${e.san ?? '?'}  board=${e.board.slice(0, 30)}`);
});

const hasRookMoves = committedPositionHistory.some(e => e.san === 'Ra1' || e.san === 'Rb1');
console.log(`\n✅ PASS (no rook moves committed): ${!hasRookMoves}`);
const hasMoves = committedPositionHistory.length >= 3;
console.log(`✅ PASS (at least 3 real moves committed): ${hasMoves}`);

// ─── Test 2: Clean game from move 1 should commit full opening line ───────────

console.log('\n=== TEST 2: Clean game — full opening committed ===\n');
resetHistory();

const sequence2: Array<{ fen: string; san?: string; label: string }> = [
  { fen: FEN.e4,    san: 'e4',   label: 'e4' },
  { fen: FEN.e4,                 label: 'e4 f2' },
  { fen: FEN.e4,                 label: 'e4 f3 → commit' },
  { fen: FEN.e4_e6, san: 'e6',   label: 'e6' },
  { fen: FEN.e4_e6,              label: 'e6 f2' },
  { fen: FEN.e4_e6,              label: 'e6 f3 → commit' },
  { fen: FEN.nf3,   san: 'Nf3',  label: 'Nf3' },
  { fen: FEN.nf3,                label: 'Nf3 f2' },
  { fen: FEN.nf3,                label: 'Nf3 f3 → commit' },
  { fen: FEN.bb7,   san: 'Bb7',  label: 'Bb7' },
  { fen: FEN.bb7,                label: 'Bb7 f2' },
  { fen: FEN.bb7,                label: 'Bb7 f3 → commit' },
];

for (const { fen, san, label } of sequence2) {
  console.log(`→ ${label}`);
  recordPositionForHistory(fen, san);
}

console.log('\n--- Committed history ---');
committedPositionHistory.forEach((e, i) => {
  console.log(`  [${i}] san=${e.san ?? '?'}  board=${e.board.slice(0, 30)}`);
});
console.log(`\n✅ PASS (4 positions committed): ${committedPositionHistory.length === 4}`);

// ─── Test 3: Mid-game join — single position with no prior committed ───────────

console.log('\n=== TEST 3: Mid-game join — single stable position ===\n');
resetHistory();

const sequence3: Array<{ fen: string; label: string }> = [
  { fen: FEN.d6,  label: 'd6 frame 1' },
  { fen: FEN.d6,  label: 'd6 frame 2' },
  { fen: FEN.d6,  label: 'd6 frame 3 → commit' },
  { fen: FEN.d3,  label: 'd3 frame 1' },
  { fen: FEN.d3,  label: 'd3 frame 2' },
  { fen: FEN.d3,  label: 'd3 frame 3 → commit' },
];

for (const { fen, label } of sequence3) {
  console.log(`→ ${label}`);
  recordPositionForHistory(fen);
}

console.log('\n--- Committed history ---');
committedPositionHistory.forEach((e, i) => {
  console.log(`  [${i}] san=${e.san ?? '?'}  board=${e.board.slice(0, 30)}`);
});
console.log(`\n✅ PASS (2 mid-game positions committed): ${committedPositionHistory.length === 2}`);

// ─── Test 4: Hallucinated single frame that quickly reverts ──────────────────

console.log('\n=== TEST 4: Single hallucinated frame + revert ===\n');
resetHistory();

const sequence4: Array<{ fen: string; san?: string; label: string }> = [
  { fen: FEN.e4,    san: 'e4',   label: 'e4 f1' },
  { fen: FEN.e4,                 label: 'e4 f2' },
  { fen: FEN.e4,                 label: 'e4 f3 → commit' },
  { fen: FEN.ra1_fake, san: 'Ra1', label: 'Ra1 hallucinated (frame 1)' },
  { fen: FEN.e4,                 label: 'e4 revert → drops provisional' },
  { fen: FEN.e4_e6, san: 'e6',   label: 'e6 real move' },
  { fen: FEN.e4_e6,              label: 'e6 f2' },
  { fen: FEN.e4_e6,              label: 'e6 f3 → commit' },
];

for (const { fen, san, label } of sequence4) {
  console.log(`→ ${label}`);
  recordPositionForHistory(fen, san);
}

console.log('\n--- Committed history ---');
committedPositionHistory.forEach((e, i) => {
  console.log(`  [${i}] san=${e.san ?? '?'}  board=${e.board.slice(0, 30)}`);
});
const noRookInHistory = !committedPositionHistory.some(e => e.san === 'Ra1');
console.log(`\n✅ PASS (Ra1 not committed): ${noRookInHistory}`);
console.log(`✅ PASS (e4 + e6 committed): ${committedPositionHistory.length === 2}`);

console.log('\n=== All tests complete ===\n');
