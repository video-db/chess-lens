import { flipBoardPerspective } from '../../../lib/chess/fen-utils';

export interface PreparedRtstreamFen {
  taggedText: string;
  normalizedFenBoard: string;
}

export type RtstreamFenDropReason =
  | 'missing-raw-board'
  | 'wrong-rank-count'
  | 'invalid-rank-math';

export interface DroppedRtstreamFen {
  dropReason: RtstreamFenDropReason;
}

export function prepareRtstreamFenVisualText(text: string): PreparedRtstreamFen | DroppedRtstreamFen {
  const rawBoardMatch = text.match(/<raw_board>\s*(.*?)\s*<\/raw_board>/is);

  if (!rawBoardMatch) {
    return { dropReason: 'missing-raw-board' };
  }

  const rawBoard = rawBoardMatch[1]!.replace(/\s+/g, '');
  const ranks = rawBoard.split('/');

  if (ranks.length !== 8) {
    return { dropReason: 'wrong-rank-count' };
  }

  for (const rank of ranks) {
    let squareCount = 0;

    for (const ch of rank) {
      if (/\d/.test(ch)) {
        squareCount += parseInt(ch, 10);
      } else if (/[pnbrqkPNBRQK]/.test(ch)) {
        squareCount += 1;
      } else {
        return { dropReason: 'invalid-rank-math' };
      }
    }

    if (squareCount !== 8) {
      return { dropReason: 'invalid-rank-math' };
    }
  }

  const perspectiveMatch = text.match(/<perspective>\s*(.*?)\s*<\/perspective>/is);
  const isBlackPerspective = perspectiveMatch?.[1]?.toLowerCase().includes('black');
  const normalizedFenBoard = isBlackPerspective ? flipBoardPerspective(rawBoard) : rawBoard;
  const taggedText = text.includes('<source>')
    ? text
    : `<source>rtstream</source>\n${text}`;

  return {
    taggedText,
    normalizedFenBoard,
  };
}
