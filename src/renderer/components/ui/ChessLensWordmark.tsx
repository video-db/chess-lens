/**
 * ChessLensWordmark
 *
 * Renders the Chess Lens brand wordmark exactly as defined in the Figma brand sheet:
 * - "Chess" in the body/neutral color
 * - "Lens" fully in #FF4000 (orange)
 * - Font: IBM Plex Mono 700
 *
 * Usage variants:
 *   <ChessLensWordmark />                  — default dark (#242424 / #FF4000)
 *   <ChessLensWordmark variant="light" />  — on dark bg (#FFFFFF / #FF4000)
 *   <ChessLensWordmark variant="dark" />   — on light bg (#111111 / #FF4000)
 *   <ChessLensWordmark size={13} />        — custom font size
 */

import React from 'react';

interface ChessLensWordmarkProps {
  /** Color variant for "Chess" portion. "light"=#FFF, "dark"=#111, default=#242424 */
  variant?: 'light' | 'dark' | 'default';
  /** Font size in px. Defaults to 13. */
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

const CHESS_COLOR: Record<string, string> = {
  light: '#FFFFFF',
  dark: '#111111',
  default: '#242424',
};

const FONT_STYLE: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
  fontWeight: 700,
  whiteSpace: 'nowrap',
  letterSpacing: '-0.01em',
  lineHeight: 1,
};

export function ChessLensWordmark({
  variant = 'default',
  size = 13,
  className,
  style,
}: ChessLensWordmarkProps) {
  const chessColor = CHESS_COLOR[variant];

  return (
    <span
      className={className}
      style={{ ...FONT_STYLE, fontSize: size, display: 'inline-flex', alignItems: 'baseline', ...style }}
    >
      <span style={{ color: chessColor }}>Chess</span>
      <span style={{ color: '#FF4000' }}>Lens</span>
    </span>
  );
}

export default ChessLensWordmark;
