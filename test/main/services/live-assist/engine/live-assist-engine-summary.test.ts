import { describe, expect, it } from 'vitest';
import { formatEngineSummaryTip, parseEngineSummaryMove } from '../../../../../src/main/services/live-assist/engine/live-assist-engine-summary';

describe('live assist engine summary', () => {
  it('extracts SAN and LAN moves from engine summaries', () => {
    expect(parseEngineSummaryMove([
      'Best move SAN: Nf3',
      'Best move LAN: g1f3',
      'Eval: 0.34',
    ].join('\n'))).toEqual({
      san: 'Nf3',
      lan: 'g1f3',
    });
  });

  it('returns null moves when the summary has no best move fields', () => {
    expect(parseEngineSummaryMove('Eval: 0.00')).toEqual({
      san: null,
      lan: null,
    });
  });

  it('formats multiline engine summaries for interim widget tips', () => {
    expect(formatEngineSummaryTip('Best move SAN: e4\n\nEval: 0.22')).toBe('engine: Best move SAN: e4 | Eval: 0.22');
  });
});
