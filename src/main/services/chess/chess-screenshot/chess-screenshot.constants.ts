/** Interval in milliseconds between regular screenshot captures. */
export const SCREENSHOT_INTERVAL_MS = 500;

/**
 * After a voted FEN changes, fire rapid follow-up captures to fill the vote
 * window quickly while the move highlight is still visible.
 */
export const BURST_COUNT = 4;
export const BURST_INTERVAL_MS = 100;

/**
 * Maximum number of concurrent model calls allowed.
 * A new screenshot can start extraction while an earlier call is in flight;
 * the first promotable FEN wins and stale results are discarded downstream.
 */
export const MAX_CONCURRENT_EXTRACTIONS = 2;

/**
 * Majority-vote parameters.
 * N=3, M=2: 2 of the last 3 readings must agree, tolerating one bad frame.
 */
export const FEN_VOTE_WINDOW = 3;
export const FEN_VOTE_THRESHOLD = 2;

/** Temporal consistency gate. */
export const MAX_SQUARE_DELTA = 6;
export const TEMPORAL_REJECT_LIMIT = 5;
export const STABLE_JUMP_ACCEPT_LIMIT = 2;

/** Flush the vote buffer after repeated cycles without consensus. */
export const MAX_STALE_VOTE_CYCLES = 6;

/** Hard ceiling on a single capture tick so an in-flight slot is always released. */
export const CAPTURE_TICK_TIMEOUT_MS = 15000;
