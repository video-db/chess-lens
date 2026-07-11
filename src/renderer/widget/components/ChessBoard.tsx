import React, { useMemo } from 'react';

const PIECE_UNICODE: Record<string, string> = {
  K: '\u2654',
  Q: '\u2655',
  R: '\u2656',
  B: '\u2657',
  N: '\u2658',
  P: '\u2659',
  k: '\u265A',
  q: '\u265B',
  r: '\u265C',
  b: '\u265D',
  n: '\u265E',
  p: '\u265F',
};

interface ChessBoardProps {
  fen: string;
  moveFrom?: string;
  moveTo?: string;
  flipped?: boolean;
}

function parseFenBoard(fenBoard: string): string[][] {
  const rows = fenBoard.split('/');
  return rows.map((rank) => {
    const cells: string[] = [];
    for (const ch of rank) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < parseInt(ch, 10); i++) cells.push('');
      } else {
        cells.push(ch);
      }
    }
    return cells;
  });
}

function squareToGrid(square: string): { col: number; row: number } | null {
  if (!square || square.length < 2) return null;
  const col = square.charCodeAt(0) - 97;
  const row = 8 - parseInt(square[1], 10);
  if (col < 0 || col > 7 || row < 0 || row > 7) return null;
  return { col, row };
}

export function ChessBoard({ fen, moveFrom, moveTo, flipped }: ChessBoardProps) {
  const boardPart = fen.split(' ')[0];
  const board = useMemo(() => {
    const parsed = parseFenBoard(boardPart);
    return flipped
      ? parsed.slice().reverse().map((rank) => rank.slice().reverse())
      : parsed;
  }, [boardPart, flipped]);
  const size = 368;
  const sq = size / 8;

  const arrow = useMemo(() => {
    const from = squareToGrid(moveFrom ?? '');
    const to = squareToGrid(moveTo ?? '');
    if (!from || !to) return null;

    return {
      fromCol: flipped ? 7 - from.col : from.col,
      fromRow: flipped ? 7 - from.row : from.row,
      toCol: flipped ? 7 - to.col : to.col,
      toRow: flipped ? 7 - to.row : to.row,
    };
  }, [moveFrom, moveTo, flipped]);

  const arrowColor = 'rgba(0, 145, 6, 0.82)';
  const arrowWidth = sq * 0.22;
  const arrowHeadLen = sq * 0.42;
  const arrowHeadWidth = sq * 0.44;

  let arrowElem: React.ReactNode = null;
  if (arrow) {
    const x1 = arrow.fromCol * sq + sq / 2;
    const y1 = arrow.fromRow * sq + sq / 2;
    const x2 = arrow.toCol * sq + sq / 2;
    const y2 = arrow.toRow * sq + sq / 2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);

    if (len > 1) {
      const ux = dx / len;
      const uy = dy / len;
      const shaftEndX = x2 - ux * arrowHeadLen;
      const shaftEndY = y2 - uy * arrowHeadLen;
      const shaftStartX = x1 + ux * sq * 0.28;
      const shaftStartY = y1 + uy * sq * 0.28;
      const px = -uy;
      const py = ux;
      const tipX = x2 - ux * (sq * 0.08);
      const tipY = y2 - uy * (sq * 0.08);
      const wing1X = shaftEndX + (px * arrowHeadWidth) / 2;
      const wing1Y = shaftEndY + (py * arrowHeadWidth) / 2;
      const wing2X = shaftEndX - (px * arrowHeadWidth) / 2;
      const wing2Y = shaftEndY - (py * arrowHeadWidth) / 2;

      arrowElem = (
        <g style={{ pointerEvents: 'none' }}>
          <line
            x1={shaftStartX}
            y1={shaftStartY}
            x2={shaftEndX}
            y2={shaftEndY}
            stroke={arrowColor}
            strokeWidth={arrowWidth}
            strokeLinecap="round"
          />
          <polygon points={`${tipX},${tipY} ${wing1X},${wing1Y} ${wing2X},${wing2Y}`} fill={arrowColor} />
        </g>
      );
    }
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: 'block', borderRadius: 14, border: '0.5px solid rgba(255,255,255,0.2)' }}
    >
      {board.map((rank, ri) =>
        rank.map((piece, ci) => {
          const light = (ri + ci) % 2 === 0;
          const x = ci * sq;
          const y = ri * sq;
          const isFromSq = arrow && ri === arrow.fromRow && ci === arrow.fromCol;
          const isToSq = arrow && ri === arrow.toRow && ci === arrow.toCol;

          return (
            <g key={`${ri}-${ci}`}>
              <rect x={x} y={y} width={sq} height={sq} fill={light ? '#f0d9b5' : '#b58863'} />
              {(isFromSq || isToSq) && <rect x={x} y={y} width={sq} height={sq} fill="rgba(0, 200, 10, 0.35)" />}
              {piece && (
                <text
                  x={x + sq / 2}
                  y={y + sq / 2 + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={sq * 0.72}
                  style={{ userSelect: 'none' }}
                  fill={piece === piece.toUpperCase() ? '#ffffff' : '#111111'}
                  stroke={piece === piece.toUpperCase() ? '#444444' : '#dddddd'}
                  strokeWidth={piece === piece.toUpperCase() ? 2.2 : 0.4}
                  paintOrder="stroke fill"
                >
                  {PIECE_UNICODE[piece] ?? piece}
                </text>
              )}
            </g>
          );
        })
      )}
      {arrowElem}
      {(flipped ? 'hgfedcba' : 'abcdefgh').split('').map((file, i) => (
        <text
          key={file}
          x={i * sq + sq / 2}
          y={size - 1}
          textAnchor="middle"
          fontSize={9}
          fill="rgba(0,0,0,0.45)"
          style={{ userSelect: 'none' }}
        >
          {file}
        </text>
      ))}
      {(flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1]).map((rank, i) => (
        <text
          key={rank}
          x={3}
          y={i * sq + sq / 2}
          dominantBaseline="middle"
          fontSize={9}
          fill="rgba(0,0,0,0.45)"
          style={{ userSelect: 'none' }}
        >
          {rank}
        </text>
      ))}
    </svg>
  );
}
