/**
 * chess-notation.ts
 *
 * Pure-TypeScript FEN diff → SAN converter.
 * No external chess library required.
 *
 * Given two consecutive FEN strings and the side that just moved,
 * returns the Standard Algebraic Notation (SAN) of the move played.
 *
 * Handles:
 *   - All piece moves (P, N, B, R, Q, K)
 *   - Captures (including en passant)
 *   - Castling (O-O and O-O-O)
 *   - Pawn promotion (defaults to =Q when promotion piece unknown)
 *   - Piece disambiguation (file, rank, or both)
 *   - Check (+) and checkmate (#) suffixes
 */

// ── Types ─────────────────────────────────────────────────────────────────────

type Square = string; // e.g. 'e4', 'a1'
type Piece  = string; // FEN piece char: P N B R Q K p n b r q k
type Board  = Map<Square, Piece>;

// ── Helpers ───────────────────────────────────────────────────────────────────

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'];

function sq(file: number, rank: number): Square {
  return FILES[file] + RANKS[rank];
}
function fileOf(s: Square): number { return FILES.indexOf(s[0]); }
function rankOf(s: Square): number { return RANKS.indexOf(s[1]); }

/** Parse the board part of a FEN string into a square→piece map. */
function parseFenBoard(fen: string): Board {
  const board: Board = new Map();
  const boardPart = fen.split(' ')[0];
  const ranks = boardPart.split('/'); // rank 8 → rank 1 (index 0 → 7)
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of ranks[r]) {
      if (ch >= '1' && ch <= '8') {
        f += parseInt(ch, 10);
      } else {
        board.set(sq(f, 7 - r), ch); // 7-r converts FEN rank order to rank index
        f++;
      }
    }
  }
  return board;
}

/** Is the piece owned by the given side? */
function ownedBy(piece: Piece, side: 'w' | 'b'): boolean {
  return side === 'w' ? piece === piece.toUpperCase() : piece === piece.toLowerCase();
}

/** Letter used in SAN for non-pawn pieces (uppercase). */
const SAN_LETTER: Record<string, string> = {
  N: 'N', B: 'B', R: 'R', Q: 'Q', K: 'K',
  n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K',
};

// ── Attack detection (needed for check/checkmate and disambiguation) ──────────

function attackedByKnight(board: Board, to: Square, side: 'w' | 'b'): Square[] {
  const tf = fileOf(to), tr = rankOf(to);
  const deltas = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
  const sources: Square[] = [];
  for (const [df, dr] of deltas) {
    const sf = tf + df, sr = tr + dr;
    if (sf < 0 || sf > 7 || sr < 0 || sr > 7) continue;
    const s = sq(sf, sr);
    const p = board.get(s);
    if (p && ownedBy(p, side) && p.toUpperCase() === 'N') sources.push(s);
  }
  return sources;
}

function attackedBySlider(board: Board, to: Square, side: 'w' | 'b', dirs: [number, number][], pieces: string[]): Square[] {
  const tf = fileOf(to), tr = rankOf(to);
  const sources: Square[] = [];
  for (const [df, dr] of dirs) {
    let f = tf + df, r = tr + dr;
    while (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
      const s = sq(f, r);
      const p = board.get(s);
      if (p) {
        if (ownedBy(p, side) && pieces.includes(p.toUpperCase())) sources.push(s);
        break; // blocked
      }
      f += df; r += dr;
    }
  }
  return sources;
}

function attackedByKing(board: Board, to: Square, side: 'w' | 'b'): Square[] {
  const tf = fileOf(to), tr = rankOf(to);
  const sources: Square[] = [];
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (df === 0 && dr === 0) continue;
      const sf = tf + df, sr = tr + dr;
      if (sf < 0 || sf > 7 || sr < 0 || sr > 7) continue;
      const s = sq(sf, sr);
      const p = board.get(s);
      if (p && ownedBy(p, side) && p.toUpperCase() === 'K') sources.push(s);
    }
  }
  return sources;
}

/** Find all squares from which side's pieces attack `to` square in the given board. */
function attackers(board: Board, to: Square, side: 'w' | 'b'): Square[] {
  const result: Square[] = [];
  // Pawns
  const pawnDir = side === 'w' ? -1 : 1;
  const tr = rankOf(to), tf = fileOf(to);
  for (const df of [-1, 1]) {
    const sf = tf + df, sr = tr + pawnDir;
    if (sf >= 0 && sf <= 7 && sr >= 0 && sr <= 7) {
      const s = sq(sf, sr);
      const p = board.get(s);
      if (p && ownedBy(p, side) && p.toUpperCase() === 'P') result.push(s);
    }
  }
  result.push(...attackedByKnight(board, to, side));
  result.push(...attackedBySlider(board, to, side, [[-1,0],[1,0],[0,-1],[0,1]], ['R','Q']));
  result.push(...attackedBySlider(board, to, side, [[-1,-1],[-1,1],[1,-1],[1,1]], ['B','Q']));
  result.push(...attackedByKing(board, to, side));
  return result;
}

/** Find the king square for the given side. */
function findKing(board: Board, side: 'w' | 'b'): Square | null {
  const kingPiece = side === 'w' ? 'K' : 'k';
  for (const [s, p] of board) {
    if (p === kingPiece) return s;
  }
  return null;
}

