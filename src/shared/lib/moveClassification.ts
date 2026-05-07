/**
 * Move Classification — WP-based decision tree.
 *
 * Implements the chess.com-style CAPS2 classification system using Win
 * Probability (WP) rather than raw centipawn loss.
 *
 * Key insight: a 300-cp drop from +10 to +7 is still a winning position
 * (WP ~0%), but a 100-cp drop from +0.5 to -0.5 flips the game (~30% WP loss).
 * Raw CPL is a poor classifier in unequal or dead-won positions.
 *
 * This module is shared between the main process (accuracy computation) and
 * the renderer (Key Moments card classification).
 */

// ── Win Probability conversion ────────────────────────────────────────────────

/**
 * Convert a centipawn evaluation (in pawn units, e.g. 1.5 = 150cp) to a
 * Win Probability for the side whose evaluation is given.
 *
 * Uses the Lichess/research-standard sigmoid:
 *   P = 1 / (1 + 10^(-E/4))
 *
 * where E is in pawns (eval / 100 if you have centipawns).
 *
 * Returns a value in [0, 1].
 */
export function evalToWinProb(evalPawns: number): number {
  return 1 / (1 + Math.pow(10, -evalPawns / 4));
}

/**
 * Convert a chess-api.com winChance (0–100, always White's perspective) to a
 * normalised [0, 1] Win Probability for White.
 */
export function winChanceToWP(winChance: number): number {
  return winChance / 100;
}

// ── Move quality types ────────────────────────────────────────────────────────

export type MoveQuality =
  | 'brilliant'   // Best move + material sacrifice
  | 'great'       // Only winning/drawing move (large WP gap to second-best)
  | 'best'        // Engine's #1 move
  | 'excellent'   // WP loss < 2%
  | 'good'        // WP loss < 5%
  | 'inaccuracy'  // WP loss 5–15%
  | 'mistake'     // WP loss 15–30%
  | 'blunder'     // WP loss > 30%
  | 'book';       // Opening theory (not classified by engine)

/** Visual config for each quality category. */
export const MOVE_BADGE: Record<MoveQuality, {
  bg: string;
  color: string;
  label: string;
  symbol?: string;  // chess annotation symbol
}> = {
  brilliant:  { bg: '#E3F0FF', color: '#1565C0', label: 'Brilliant',  symbol: '!!'  },
  great:      { bg: '#E8F5FF', color: '#0277BD', label: 'Great',      symbol: '!'   },
  best:       { bg: '#DFFBE0', color: '#009106', label: 'Best',       symbol: '⊕'  },
  excellent:  { bg: '#E8F5E8', color: '#2E7D32', label: 'Excellent'                 },
  good:       { bg: '#EDF7FF', color: '#1565C0', label: 'Good'                      },
  inaccuracy: { bg: '#FFE9D3', color: '#EC5B16', label: 'Inaccuracy', symbol: '?'   },
  mistake:    { bg: '#FEF9C3', color: '#B45309', label: 'Mistake',    symbol: '?'   },
  blunder:    { bg: '#FEE2E2', color: '#DC2626', label: 'Blunder',    symbol: '??'  },
  book:       { bg: '#F3E5F5', color: '#6A1B9A', label: 'Book'                      },
};

/** These qualities are significant enough to appear in Key Moments. */
export const KEY_MOMENT_QUALITIES: ReadonlySet<MoveQuality> = new Set<MoveQuality>([
  'brilliant', 'great', 'best', 'inaccuracy', 'mistake', 'blunder',
]);

// ── Classification inputs ─────────────────────────────────────────────────────

