import { describe, expect, it } from 'vitest';
import { fenDiffToSan } from '../../../../src/main/lib/chess/chess-notation';
import {
  getCanonicalMoveHistorySnapshot,
  type CanonicalHistoryEntry,
  type CanonicalHistoryState,
  tryInferSanForHistory,
  updateCanonicalHistoryState,
} from '../../../../src/main/lib/chess/canonical-history';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
const AFT_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR';
const AFT_E6 = 'rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR';
const AFT_NC3 = 'rnbqkbnr/pppp1ppp/4p3/8/4P3/2N5/PPPP1PPP/R1BQKBNR';
const AFT_B6 = 'rnbqkbnr/p1pp1ppp/1p2p3/8/4P3/2N5/PPPP1PPP/R1BQKBNR';
const NF3 = 'rnbqkbnr/p1pp1ppp/1p2p3/8/4P3/2N2N2/PPPP1PPP/R1BQKB1R';
const BB7 = 'rn1qkbnr/pbpp1ppp/1p2p3/8/4P3/2N2N2/PPPP1PPP/R1BQKB1R';
const BC4 = 'rn1qkbnr/pbpp1ppp/1p2p3/8/2B1P3/2N2N2/PPPP1PPP/R1BQK2R';

const HALL_NF3_RB1 = 'rnbqkbnr/p1pp1ppp/1p2p3/8/4P3/2N2N2/PPPP1PPP/1RBQKB2';
const HALL_BB7_RB1 = 'rn1qkbnr/pbpp1ppp/1p2p3/8/4P3/2N2N2/PPPP1PPP/1RBQKB2';

function newState(): CanonicalHistoryState {
  return {
    canonicalMoveHistory: [],
    pendingCanonicalEntry: null,
    prevPendingCanonicalEntry: null,
  };
}

function feed(state: CanonicalHistoryState, ...boards: string[]): void {
  for (const board of boards) updateCanonicalHistoryState(state, board);
}

function sans(history: CanonicalHistoryEntry[]): string[] {
  return history.map(entry => entry.san).filter((san): san is string => !!san);
}

describe('fenDiffToSan', () => {
  it('handles common SAN moves', () => {
    expect(fenDiffToSan(`${START} w - - 0 1`, `${AFT_E4} w - - 0 1`, 'w')).toBe('e4');
    expect(fenDiffToSan(`${AFT_E4} b - - 0 1`, `${AFT_E6} b - - 0 1`, 'b')).toBe('e6');
    expect(fenDiffToSan(`${AFT_E6} w - - 0 1`, `${AFT_NC3} w - - 0 1`, 'w')).toBe('Nc3');
  });

  it('returns null for multi-ply board jumps', () => {
    const twoMoves = 'rnbqkbnr/pppp1ppp/4p3/8/2B1P3/2N5/PPPP1PPP/R1BQK1NR';
    expect(fenDiffToSan(`${AFT_E6} w - - 0 1`, `${twoMoves} w - - 0 1`, 'w')).toBeUndefined();
  });
});

describe('tryInferSanForHistory', () => {
  it('infers a unique moving side', () => {
    expect(tryInferSanForHistory(START, AFT_E4)).toEqual({ san: 'e4', turn: 'w' });
    expect(tryInferSanForHistory(AFT_E4, AFT_E6)).toEqual({ san: 'e6', turn: 'b' });
  });

  it('rejects unchanged or ambiguous board changes', () => {
    const twoMoves = 'rnbqkbnr/pppp1ppp/4p3/8/2B1P3/2N5/PPPP1PPP/R1BQK1NR';
    expect(tryInferSanForHistory(AFT_E4, AFT_E4)).toBeNull();
    expect(tryInferSanForHistory(AFT_E6, twoMoves)).toBeNull();
  });
});

describe('updateCanonicalHistoryState', () => {
  it('commits a board only after the following board confirms it', () => {
    const state = newState();

    feed(state, START, AFT_E4);
    expect(state.canonicalMoveHistory.map(entry => entry.board)).toEqual([START]);
    expect(state.pendingCanonicalEntry?.board).toBe(AFT_E4);

    const result = updateCanonicalHistoryState(state, AFT_E6);
    expect(result.resolvedSan).toBe('e4');
    expect(result.resolvedTurn).toBe('w');
    expect(state.canonicalMoveHistory.map(entry => entry.board)).toEqual([START, AFT_E4]);
    expect(state.pendingCanonicalEntry?.board).toBe(AFT_E6);
  });

  it('builds the renderer snapshot from committed moves only', () => {
    const state = newState();
    feed(state, START, AFT_E4, AFT_E6, AFT_NC3, AFT_B6);

    expect(getCanonicalMoveHistorySnapshot(state.canonicalMoveHistory)).toEqual([
      { no: 1, white: 'e4', black: 'e6' },
      { no: 2, white: 'Nc3' },
    ]);
    expect(state.pendingCanonicalEntry?.san).toBe('b6');
  });

  it('does not duplicate repeated pending boards', () => {
    const state = newState();
    feed(state, START, AFT_E4, AFT_E4, AFT_E6);

    expect(sans(state.canonicalMoveHistory)).toEqual(['e4']);
    expect(state.pendingCanonicalEntry?.san).toBe('e6');
  });

  it('keeps transient rook hallucinations out of committed history', () => {
    const state = newState();
    feed(
      state,
      START,
      AFT_E4,
      AFT_E6,
      AFT_NC3,
      AFT_B6,
      NF3,
      HALL_NF3_RB1,
      HALL_BB7_RB1,
      BB7,
      BC4,
    );

    const committedSans = sans(state.canonicalMoveHistory);
    expect(committedSans.filter(san => san.startsWith('R'))).toEqual([]);
  });

  it('returns no resolved move when replacing a hallucinated pending board', () => {
    const state = newState();
    feed(state, START, AFT_E4, AFT_E6, AFT_NC3, HALL_NF3_RB1);

    const result = updateCanonicalHistoryState(state, AFT_B6);
    expect(result.resolvedSan).toBeUndefined();
    expect(sans(state.canonicalMoveHistory)).toEqual(['e4', 'e6', 'Nc3']);
    expect(state.pendingCanonicalEntry?.san).toBe('b6');
  });
});
