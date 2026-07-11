export interface BoardPieceDiagnostics {
  P: number;
  p: number;
  B: number;
  b: number;
  N: number;
  n: number;
  R: number;
  r: number;
  whitePieces: number;
  blackPieces: number;
  whiteKings: number;
  blackKings: number;
  pawnsOnBackRank: number;
  PB_white: number;
  PB_black: number;
  NR_white: number;
  NR_black: number;
  total: number;
}

export function countBoardPieces(board: string): BoardPieceDiagnostics {
  const counts: BoardPieceDiagnostics = {
    P: 0,
    p: 0,
    B: 0,
    b: 0,
    N: 0,
    n: 0,
    R: 0,
    r: 0,
    whitePieces: 0,
    blackPieces: 0,
    whiteKings: 0,
    blackKings: 0,
    pawnsOnBackRank: 0,
    PB_white: 0,
    PB_black: 0,
    NR_white: 0,
    NR_black: 0,
    total: 0,
  };

  const ranks = board.split('/');
  for (let rankIndex = 0; rankIndex < ranks.length; rankIndex++) {
    const rank = ranks[rankIndex] ?? '';
    for (const ch of rank) {
      if (ch === 'P') counts.P++;
      else if (ch === 'p') counts.p++;
      else if (ch === 'B') counts.B++;
      else if (ch === 'b') counts.b++;
      else if (ch === 'N') counts.N++;
      else if (ch === 'n') counts.n++;
      else if (ch === 'R') counts.R++;
      else if (ch === 'r') counts.r++;

      if (ch === 'K') counts.whiteKings++;
      else if (ch === 'k') counts.blackKings++;

      if (/[PNBRQK]/.test(ch)) counts.whitePieces++;
      else if (/[pnbrqk]/.test(ch)) counts.blackPieces++;

      if (/[pnbrqkPNBRQK]/.test(ch)) counts.total++;
      if ((rankIndex === 0 || rankIndex === 7) && (ch === 'P' || ch === 'p')) {
        counts.pawnsOnBackRank++;
      }
    }
  }

  counts.PB_white = counts.P + counts.B;
  counts.PB_black = counts.p + counts.b;
  counts.NR_white = counts.N + counts.R;
  counts.NR_black = counts.n + counts.r;

  return counts;
}

export function buildSemanticRejectDiagnostics(board: string) {
  const counts = countBoardPieces(board);
  return {
    whitePieces: counts.whitePieces,
    blackPieces: counts.blackPieces,
    whiteKings: counts.whiteKings,
    blackKings: counts.blackKings,
    pawnsOnBackRank: counts.pawnsOnBackRank,
  };
}

