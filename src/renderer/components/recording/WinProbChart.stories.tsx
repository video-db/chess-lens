/**
 * WinProbChart Stories
 *
 * Visual tests for the live win-probability chart used in the Live Analysis
 * panel during an active game session.
 *
 * The chart renders a custom SVG that maps winChance (0–100, White's
 * perspective) to a 168 px tall canvas with Y-axis labels at 0/25/50/75/100
 * and a dashed red 50% baseline.
 *
 * Run with:  npm run storybook   →   http://localhost:6006
 * Navigate to:  Recording / WinProbChart
 *
 * ── Stories ──
 *  Empty State       — fewer than 2 points → "Waiting for moves…" placeholder
 *  Equal Game        — probability hovers around 50% throughout
 *  White Winning     — White builds a decisive advantage over the game
 *  Black Winning     — Black dominates from the opening
 *  Volatile Game     — large swings, tests the full 0–100 range
 *  Single Point      — edge case: exactly one data point (still shows placeholder)
 *  Long Game         — 100 points, move-number labels auto-sparse
 */

import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { WinProbChart } from './LiveAssistPanel';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Alternate turns starting from white. */
function makeTurn(i: number): 'w' | 'b' {
  return i % 2 === 0 ? 'w' : 'b';
}

/** Clamp a value to [0, 100]. */
function clamp(v: number): number {
  return Math.max(0, Math.min(100, v));
}

// ── Mock datasets ─────────────────────────────────────────────────────────────

/** Probability stays close to 50 with minor fluctuations. */
const EQUAL_GAME = Array.from({ length: 30 }, (_, i) => ({
  winChance: clamp(50 + Math.sin(i * 0.6) * 6),
  turn: makeTurn(i),
}));

/** White builds a steady advantage from move 8 onward. */
const WHITE_WINNING = Array.from({ length: 40 }, (_, i) => ({
  winChance: clamp(50 + Math.min(i * 1.1, 38) + Math.sin(i) * 3),
  turn: makeTurn(i),
}));

/** Black takes the initiative early and holds it. */
const BLACK_WINNING = Array.from({ length: 40 }, (_, i) => ({
  winChance: clamp(50 - Math.min(i * 1.0, 36) + Math.cos(i) * 3),
  turn: makeTurn(i),
}));

/** Large swings — tests that the chart correctly renders the full 0–100 range. */
const VOLATILE_GAME = [
  50, 55, 60, 72, 65, 48, 30, 18, 10, 5,
  12, 25, 40, 52, 60, 72, 85, 90, 95, 88,
  78, 65, 55, 45, 35, 25, 15, 8, 4, 2,
  10, 22, 38, 52, 66, 78, 88, 94, 98, 100,
].map((wc, i) => ({ winChance: wc, turn: makeTurn(i) }));

/** 100 data points — verifies move-number labels auto-skip cleanly. */
const LONG_GAME = Array.from({ length: 100 }, (_, i) => ({
  winChance: clamp(50 + Math.sin(i * 0.3) * 20 + (i > 60 ? (i - 60) * 0.5 : 0)),
  turn: makeTurn(i),
}));

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta: Meta<typeof WinProbChart> = {
  title: 'Recording/WinProbChart',
  component: WinProbChart,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof WinProbChart>;

// ── Stories ───────────────────────────────────────────────────────────────────

/** Fewer than 2 points: shows the "Waiting for moves…" placeholder text. */
export const EmptyState: Story = {
  name: 'Empty State',
  args: { points: [] },
  decorators: [
    (Story) => (
      <div style={{ width: 740, padding: 16, background: '#fff', borderRadius: 12, border: '1px solid #efefef' }}>
        <Story />
      </div>
    ),
  ],
};

/** Single point — still fewer than 2, still shows the placeholder. */
export const SinglePoint: Story = {
  name: 'Single Point (edge case)',
  args: { points: [{ winChance: 60, turn: 'w' }] },
  decorators: [
    (Story) => (
      <div style={{ width: 740, padding: 16, background: '#fff', borderRadius: 12, border: '1px solid #efefef' }}>
        <Story />
      </div>
    ),
  ],
};

/** Win probability stays near 50% — a closely contested game. */
export const EqualGame: Story = {
  name: 'Equal Game (~50%)',
  args: { points: EQUAL_GAME },
  decorators: [
    (Story) => (
      <div style={{ width: 740, padding: 16, background: '#fff', borderRadius: 12, border: '1px solid #efefef' }}>
        <Story />
      </div>
    ),
  ],
};

/** White builds a decisive advantage — line climbs into the 75–90% range. */
export const WhiteWinning: Story = {
  name: 'White Winning',
  args: { points: WHITE_WINNING },
  decorators: [
    (Story) => (
      <div style={{ width: 740, padding: 16, background: '#fff', borderRadius: 12, border: '1px solid #efefef' }}>
        <Story />
      </div>
    ),
  ],
};

/** Black dominates — line falls into the 10–25% range. Verifies bottom of chart is visible. */
export const BlackWinning: Story = {
  name: 'Black Winning',
  args: { points: BLACK_WINNING },
  decorators: [
    (Story) => (
      <div style={{ width: 740, padding: 16, background: '#fff', borderRadius: 12, border: '1px solid #efefef' }}>
        <Story />
      </div>
    ),
  ],
};

/**
 * Large swings hitting the full 0–100 range.
 * This story specifically validates the fix for the chart being cut off
 * at the bottom (previously the 0–25% region was clipped by overflow:hidden).
 */
export const VolatileGame: Story = {
  name: 'Volatile Game (full 0–100 range)',
  args: { points: VOLATILE_GAME },
  decorators: [
    (Story) => (
      <div style={{ width: 740, padding: 16, background: '#fff', borderRadius: 12, border: '1px solid #efefef' }}>
        <Story />
      </div>
    ),
  ],
};

/** 100 points — verifies move-number labels auto-thin without overlapping. */
export const LongGame: Story = {
  name: 'Long Game (100 moves)',
  args: { points: LONG_GAME },
  decorators: [
    (Story) => (
      <div style={{ width: 740, padding: 16, background: '#fff', borderRadius: 12, border: '1px solid #efefef' }}>
        <Story />
      </div>
    ),
  ],
};
