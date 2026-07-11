import { describe, expect, it } from 'vitest';
import {
  computeKeyMomentIndices,
  formatTipTimestamp,
  getDisplayKeyMomentTips,
  getMoveLabel,
  getMoveNumber,
} from '../../../../src/renderer/components/history/recording-analysis-utils';

describe('recording analysis utils', () => {
  it('formats timestamps and derives display move labels', () => {
    expect(formatTipTimestamp(65.9)).toBe('01:05');
    expect(getMoveNumber(3)).toBe(2);
    expect(getMoveLabel('Black should answer with ...Nf6 to develop')).toBe('Nf6');
  });

  it('computes key moment indices from classified tips', () => {
    const indices = computeKeyMomentIndices([
      {},
      { winChance: 25, winChanceBefore: 70, turn: 'w', centipawnLoss: 450 },
    ]);

    expect([...indices]).toEqual([1]);
  });

  it('falls back to largest CPL tips when no key moments are available', () => {
    const displayTips = getDisplayKeyMomentTips([
      { id: 'a', startTime: 1, tip: 'Small improvement', centipawnLoss: 5 },
      { id: 'b', startTime: 2, tip: 'Slightly better', centipawnLoss: 10 },
    ]);

    expect(displayTips.map((tip) => tip.id)).toEqual(['b', 'a']);
  });
});
