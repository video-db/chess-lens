import type { VisualIndexChunk } from '../live-assist.types';

export interface ResolvedFenTurn {
  fen: string;
  board: string;
  turn: 'w' | 'b';
}

export interface LatestChessMove {
  san?: string;
  uci?: string;
}

export function applyNextTurnToFen(params: {
  fen: string;
  visuals?: VisualIndexChunk[];
  lastChessTurn: 'w' | 'b' | null;
  lastChessPerspective: 'white' | 'black';
  castling: string;
  debug?: (data: Record<string, unknown>, message: string) => void;
}): ResolvedFenTurn {
  const { fen, visuals, lastChessTurn, lastChessPerspective, castling, debug } = params;
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) {
    return { fen, board: fen.split(' ')[0] || fen, turn: lastChessTurn ?? 'w' };
  }

  const [board, , , enPassant, halfmove = '0', fullmove = '1'] = parts;
  const inferredTurn = lastChessTurn ?? (
    readBoardMatchedTurnFromVisuals(board, visuals, debug) ??
    (lastChessPerspective === 'black' ? 'b' : 'w')
  );

  const nextFen = `${board} ${inferredTurn} ${castling} ${enPassant} ${halfmove} ${fullmove}`;
  debug?.(
    { board: board.slice(0, 30), inferredTurn, perspective: lastChessPerspective, castling },
    '[LiveAssist] applyNextTurnToFen: turn determined',
  );
  return { fen: nextFen, board, turn: inferredTurn };
}

export function extractLatestChessMove(visuals: VisualIndexChunk[]): LatestChessMove {
  for (let i = visuals.length - 1; i >= 0; i -= 1) {
    const text = visuals[i].text;
    const sanMatch = text.match(/\bSAN\s*:\s*([^|\n]+)/i);
    const moveMatch = text.match(/\bMove\s*:\s*([a-h][1-8][a-h][1-8][qrbn]?)/i);
    if (sanMatch?.[1] || moveMatch?.[1]) {
      return {
        san: sanMatch?.[1]?.trim(),
        uci: moveMatch?.[1]?.trim(),
      };
    }
  }
  return {};
}

function readBoardMatchedTurnFromVisuals(
  board: string,
  visuals: VisualIndexChunk[] | undefined,
  debug?: (data: Record<string, unknown>, message: string) => void,
): 'w' | 'b' | null {
  if (!visuals?.length) return null;

  for (let i = visuals.length - 1; i >= 0; i -= 1) {
    const chunkText = visuals[i].text;
    const turnMatch = chunkText.match(/<turn>\s*(.*?)\s*<\/turn>/is);
    if (!turnMatch) continue;

    const boardMatch = chunkText.match(/<raw_board>\s*(.*?)\s*<\/raw_board>/is);
    if (boardMatch) {
      const chunkBoard = boardMatch[1].trim();
      if (chunkBoard !== board.trim()) {
        debug?.(
          { chunkBoard: chunkBoard.slice(0, 30), currentBoard: board.slice(0, 30) },
          '[LiveAssist] applyNextTurnToFen: skipping stale <turn> tag (board mismatch)',
        );
        continue;
      }
    }

    const turnFromVisuals = turnMatch[1].toLowerCase().includes('black') ? 'b' : 'w';
    debug?.(
      { turnFromVisuals, source: 'visual_index_turn_tag' },
      '[LiveAssist] applyNextTurnToFen: turn read from visual index <turn> tag (board-matched)',
    );
    return turnFromVisuals;
  }

  return null;
}
