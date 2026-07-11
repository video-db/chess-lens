import { describe, expect, it } from 'vitest';
import {
  countPiecesInFenBoard,
  getEffectiveMaxSquareDelta,
  hasBothKingsInFenBoard,
  isPerspectiveFlipFenBoard,
} from '../../../../../src/main/services/chess/chess-screenshot/chess-screenshot-guards';

describe('chess screenshot guards', () => {
  it('counts pieces in FEN board fields', () => {
    expect(countPiecesInFenBoard('8/8/8/8/8/8/8/8')).toBe(0);
    expect(countPiecesInFenBoard('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR')).toBe(32);
  });

  it('tightens max square delta in sparse endgames', () => {
    expect(getEffectiveMaxSquareDelta('8/8/8/8/8/8/8/K6k')).toBe(3);
    expect(getEffectiveMaxSquareDelta('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR')).toBe(6);
  });

  it('requires both kings for stable large jumps', () => {
    expect(hasBothKingsInFenBoard('8/8/p3pk2/1p1p1p2/2pP4/2P1K3/PP3P2/3R4')).toBe(true);
    expect(hasBothKingsInFenBoard('8/8/8/8/8/8/8/8')).toBe(false);
    expect(hasBothKingsInFenBoard('8/8/8/8/8/8/8/K7')).toBe(false);
  });

  it('detects black-perspective hallucinated board orientation', () => {
    expect(isPerspectiveFlipFenBoard('RNBKQBNR/PPPPPPPP/8/8/8/8/pppppppp/rnbkqbnr')).toBe(true);
    expect(isPerspectiveFlipFenBoard('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR')).toBe(false);
    expect(isPerspectiveFlipFenBoard('8/8/8')).toBe(false);
  });
});
