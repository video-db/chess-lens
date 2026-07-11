import { fenDiffToSan } from './chess-notation';
import { INITIAL_CHESS_BOARD } from './canonical-history';
import { flipBoardPerspective, getPieceOnBoard } from './fen-utils';

export interface CastlingRightsState {
  whiteKingside: boolean;
  whiteQueenside: boolean;
  blackKingside: boolean;
  blackQueenside: boolean;
}

export interface CastlingRightsUpdate {
  castlingRights: CastlingRightsState;
  hasSeenInitialChessPosition: boolean;
}

export function buildDisplayFen(whitePerspectiveFen: string, perspective: 'white' | 'black'): string {
  if (perspective === 'white') return whitePerspectiveFen;

  const spaceIdx = whitePerspectiveFen.indexOf(' ');
  const boardPart = spaceIdx === -1 ? whitePerspectiveFen : whitePerspectiveFen.slice(0, spaceIdx);
  const rest = spaceIdx === -1 ? '' : whitePerspectiveFen.slice(spaceIdx);

  return `${flipBoardPerspective(boardPart)}${rest}`;
}

export function validateAlgebraicMovePair(from: string, to: string, fenBoard: string): boolean {
  const fromPiece = getPieceOnBoard(fenBoard, from);
  const toPiece = getPieceOnBoard(fenBoard, to);
  if (fromPiece === null || toPiece === null) return false;

  return (fromPiece === '' && toPiece !== '') || (fromPiece !== '' && toPiece === '');
}

export function deriveTurnFromAlgebraicMove(
  fromSq: string,
  toSq: string,
  fenBoard: string,
): 'w' | 'b' | null {
  const fromPiece = getPieceOnBoard(fenBoard, fromSq);
  const toPiece = getPieceOnBoard(fenBoard, toSq);
  if (fromPiece === null || toPiece === null) return null;

  let actualToPiece: string;
  if (toPiece !== '' && fromPiece === '') {
    actualToPiece = toPiece;
  } else if (fromPiece !== '' && toPiece === '') {
    actualToPiece = fromPiece;
  } else {
    return null;
  }

  if (/[A-Z]/.test(actualToPiece)) return 'b';
  if (/[a-z]/.test(actualToPiece)) return 'w';
  return null;
}

export function inferTurnFromBoards(
  prevBoard: string | null,
  currBoard: string,
  lastKnownTurn: 'w' | 'b' | null,
): 'w' | 'b' | null {
  if (!prevBoard || prevBoard === currBoard) {
    return lastKnownTurn;
  }

  const prevFen = `${prevBoard} w - - 0 1`;
  const currFen = `${currBoard} b - - 0 1`;

  const whiteMoved = fenDiffToSan(prevFen, currFen, 'w');
  const blackMoved = fenDiffToSan(prevFen, currFen, 'b');

  if (whiteMoved && !blackMoved) return 'b';
  if (blackMoved && !whiteMoved) return 'w';
  return null;
}

export function getCastlingRightsString(castlingRights: CastlingRightsState): string {
  const rights = [
    castlingRights.whiteKingside ? 'K' : '',
    castlingRights.whiteQueenside ? 'Q' : '',
    castlingRights.blackKingside ? 'k' : '',
    castlingRights.blackQueenside ? 'q' : '',
  ].join('');
  return rights || '-';
}

export function hasPieceAt(board: string, square: string, piece: string): boolean {
  const files = 'abcdefgh';
  const fileIndex = files.indexOf(square[0] || '');
  const rank = Number(square[1]);
  if (fileIndex < 0 || !Number.isInteger(rank) || rank < 1 || rank > 8) return false;

  const rows = board.split('/');
  const row = rows[8 - rank];
  if (!row) return false;

  let fileCursor = 0;
  for (const ch of row) {
    if (/^[1-8]$/.test(ch)) {
      fileCursor += Number(ch);
      continue;
    }
    if (fileCursor === fileIndex) return ch === piece;
    fileCursor += 1;
  }
  return false;
}

export function updateCastlingRightsFromBoard(
  board: string,
  castlingRights: CastlingRightsState,
  hasSeenInitialChessPosition: boolean,
): CastlingRightsUpdate {
  if (board === INITIAL_CHESS_BOARD) {
    return {
      castlingRights: {
        whiteKingside: true,
        whiteQueenside: true,
        blackKingside: true,
        blackQueenside: true,
      },
      hasSeenInitialChessPosition: true,
    };
  }

  if (!hasSeenInitialChessPosition) {
    return { castlingRights, hasSeenInitialChessPosition };
  }

  const next = { ...castlingRights };
  if (!hasPieceAt(board, 'e1', 'K')) {
    next.whiteKingside = false;
    next.whiteQueenside = false;
  }
  if (!hasPieceAt(board, 'e8', 'k')) {
    next.blackKingside = false;
    next.blackQueenside = false;
  }
  if (!hasPieceAt(board, 'h1', 'R')) next.whiteKingside = false;
  if (!hasPieceAt(board, 'a1', 'R')) next.whiteQueenside = false;
  if (!hasPieceAt(board, 'h8', 'r')) next.blackKingside = false;
  if (!hasPieceAt(board, 'a8', 'r')) next.blackQueenside = false;

  return { castlingRights: next, hasSeenInitialChessPosition };
}