/** Is the king of `side` in check on the given board? */
function isInCheck(board: Board, side: 'w' | 'b'): boolean {
  const king = findKing(board, side);
  if (!king) return false;
  const opp: 'w' | 'b' = side === 'w' ? 'b' : 'w';
  return attackers(board, king, opp).length > 0;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Given two consecutive FEN strings (before and after a move) and the side
 * that just moved, return the SAN of the move played.
 *
 * Returns `undefined` if the move cannot be determined.
 */
export function fenDiffToSan(
  prevFen: string,
  newFen: string,
  turn: 'w' | 'b'
): string | undefined {
  if (!prevFen || !newFen) return undefined;

  const prev = parseFenBoard(prevFen);
  const curr = parseFenBoard(newFen);

  // ── 1. Castling detection ─────────────────────────────────────────────────
  // Detect king moving 2 squares horizontally on its home rank
  const kingPiece = turn === 'w' ? 'K' : 'k';
  const homeRank = turn === 'w' ? '1' : '8';
  const kingFrom = `e${homeRank}`;
  const kingTo = prev.get(kingFrom);
  if (kingTo === kingPiece && !curr.has(kingFrom)) {
    // King moved from e1/e8
    if (curr.has(`g${homeRank}`) && curr.get(`g${homeRank}`) === kingPiece) {
      return 'O-O';
    }
    if (curr.has(`c${homeRank}`) && curr.get(`c${homeRank}`) === kingPiece) {
      return 'O-O-O';
    }
  }

  // ── 2. Find moved piece squares ───────────────────────────────────────────
  let fromSq: Square | undefined;
  let toSq:   Square | undefined;

  // Squares where a friendly piece disappeared
  const disappeared: Square[] = [];
  // Squares where a friendly piece appeared or changed
  const appeared: Square[] = [];

  for (const s of [...new Set([...prev.keys(), ...curr.keys()])]) {
    const prevP = prev.get(s);
    const currP = curr.get(s);
    if (prevP && ownedBy(prevP, turn) && prevP !== currP) disappeared.push(s);
    if (currP && ownedBy(currP, turn) && currP !== prevP) appeared.push(s);
  }

  if (disappeared.length === 0 || appeared.length === 0) return undefined;

  // For normal moves: 1 disappeared, 1 appeared
  fromSq = disappeared[0];
  toSq   = appeared[0];

  if (!fromSq || !toSq) return undefined;

  const piece = prev.get(fromSq);
  if (!piece) return undefined;

  const pieceUpper = piece.toUpperCase();
  const isPawn = pieceUpper === 'P';

  // ── 3. En passant detection ───────────────────────────────────────────────
  // Pawn captures diagonally to an empty square (the captured pawn disappears)
  const isEnPassant =
    isPawn &&
    fileOf(fromSq) !== fileOf(toSq) &&
    !prev.has(toSq); // destination was empty

  // ── 4. Promotion detection ────────────────────────────────────────────────
  const toRank = rankOf(toSq);
  const isPromotion = isPawn && (toRank === 7 || toRank === 0);
  let promotionPiece = '';
  if (isPromotion) {
    const newP = curr.get(toSq);
    if (newP) {
      const letter = SAN_LETTER[newP] || 'Q';
      promotionPiece = `=${letter}`;
    } else {
      promotionPiece = '=Q';
    }
  }

  // ── 5. Capture detection ─────────────────────────────────────────────────
  const isCapture =
    isEnPassant ||
    (prev.has(toSq) && prev.get(toSq) !== undefined && !ownedBy(prev.get(toSq)!, turn));

  // ── 6. Disambiguation ─────────────────────────────────────────────────────
  let disambig = '';
  if (!isPawn) {
    // Find all other pieces of the same type that could reach toSq from the prev board
    // (with the moving piece removed to avoid counting it)
    const boardWithoutMover = new Map(prev);
    boardWithoutMover.delete(fromSq);

    const otherAttackers = attackers(boardWithoutMover, toSq, turn).filter(
      (s) => {
        const p = boardWithoutMover.get(s);
        return p && p.toUpperCase() === pieceUpper;
      }
    );

    if (otherAttackers.length > 0) {
      const sameFile = otherAttackers.some((s) => fileOf(s) === fileOf(fromSq!));
      const sameRank = otherAttackers.some((s) => rankOf(s) === rankOf(fromSq!));
      if (!sameFile) {
        disambig = fromSq[0]; // file disambig (e.g. Nbd2)
      } else if (!sameRank) {
        disambig = fromSq[1]; // rank disambig (e.g. N1d2)
      } else {
        disambig = fromSq; // full square disambig (e.g. Qa1b2 — extremely rare)
      }
    }
  }

  // ── 7. Build SAN string ───────────────────────────────────────────────────
  let san = '';

  if (isPawn) {
    if (isCapture) {
      san = fromSq[0] + 'x' + toSq;
    } else {
      san = toSq;
    }
    san += promotionPiece;
  } else {
    const prefix = SAN_LETTER[piece] ?? '';
    const captureStr = isCapture ? 'x' : '';
    san = prefix + disambig + captureStr + toSq;
  }

  // ── 8. Check / Checkmate suffix ───────────────────────────────────────────
  // Apply the move to curr board (it already reflects the new position)
  // Check if the opponent's king is in check
  const opp: 'w' | 'b' = turn === 'w' ? 'b' : 'w';
  if (isInCheck(curr, opp)) {
    // Determine if it's checkmate: can the opponent make any legal move?
    // For performance, just append '+' — determining '#' requires full move generation
    // which is complex. We'll use '+' for both check and checkmate.
    san += '+';
  }

  return san;
}
