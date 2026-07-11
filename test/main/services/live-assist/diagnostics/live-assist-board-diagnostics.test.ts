import { describe, expect, it } from 'vitest';
import {
  buildSemanticRejectDiagnostics,
  countBoardPieces,
} from '../../../../../src/main/services/live-assist/diagnostics/live-assist-board-diagnostics';

describe('live assist board diagnostics', () => {
  it('counts pieces and derived plausibility groups', () => {
    const counts = countBoardPieces('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');

    expect(counts.whitePieces).toBe(16);
    expect(counts.blackPieces).toBe(16);
    expect(counts.whiteKings).toBe(1);
    expect(counts.blackKings).toBe(1);
    expect(counts.PB_white).toBe(10);
    expect(counts.PB_black).toBe(10);
    expect(counts.NR_white).toBe(4);
    expect(counts.NR_black).toBe(4);
    expect(counts.total).toBe(32);
  });

  it('summarizes semantic rejection details', () => {
    const diagnostics = buildSemanticRejectDiagnostics('PPPPPPPP/8/8/8/8/8/8/8');

    expect(diagnostics).toEqual({
      whitePieces: 8,
      blackPieces: 0,
      whiteKings: 0,
      blackKings: 0,
      pawnsOnBackRank: 8,
    });
  });
});
