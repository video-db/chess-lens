import { describe, expect, it } from 'vitest';
import {
  selectLatestFenFromVisuals,
  type LiveAssistFenCandidate,
} from '../../../../src/main/lib/chess/live-assist-fen-selection';

function selectFromTaggedFixtures(visualTexts: string[]): string | null {
  const candidatesByFen = new Map<string, LiveAssistFenCandidate>([
    ['rtstream-board', { fen: 'rtstream-board w - - 0 1', source: 'tagged_raw_board' }],
    ['screenshot-board', { fen: 'screenshot-board w - - 0 1', source: 'tagged_raw_board' }],
    ['plain-board', { fen: 'plain-board w - - 0 1', source: 'inline_fen' }],
  ]);

  return selectLatestFenFromVisuals({
    visuals: visualTexts.map((text) => ({ text })),
    getFenCandidates: (text) => {
      const found: LiveAssistFenCandidate[] = [];
      for (const [token, candidate] of candidatesByFen) {
        if (text.includes(token)) found.push(candidate);
      }
      return found;
    },
    sanitizeText: (text) => text,
    debug: () => undefined,
  });
}

describe('selectLatestFenFromVisuals', () => {
  it('prefers an older RTStream tagged raw board over newer screenshot fallback data', () => {
    expect(selectFromTaggedFixtures([
      '<source>rtstream</source><raw_board>rtstream-board</raw_board>',
      '<source>screenshot</source><raw_board>screenshot-board</raw_board>',
    ])).toBe('rtstream-board w - - 0 1');
  });

  it('uses screenshot tagged raw board when RTStream has no board candidate', () => {
    expect(selectFromTaggedFixtures([
      '<source>rtstream</source><raw_board>invalid-board</raw_board>',
      '<source>screenshot</source><raw_board>screenshot-board</raw_board>',
    ])).toBe('screenshot-board w - - 0 1');
  });

  it('falls back to any valid FEN candidate when no tagged raw board exists', () => {
    expect(selectFromTaggedFixtures([
      'plain-board',
    ])).toBe('plain-board w - - 0 1');
  });
});
