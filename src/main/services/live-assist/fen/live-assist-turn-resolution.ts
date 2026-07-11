import {
  deriveTurnFromAlgebraicMove,
  inferTurnFromBoards,
  validateAlgebraicMovePair,
} from '../../../lib/chess/live-assist-chess-helpers';

export type Turn = 'w' | 'b';
export type TurnResolutionTier = '2a' | '2b' | '3' | '4' | '5';

export interface ResolveConfirmedFenTurnInput {
  fenBoard: string;
  perspective: 'white' | 'black';
  lastChessBoard: string | null;
  lastChessTurn: Turn | null;
  reportedTurn: Turn | null;
  reportedLastMoveFrom?: string | null;
  reportedLastMoveTo?: string | null;
}

export interface ConfirmedFenTurnResolution {
  inferredTurn: Turn;
  tierUsed: TurnResolutionTier;
  validatedMoveFrom: string | null;
  validatedMoveTo: string | null;
  gridDerivedTurn: Turn | null;
  effectiveGridDerivedTurn: Turn | null;
  llmTurn: Turn | null;
  boardDiffTurn: Turn | null;
  invalidMovePair: boolean;
  gridReportedDisagree: boolean;
}

export function resolveConfirmedFenTurn({
  fenBoard,
  perspective,
  lastChessBoard,
  lastChessTurn,
  reportedTurn,
  reportedLastMoveFrom,
  reportedLastMoveTo,
}: ResolveConfirmedFenTurnInput): ConfirmedFenTurnResolution {
  let validatedMoveFrom = reportedLastMoveFrom ?? null;
  let validatedMoveTo = reportedLastMoveTo ?? null;
  let invalidMovePair = false;

  if (validatedMoveFrom && validatedMoveTo && !validateAlgebraicMovePair(validatedMoveFrom, validatedMoveTo, fenBoard)) {
    invalidMovePair = true;
    validatedMoveFrom = null;
    validatedMoveTo = null;
  }

  const gridDerivedTurn = validatedMoveFrom && validatedMoveTo
    ? deriveTurnFromAlgebraicMove(validatedMoveFrom, validatedMoveTo, fenBoard)
    : null;
  const gridReportedDisagree = gridDerivedTurn !== null && reportedTurn !== null && gridDerivedTurn !== reportedTurn;
  const effectiveGridDerivedTurn = gridReportedDisagree ? null : gridDerivedTurn;
  const llmTurn = effectiveGridDerivedTurn ?? reportedTurn;
  const boardDiffTurn = llmTurn === null && lastChessBoard && lastChessBoard !== fenBoard
    ? inferTurnFromBoards(lastChessBoard, fenBoard, lastChessTurn)
    : null;

  const inferredTurn =
    llmTurn ??
    boardDiffTurn ??
    lastChessTurn ??
    (perspective === 'black' ? 'b' : 'w');

  const tierUsed =
    effectiveGridDerivedTurn != null ? '2a' :
    reportedTurn != null ? '2b' :
    boardDiffTurn != null ? '3' :
    lastChessTurn != null ? '4' : '5';

  return {
    inferredTurn,
    tierUsed,
    validatedMoveFrom,
    validatedMoveTo,
    gridDerivedTurn,
    effectiveGridDerivedTurn,
    llmTurn,
    boardDiffTurn,
    invalidMovePair,
    gridReportedDisagree,
  };
}

