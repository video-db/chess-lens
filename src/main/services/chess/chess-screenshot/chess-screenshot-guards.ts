import { MAX_SQUARE_DELTA } from './chess-screenshot.constants';

export function countPiecesInFenBoard(fenBoard: string): number {
  let pieceCount = 0;
  for (const ch of fenBoard) {
    if (/[pnbrqkPNBRQK]/.test(ch)) pieceCount++;
  }
  return pieceCount;
}

export function hasBothKingsInFenBoard(fenBoard: string): boolean {
  return fenBoard.includes('K') && fenBoard.includes('k');
}

export function getEffectiveMaxSquareDelta(fenBoard: string): number {
  return countPiecesInFenBoard(fenBoard) <= 12 ? 3 : MAX_SQUARE_DELTA;
}

export function isPerspectiveFlipFenBoard(fenBoard: string): boolean {
  const ranks = fenBoard.split('/');
  if (ranks.length !== 8) return false;

  const topHasUpper = /[PNBRQK]/.test(ranks[0]!);
  const bottomHasLower = /[pnbrqk]/.test(ranks[7]!);
  return topHasUpper && bottomHasLower;
}