export interface ClassifyMoveInput {
  /** Win probability for White BEFORE the move was played (0–1). */
  wpBefore: number;
  /** Win probability for White AFTER the move was played (0–1). */
  wpAfter: number;
  /** Who just made this move. */
  turn: 'w' | 'b';
  /**
   * Win probability of the engine's #1 move from this position (0–1).
   * When available, used to determine if played move == best move.
   * chess-api.com does not provide this directly, so we approximate:
   * if wpAfter ≈ wpBest the move is considered best.
   */
  wpBest?: number;
  /**
   * Win probability of the engine's second-best move (0–1).
   * Used for "Great / Only Move" detection.
   * We don't have this from chess-api.com — set to undefined to skip the check.
   */
  wpSecondBest?: number;
  /**
   * Whether the player sacrificed material (piece value dropped without
   * immediate recapture visible in the engine line).
   * Used for Brilliant detection. Set to undefined when unknown.
   */
  isSacrifice?: boolean;
  /**
   * Engine eval of the position (in pawns) for the best move.
   * Used for the "winning buffer" suppression rule:
   * if eval > WINNING_THRESHOLD we don't call minor errors "Mistake".
   */
  evalBest?: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** WP loss thresholds (fraction, i.e. 0.05 = 5%) */
const WP_EXCELLENT  = 0.02;
const WP_GOOD       = 0.05;
const WP_INACCURACY = 0.15;
const WP_MISTAKE    = 0.30;

/** If the best-move eval is above this (pawns), suppress Mistake/Inaccuracy labels.
 *  3.0 pawns (~85% WP) is a clearly winning position without being trivially won.
 *  The previous value of 5.0 was too aggressive — it suppressed real mistakes in
 *  positions that were winning but far from over. */
const WINNING_BUFFER_EVAL = 3.0;

/** WP gap between best and second-best to qualify as "Only Move / Great". */
const GREAT_MOVE_WP_GAP = 0.20;

/** Tolerance for "played move ≈ best move" when wpBest is known. */
const BEST_MOVE_WP_TOLERANCE = 0.03;

// ── Main classifier ───────────────────────────────────────────────────────────

/**
 * Classify a chess move using the WP-based decision tree.
 *
 * The WP loss is always computed from the *mover's* perspective:
 *   White just moved → moverWPBefore = wpBefore,  moverWPAfter = wpAfter
 *   Black just moved → moverWPBefore = 1-wpBefore, moverWPAfter = 1-wpAfter
 */
export function classifyMove(input: ClassifyMoveInput): MoveQuality {
  const { wpBefore, wpAfter, turn, wpBest, wpSecondBest, isSacrifice, evalBest } = input;

  // Convert to mover's perspective (mover wants high WP)
  const moverWPBefore = turn === 'w' ? wpBefore : (1 - wpBefore);
  const moverWPAfter  = turn === 'w' ? wpAfter  : (1 - wpAfter);
  const moverWPBest   = wpBest !== undefined
    ? (turn === 'w' ? wpBest : 1 - wpBest)
    : undefined;

  const wpLoss = Math.max(0, moverWPBefore - moverWPAfter);

  // ── Winning buffer suppression ────────────────────────────────────────────
  // If the engine says the position is clearly winning (eval > threshold),
  // suppress Inaccuracy/Mistake unless the move throws away the win entirely.
  const isWinning = evalBest !== undefined && Math.abs(evalBest) > WINNING_BUFFER_EVAL;
  const throwsAwayWin =
    (turn === 'w' && wpBefore > 0.85 && wpAfter < 0.70) ||
    (turn === 'b' && (1 - wpBefore) > 0.85 && (1 - wpAfter) < 0.70);

  // ── Determine if played move == engine's best ─────────────────────────────
  const isEngineBest = moverWPBest !== undefined
    ? (moverWPBest - moverWPAfter) <= BEST_MOVE_WP_TOLERANCE
    : wpLoss < WP_EXCELLENT; // approximate: if near-zero loss, likely best

  // ── Decision tree ─────────────────────────────────────────────────────────

  // Brilliant: best move AND involved a material sacrifice
  if (isEngineBest && isSacrifice === true) {
    return 'brilliant';
  }

  // Great: best move AND it was the only good continuation (large WP gap to #2)
  if (isEngineBest && wpSecondBest !== undefined) {
    const moverWPSecond = turn === 'w' ? wpSecondBest : (1 - wpSecondBest);
    if (moverWPBest !== undefined && (moverWPBest - moverWPSecond) > GREAT_MOVE_WP_GAP) {
      return 'great';
    }
  }

  // Best: engine's #1 move
  if (isEngineBest) {
    return 'best';
  }

  // Apply winning buffer — in a clearly winning position, minor slips aren't "Mistake"
  if (isWinning && !throwsAwayWin) {
    if (wpLoss < WP_INACCURACY) return 'excellent';
    if (wpLoss < WP_MISTAKE)    return 'inaccuracy'; // demote mistake → inaccuracy
  }

  // Standard WP-loss thresholds
  if (wpLoss < WP_EXCELLENT)  return 'excellent';
  if (wpLoss < WP_GOOD)       return 'good';
  if (wpLoss < WP_INACCURACY) return 'inaccuracy';
  if (wpLoss < WP_MISTAKE)    return 'mistake';
  return 'blunder';
}

// ── Convenience: classify from raw stored data ────────────────────────────────

export interface StoredMoveData {
  /** winChance (0–100, White's perspective) BEFORE move. */
  winChanceBefore?: number;
  /** winChance (0–100, White's perspective) AFTER move. */
  winChance?: number;
  /** Side that just played. */
  turn?: 'w' | 'b';
  /** Centipawn loss (fallback when WP data unavailable). */
  centipawnLoss?: number;
  /** Engine eval of the current position (pawns) — for winning buffer. */
  engineEval?: number;
}

/**
 * Classify a move from the data stored in CoachingTip / GameplayTip.
 * Uses WP-based classification when possible, falls back to CPL-based.
 */
export function classifyStoredMove(data: StoredMoveData): MoveQuality {
  const { winChanceBefore, winChance, turn, centipawnLoss, engineEval } = data;

  if (winChanceBefore !== undefined && winChance !== undefined && turn) {
    return classifyMove({
      wpBefore: winChanceBefore / 100,
      wpAfter:  winChance / 100,
      turn,
      evalBest: engineEval,
      // wpBest / wpSecondBest / isSacrifice: not available from chess-api.com
      // — leave undefined so the tree falls through to WP-loss thresholds
    });
  }

  // CPL fallback for older recordings
  if (centipawnLoss !== undefined) {
    // Convert CPL → approximate WP loss using Lichess curve.
    // Baseline: assume position was roughly equal (eval ≈ 0) for the sigmoid.
    // This is a conservative estimate but better than raw CPL buckets.
    const evalBefore = 0; // assume near-equal position (conservative)
    const evalAfter  = -(centipawnLoss / 100); // loss for the mover
    const wpBefore = evalToWinProb(evalBefore);
    const wpAfter  = evalToWinProb(evalAfter);
    const wpLoss   = Math.max(0, wpBefore - wpAfter);
    if (wpLoss < WP_EXCELLENT)  return 'excellent';
    if (wpLoss < WP_GOOD)       return 'good';
    if (wpLoss < WP_INACCURACY) return 'inaccuracy';
    if (wpLoss < WP_MISTAKE)    return 'mistake';
    return 'blunder';
  }

  return 'good'; // no data
}

// ── CAPS2-style accuracy computation ─────────────────────────────────────────

/**
 * Compute CAPS2-style accuracy for a set of moves.
 *
 * Uses WP-weighted scoring with a non-linear polynomial curve:
 *   moveScore = 100 × (wpPlayed / wpBest)^k
 *
 * where k=2 makes the scoring "rewarding" at the top (85%+ feels like
 * a solid game) while correctly punishing blunders.
 *
 * After averaging move scores, the school-grade CAPS2 sigmoid is applied:
 *   accuracy = 103.1668 × exp(−0.04354 × (100 − avgScore)) − 3.1669
 */
export function computeAccuracy(moves: StoredMoveData[]): number | null {
  const validMoves = moves.filter(
    (m) => (m.winChanceBefore !== undefined && m.winChance !== undefined) ||
            m.centipawnLoss !== undefined
  );
  if (validMoves.length === 0) return null;

  const scores = validMoves.map((m) => {
    if (m.winChanceBefore !== undefined && m.winChance !== undefined && m.turn) {
      const moverWPBefore = m.turn === 'w' ? m.winChanceBefore / 100 : 1 - m.winChanceBefore / 100;
      const moverWPAfter  = m.turn === 'w' ? m.winChance / 100       : 1 - m.winChance / 100;

      // Clamp to avoid division by zero or negative scores
      const wpBefore = Math.max(0.001, moverWPBefore);
      const wpAfter  = Math.max(0, moverWPAfter);

      // Winning buffer: if already clearly winning, this move can't score below 80
      const isWinning = m.engineEval !== undefined && Math.abs(m.engineEval) > WINNING_BUFFER_EVAL;
      const rawScore  = Math.min(1, wpAfter / wpBefore);

      // k=2 polynomial curve: near-best plays score high, blunders score low
      const curvedScore = Math.pow(rawScore, 2) * 100;
      return isWinning ? Math.max(80, curvedScore) : curvedScore;
    }

    // CPL fallback
    const cpl = m.centipawnLoss ?? 0;
    if (cpl < 10)  return 100;
    if (cpl < 20)  return  95;
    if (cpl < 50)  return  85;
    if (cpl < 100) return  65;
    if (cpl < 200) return  30;
    return 0;
  });

  const avgScore = scores.reduce((s, v) => s + v, 0) / scores.length;

  // CAPS2 school-grade sigmoid
  const avgLoss = 100 - avgScore;
  const raw = 103.1668 * Math.exp(-0.04354 * avgLoss) - 3.1669;
  return Math.round(Math.max(0, Math.min(100, raw)) * 10) / 10;
}
