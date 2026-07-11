import { logger } from '../logger';

const log = logger.child({ module: 'board-plausibility' });

/**
 * Count every piece type on the board and return a map of piece char to count.
 * e.g. { P: 5, N: 2, B: 1, R: 2, Q: 1, K: 1, p: 7, n: 1, b: 2, r: 2, q: 1, k: 1 }
 */
export function countPiecesByType(board: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ch of board) {
    if (/[prnbqkPRNBQK]/.test(ch)) {
      counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Validate that a candidate board is physically plausible given the last
 * confirmed board. Catches common piece-confusion hallucinations while allowing
 * legal moves, captures, promotions, and small skips.
 */
export function isBoardPlausible(prevBoard: string | null, candidateBoard: string): boolean {
  if (!prevBoard) return true;

  const prev = countPiecesByType(prevBoard);
  const cand = countPiecesByType(candidateBoard);
  const get = (m: Map<string, number>, k: string) => m.get(k) ?? 0;

  const whitePBPrev = get(prev, 'P') + get(prev, 'B');
  const whitePBCand = get(cand, 'P') + get(cand, 'B');
  const blackPBPrev = get(prev, 'p') + get(prev, 'b');
  const blackPBCand = get(cand, 'p') + get(cand, 'b');

  if (whitePBCand > whitePBPrev + 1) {
    log.warn(
      { prevWhitePB: whitePBPrev, candWhitePB: whitePBCand, prevBoard: prevBoard.slice(0, 30), candidateBoard: candidateBoard.slice(0, 30) },
      'White pawn/bishop count increased by more than one; rejecting likely hallucinated board'
    );
    return false;
  }
  if (blackPBCand > blackPBPrev + 1) {
    log.warn(
      { prevBlackPB: blackPBPrev, candBlackPB: blackPBCand },
      'Black pawn/bishop count increased by more than one; rejecting likely hallucinated board'
    );
    return false;
  }

  const whiteNRPrev = get(prev, 'N') + get(prev, 'R');
  const whiteNRCand = get(cand, 'N') + get(cand, 'R');
  const blackNRPrev = get(prev, 'n') + get(prev, 'r');
  const blackNRCand = get(cand, 'n') + get(cand, 'r');

  if (whiteNRCand > whiteNRPrev + 1) {
    log.warn(
      { prevWhiteNR: whiteNRPrev, candWhiteNR: whiteNRCand },
      'White knight/rook count increased by more than one; rejecting likely hallucinated board'
    );
    return false;
  }
  if (blackNRCand > blackNRPrev + 1) {
    log.warn(
      { prevBlackNR: blackNRPrev, candBlackNR: blackNRCand },
      'Black knight/rook count increased by more than one; rejecting likely hallucinated board'
    );
    return false;
  }

  const prevTotal = [...prev.values()].reduce((a, b) => a + b, 0);
  const candTotal = [...cand.values()].reduce((a, b) => a + b, 0);
  if (candTotal > prevTotal + 2) {
    log.warn(
      { prevTotal, candTotal },
      'Total piece count jumped upward; rejecting implausible board'
    );
    return false;
  }

  return true;
}
