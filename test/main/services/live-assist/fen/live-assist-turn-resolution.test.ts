import { describe, expect, it } from 'vitest';
import { INITIAL_CHESS_BOARD } from '../../../../../src/main/lib/chess/canonical-history';
import { resolveConfirmedFenTurn } from '../../../../../src/main/services/live-assist/fen/live-assist-turn-resolution';

const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR';

describe('live assist turn resolution', () => {
  it('prefers validated algebraic move squares as tier 2a', () => {
    const result = resolveConfirmedFenTurn({
      fenBoard: AFTER_E4,
      perspective: 'white',
      lastChessBoard: INITIAL_CHESS_BOARD,
      lastChessTurn: 'w',
      reportedTurn: 'b',
      reportedLastMoveFrom: 'e2',
      reportedLastMoveTo: 'e4',
    });

    expect(result.inferredTurn).toBe('b');
    expect(result.tierUsed).toBe('2a');
    expect(result.gridDerivedTurn).toBe('b');
    expect(result.invalidMovePair).toBe(false);
  });

  it('uses reported turn when grid-derived and reported turns disagree', () => {
    const result = resolveConfirmedFenTurn({
      fenBoard: AFTER_E4,
      perspective: 'white',
      lastChessBoard: INITIAL_CHESS_BOARD,
      lastChessTurn: 'w',
      reportedTurn: 'w',
      reportedLastMoveFrom: 'e2',
      reportedLastMoveTo: 'e4',
    });

    expect(result.inferredTurn).toBe('w');
    expect(result.tierUsed).toBe('2b');
    expect(result.effectiveGridDerivedTurn).toBeNull();
    expect(result.gridReportedDisagree).toBe(true);
  });

  it('falls back to board diff when no single-frame turn signal is available', () => {
    const result = resolveConfirmedFenTurn({
      fenBoard: AFTER_E4,
      perspective: 'white',
      lastChessBoard: INITIAL_CHESS_BOARD,
      lastChessTurn: 'w',
      reportedTurn: null,
    });

    expect(result.inferredTurn).toBe('b');
    expect(result.tierUsed).toBe('3');
  });

  it('rejects impossible reported move pairs before deriving the turn', () => {
    const result = resolveConfirmedFenTurn({
      fenBoard: INITIAL_CHESS_BOARD,
      perspective: 'black',
      lastChessBoard: null,
      lastChessTurn: null,
      reportedTurn: null,
      reportedLastMoveFrom: 'e2',
      reportedLastMoveTo: 'd2',
    });

    expect(result.invalidMovePair).toBe(true);
    expect(result.gridDerivedTurn).toBeNull();
    expect(result.inferredTurn).toBe('b');
    expect(result.tierUsed).toBe('5');
  });
});

