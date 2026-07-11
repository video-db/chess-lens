export function describeMovingPiece(fenBoard: string, lanMove: string): string | null {
  if (!fenBoard || !lanMove || lanMove.length < 4) return null;

  const fromFile = lanMove[0];
  const fromRank = lanMove[1];
  if (!fromFile || !fromRank) return null;

  const fileIdx = fromFile.charCodeAt(0) - 'a'.charCodeAt(0);
  const rankIdx = 8 - parseInt(fromRank, 10);
  if (fileIdx < 0 || fileIdx > 7 || rankIdx < 0 || rankIdx > 7) return null;

  const rankStr = fenBoard.split('/')[rankIdx];
  if (!rankStr) return null;

  const cells: string[] = [];
  for (const char of rankStr) {
    if (/\d/.test(char)) {
      for (let i = 0; i < parseInt(char, 10); i += 1) cells.push('');
    } else {
      cells.push(char);
    }
  }

  const piece = cells[fileIdx];
  if (!piece) return null;

  const pieceNames: Record<string, string> = {
    P: 'White Pawn',
    N: 'White Knight',
    B: 'White Bishop',
    R: 'White Rook',
    Q: 'White Queen',
    K: 'White King',
    p: 'Black Pawn',
    n: 'Black Knight',
    b: 'Black Bishop',
    r: 'Black Rook',
    q: 'Black Queen',
    k: 'Black King',
  };

  const pieceName = pieceNames[piece];
  if (!pieceName) return null;

  return `${pieceName} on ${fromFile}${fromRank}`;
}
