export type ChessSide = 'w' | 'b';
export type BoardOrientation = 'white' | 'black';

export interface LiveAssistTurnContext {
  playerColor: ChessSide;
  justMoved: ChessSide;
  sideToMove: ChessSide;
  isPlayerTurn: boolean;
  playerColorLabel: 'White' | 'Black';
  opponentColorLabel: 'White' | 'Black';
  sideToMoveLabel: 'White' | 'Black';
  justMovedLabel: 'White' | 'Black';
}

function sideLabel(side: ChessSide): 'White' | 'Black' {
  return side === 'w' ? 'White' : 'Black';
}

export function resolveLiveAssistTurnContext({
  perspective,
  justMoved,
}: {
  perspective: BoardOrientation;
  justMoved?: ChessSide | null;
}): LiveAssistTurnContext {
  const playerColor: ChessSide = perspective === 'black' ? 'b' : 'w';
  const resolvedJustMoved: ChessSide = justMoved ?? playerColor;
  const sideToMove: ChessSide = resolvedJustMoved === 'w' ? 'b' : 'w';
  const isPlayerTurn = sideToMove === playerColor;

  return {
    playerColor,
    justMoved: resolvedJustMoved,
    sideToMove,
    isPlayerTurn,
    playerColorLabel: sideLabel(playerColor),
    opponentColorLabel: sideLabel(playerColor === 'w' ? 'b' : 'w'),
    sideToMoveLabel: sideLabel(sideToMove),
    justMovedLabel: sideLabel(resolvedJustMoved),
  };
}
