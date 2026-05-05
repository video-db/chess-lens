/**
 * Chess Lens Brand Icons
 *
 * Imports the official SVG assets from renderer/assets and exposes
 * sized React components for use throughout the app.
 *
 * Variants:
 *   ChessLensIconBlack  — black bg, white body, orange dot   (sidebar, overlay)
 *   ChessLensIconOrange — orange bg, white body, white dot   (auth, onboarding)
 */

import React from 'react';
import iconBlackBg from '../../assets/icon-black-bg.svg';
import iconOrangeBg from '../../assets/icon-orange-bg.svg';

interface IconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

/** Black background, white body, orange dot — primary app icon */
export function ChessLensIconBlack({ size = 32, className, style }: IconProps) {
  return (
    <img
      src={iconBlackBg}
      width={size}
      height={size}
      alt="Chess Lens"
      className={className}
      style={{ borderRadius: size * (158.439 / 928), display: 'block', ...style }}
    />
  );
}

/** Orange background, white body, white dot — onboarding / accent screens */
export function ChessLensIconOrange({ size = 32, className, style }: IconProps) {
  return (
    <img
      src={iconOrangeBg}
      width={size}
      height={size}
      alt="Chess Lens"
      className={className}
      style={{ borderRadius: size * (158.439 / 928), display: 'block', ...style }}
    />
  );
}
