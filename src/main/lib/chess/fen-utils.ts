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

/**
 * Extract the multiset of piece characters from a single FEN rank string.
 * Digits (empty squares) are ignored.
 * Returns a Map<pieceChar, count>.
 */
export function getPieceMultiset(rank: string): Map<string, number> {
  const multiset = new Map<string, number>();
  for (const ch of rank) {
    if (!/\d/.test(ch)) {
      multiset.set(ch, (multiset.get(ch) ?? 0) + 1);
    }
  }
  return multiset;
}

/**
 * Compare two piece multisets for equality.
 */
export function areMultisetsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, val] of a) {
    if (b.get(key) !== val) return false;
  }
  return true;
}

/**
 * Extract the sequence of piece letters from a FEN rank, discarding digits.
 * e.g. "R1BQ1RK1" → "RBQRK", "bqp1" → "bqp"
 */
export function getLetterSequence(rank: string): string {
  let seq = '';
  for (const ch of rank) {
    if (!/\d/.test(ch)) seq += ch;
  }
  return seq;
}

/**
 * Compare a new FEN board string rank-by-rank against the last confirmed
 * board.  On a real chess move at most 2 ranks change their piece multiset.
 * Any other rank whose piece multiset matches the previous frame but whose
 * digit/piece arrangement differs is almost certainly an LLM transposition
 * error (e.g. "bqp1" instead of "bq1p").  In that case the previous rank's
 * arrangement is used instead.
 *
 * SAFETY GUARD: we only replace when the LETTER SEQUENCE (pieces-only, digits
 * stripped) is identical between old and new ranks.  If letters differ then
 * a piece actually moved within that rank (e.g. castling: R1BQK2R → R1BQ1RK1)
 * and we must NOT overwrite the new arrangement with the stale old one.
 *
 * Returns the corrected board string.  When no fix is needed the original
 * string is returned unchanged.
 */
export function fixRankTranspositions(newBoard: string, lastBoard: string): string {
  const newRanks = newBoard.split('/');
  const lastRanks = lastBoard.split('/');
  if (newRanks.length !== 8 || lastRanks.length !== 8) return newBoard;

  // Count how many ranks have genuinely different piece multisets.
  // On a real chess move, at most 2 ranks change their multiset (origin + destination).
  // If >= 2 ranks changed multiset, any rank with same multiset but different
  // arrangement is a digit transposition, safe to fix. If 0-1 ranks changed
  // multiset, the rank's own change could be the move itself — don't touch it.
  let multisetChangeCount = 0;
  for (let i = 0; i < 8; i++) {
    if (!areMultisetsEqual(getPieceMultiset(newRanks[i]!), getPieceMultiset(lastRanks[i]!))) {
      multisetChangeCount++;
    }
  }

  const fixed: string[] = [];
  for (let i = 0; i < 8; i++) {
    const nr = newRanks[i]!;
    const lr = lastRanks[i]!;
    if (nr === lr) {
      fixed.push(nr);
      continue;
    }
    const newSet = getPieceMultiset(nr);
    const lastSet = getPieceMultiset(lr);
    if (areMultisetsEqual(newSet, lastSet)) {
      const newLetters = getLetterSequence(nr);
      const lastLetters = getLetterSequence(lr);
      if (newLetters === lastLetters) {
        // Same pieces in same order — only digits differ.
        // Safe to fix ONLY if a real move occurred on other ranks
        // (different multiset changes detected elsewhere).
        // If multisetChangeCount is low, this rank's change IS the move.
        if (multisetChangeCount >= 2) {
          fixed.push(lr);
        } else {
          fixed.push(nr);
        }
      } else {
        // Pieces moved within rank (different letter order). Do NOT overwrite.
        fixed.push(nr);
      }
    } else {
      fixed.push(nr);
    }
  }
  return fixed.join('/');
}
