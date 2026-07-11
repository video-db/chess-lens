import { describe, expect, it } from 'vitest';
import {
  getInstructionSignature,
  isGenericTip,
  isSpecificChessTip,
  sanitizeInsightText,
} from '../../../../../src/main/services/live-assist/coaching/live-assist-insights';

describe('live-assist insight helpers', () => {
  it('sanitizes model formatting and preserves black move notation readably', () => {
    expect(sanitizeInsightText(' - **Say:** ...Nf6  `develop`  ')).toBe('Black\'s Nf6 develop');
  });

  it('builds stable instruction signatures', () => {
    expect(getInstructionSignature(['**Say:** Control the center'], ['Ask: Why e4?']))
      .toBe('control the center | :: | why e4?');
  });

  it('filters generic tips', () => {
    expect(isGenericTip('focus up')).toBe(true);
    expect(isGenericTip('Attack the pinned knight')).toBe(false);
  });

  it('requires concrete chess language and required move mentions', () => {
    expect(isSpecificChessTip('e4 grabs the center and opens your bishop', 'e4')).toBe(true);
    expect(isSpecificChessTip('d4 grabs the center', 'e4')).toBe(false);
    expect(isSpecificChessTip('e4 is a nice idea', 'e4')).toBe(false);
  });
});
