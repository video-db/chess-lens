import { describe, expect, it } from 'vitest';
import { prepareRtstreamFenVisualText } from '../../../../../src/main/services/live-assist/fen/live-assist-rtstream';

describe('prepareRtstreamFenVisualText', () => {
  it('adds the rtstream source tag and keeps a valid white-perspective board', () => {
    const result = prepareRtstreamFenVisualText(`
<perspective>white</perspective>
<raw_board>rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR</raw_board>
`);

    expect(result).toMatchObject({
      normalizedFenBoard: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR',
    });
    expect('taggedText' in result && result.taggedText.startsWith('<source>rtstream</source>')).toBe(true);
  });

  it('normalizes black-perspective boards into white perspective', () => {
    const result = prepareRtstreamFenVisualText(`
<perspective>black</perspective>
<raw_board>rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR</raw_board>
`);

    expect(result).toMatchObject({
      normalizedFenBoard: 'RNBKQBNR/PPPPPPPP/8/8/8/8/pppppppp/rnbkqbnr',
    });
  });

  it('rejects malformed raw boards', () => {
    expect(prepareRtstreamFenVisualText('<raw_board>8/8/8</raw_board>')).toEqual({
      dropReason: 'wrong-rank-count',
    });
    expect(prepareRtstreamFenVisualText('<raw_board>9/8/8/8/8/8/8/8</raw_board>')).toEqual({
      dropReason: 'invalid-rank-math',
    });
    expect(prepareRtstreamFenVisualText('<board>8/8/8/8/8/8/8/8</board>')).toEqual({
      dropReason: 'missing-raw-board',
    });
  });
});
