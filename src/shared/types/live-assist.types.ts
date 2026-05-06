/**
 * Live Assist Types
 *
 * Types for the real-time meeting assist feature that analyzes
 * transcript chunks and provides contextual suggestions.
 */

export interface LiveInsights {
  say_this: string[];
  ask_this: string[];
}

export interface LiveInsightsEvent {
  insights: LiveInsights;
  processedAt: number;
  clearExisting?: boolean;
  /** Win chance for White (0–100) AFTER the move was played. */
  winChance?: number;
  /** Win chance for White (0–100) BEFORE the move was played. */
  winChanceBefore?: number;
  /** Centipawn loss for the move that triggered this tip (always ≥ 0). */
  centipawnLoss?: number;
  /** Which side made the move that triggered this tip. */
  turn?: 'w' | 'b';
}
