import type { ChessContextData } from '../live-assist.types';

export function buildGameContextSection(description?: string): string {
  const trimmed = description?.trim();
  return trimmed ? `## PLAYER'S GAME GOALS\n${trimmed}\n\n` : '';
}

export function buildTerminalPrompt(params: {
  description?: string;
  chessContext: ChessContextData;
  terminal: 'checkmate' | 'stalemate';
  sideToMoveLabel: string;
  justMovedLabel: string;
}): string {
  const { description, chessContext, terminal, sideToMoveLabel, justMovedLabel } = params;
  const gameContextSection = buildGameContextSection(description);

  if (terminal === 'checkmate') {
    return `${gameContextSection}## CHESS POSITION CONTEXT
FEN: ${chessContext.fen}
The game has ended. ${sideToMoveLabel} is in checkmate - ${justMovedLabel} delivered the decisive blow.

## TASK
You are a chess analyst. In one or two sentences (15-30 words total), explain this checkmate: identify the tactical pattern or motif and the key piece(s), and briefly note what defensive resource ${sideToMoveLabel} lacked.
For ask_this, write one short question that tests understanding of the mating pattern.
Respond with ONLY a raw JSON object: {"say_this":"...","ask_this":"..."}`;
  }

  return `${gameContextSection}## CHESS POSITION CONTEXT
FEN: ${chessContext.fen}
The game has ended in stalemate - ${sideToMoveLabel} has no legal move but is not in check.

## TASK
You are a chess analyst. In one or two sentences (15-30 words total), explain this stalemate: identify which pieces are restricting ${sideToMoveLabel}'s moves and what ${justMovedLabel} could have done differently.
For ask_this, write one short question that tests understanding of stalemate avoidance.
Respond with ONLY a raw JSON object: {"say_this":"...","ask_this":"..."}`;
}

export function buildOpponentThreatPrompt(params: {
  description?: string;
  chessContext: ChessContextData;
  playerColorLabel: string;
  opponentColorLabel: string;
  bestOppMoveSan: string;
  opponentPieceDescription: string | null;
}): string {
  const {
    description,
    chessContext,
    playerColorLabel,
    opponentColorLabel,
    bestOppMoveSan,
    opponentPieceDescription,
  } = params;
  const gameContextSection = buildGameContextSection(description);
  const pieceAnchor = opponentPieceDescription
    ? `Moving piece: ${opponentPieceDescription} (confirmed from FEN - do NOT contradict this).`
    : '';

  return `${gameContextSection}## CHESS POSITION CONTEXT
FEN: ${chessContext.fen}
You are coaching ${playerColorLabel}. It is currently ${opponentColorLabel}'s turn.
${chessContext.engineSummary ? `Engine summary:\n${chessContext.engineSummary}\n` : ''}
---

## OPPONENT'S BEST MOVE: ${bestOppMoveSan}
${pieceAnchor}
The engine says ${opponentColorLabel}'s best move is ${bestOppMoveSan}.
Explain to ${playerColorLabel} what this move threatens or achieves in one or two sentences (20-30 words total). Describe the concrete threat or idea behind ${bestOppMoveSan} and what ${playerColorLabel} must watch out for or prepare.
Only mention piece positions that are confirmed by the FEN. Do not invent piece locations.
For ask_this: ask what ${playerColorLabel}'s best defensive or counter response would be.
Respond with ONLY a raw JSON object: {"say_this":"...","ask_this":"..."}`;
}

export function buildPlayerBestMovePrompt(params: {
  description?: string;
  chessContext: ChessContextData | null;
  playerColorLabel: string;
  bestMoveSan: string | null;
  movingPieceDescription: string | null;
}): { prompt: string; hasChessSection: boolean } {
  const { description, chessContext, playerColorLabel, bestMoveSan, movingPieceDescription } = params;
  const gameContextSection = buildGameContextSection(description);
  const chessSection = chessContext
    ? `## CHESS POSITION CONTEXT
FEN: ${chessContext.fen}
Player is: ${playerColorLabel} (generate the tip for ${playerColorLabel}'s best move)
${chessContext.playedMoveSan ? `Played SAN: ${chessContext.playedMoveSan}\n` : ''}${chessContext.playedMoveUci ? `Played UCI: ${chessContext.playedMoveUci}\n` : ''}${chessContext.engineSummary ? `Engine summary:\n${chessContext.engineSummary}\n` : ''}
---

`
    : '';
  const pieceAnchor = movingPieceDescription
    ? `Moving piece: ${movingPieceDescription} (confirmed from FEN - do NOT contradict this).`
    : '';
  const bestMoveInstruction = bestMoveSan
    ? `## REQUIRED MOVE: ${bestMoveSan}\nYou MUST use "${bestMoveSan}" as the move in say_this. Do not suggest any other move.\n${pieceAnchor}`
    : '## TASK\nUse the best move from the engine summary above.';

  return {
    hasChessSection: !!chessSection,
    prompt: `${gameContextSection}${chessSection}${bestMoveInstruction}
In one or two sentences (20-30 words total), explain why ${bestMoveSan ?? 'the engine move'} is best. Name the immediate concrete threat, square, or tactical idea it creates, and briefly note the follow-up benefit or what it prevents.
Only mention piece positions confirmed by the FEN. No generic advice.
For ask_this, write one short calculation question about the next move or likely response.
Respond with ONLY a raw JSON object: {"say_this":"...","ask_this":"..."}`,
  };
}
