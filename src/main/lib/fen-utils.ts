/**
 * fen-utils.ts
 *
 * Shared FEN board string utilities used across main-process services.
 * All functions are pure (no I/O, no side effects).
 */

/**
 * Rotate a FEN board string 180° — converts a black-perspective board to
 * white-perspective and vice versa.
 *
 * Algorithm: reverse rank order then mirror each rank's files.
 * Input/output is the board-only part of a FEN (e.g. "rnbqkbnr/pppppppp/…").
 */
export function flipBoardPerspective(board: string): string {
  const rows = board.split('/');
  rows.reverse();
  return rows.map((r) => r.split('').reverse().join('')).join('/');
}

/**
 * Validate the math of a raw FEN board string.
 *
 * Checks that:
 *   - There are exactly 8 ranks (separated by '/').
 *   - Every rank sums to exactly 8 squares (digits count as empty squares,
 *     piece letters count as 1).
 *   - No illegal characters are present.
 *
 * Returns null when the board is valid, or an error description string
 * suitable for logging / LLM correction prompts when invalid.
 */
export function validateFenRanks(rawBoard: string): string | null {
  const ranks = rawBoard.split('/');
  if (ranks.length !== 8) {
    return `Board has ${ranks.length} ranks instead of 8.`;
  }
  for (let i = 0; i < ranks.length; i++) {
    let sq = 0;
    for (const ch of ranks[i]) {
      if (/\d/.test(ch)) {
        sq += parseInt(ch, 10);
      } else if (/[pnbrqkPNBRQK]/.test(ch)) {
        sq += 1;
      } else {
        return `Invalid character '${ch}' in rank ${i + 1} (not a legal FEN piece letter).`;
      }
    }
    if (sq !== 8) {
      return `Visual Row ${i + 1} ('${ranks[i]}') sums to ${sq} squares instead of 8.`;
    }
  }
  return null;
}

/**
 * Convert an algebraic square string (e.g. "e4") to zero-based grid indices.
 *
 * Returns { rankIdx, fileIdx } where:
 *   fileIdx: 0 = file a … 7 = file h
 *   rankIdx: 0 = rank 8 (top of white-perspective board) … 7 = rank 1
 *
 * Returns null when the input is malformed.
 */
export function squareToIndices(sq: string): { rankIdx: number; fileIdx: number } | null {
  if (!sq || sq.length < 2) return null;
  const fileIdx = sq.charCodeAt(0) - 97; // 'a'=0 … 'h'=7
  const rankIdx = 8 - parseInt(sq[1], 10); // '8'→0, '1'→7
  if (fileIdx < 0 || fileIdx > 7 || rankIdx < 0 || rankIdx > 7 || isNaN(rankIdx)) return null;
  return { rankIdx, fileIdx };
}

/**
 * Return the piece character on a given square of a FEN board string, or:
 *   ''   — square is empty
 *   null — square index is out of range or the board string is malformed
 */
export function getPieceOnBoard(fenBoard: string, sq: string): string | null {
  const idx = squareToIndices(sq);
  if (!idx) return null;
  const { rankIdx, fileIdx } = idx;

  const ranks = fenBoard.split('/');
  if (ranks.length !== 8) return null;
  const rank = ranks[rankIdx];
  if (!rank) return null;

  let col = 0;
  for (const ch of rank) {
    if (/\d/.test(ch)) {
      const skip = parseInt(ch, 10);
      if (fileIdx < col + skip) return '';
      col += skip;
    } else {
      if (col === fileIdx) return ch;
      col += 1;
    }
    if (col > fileIdx) break;
  }
  return '';
}
