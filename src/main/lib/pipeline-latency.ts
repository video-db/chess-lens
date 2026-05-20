/**
 * Pipeline Latency Tracker
 *
 * Tracks wall-clock latency for each stage of the chess coaching pipeline
 * and logs a structured summary only when a full coaching cycle completes.
 *
 * ─── Pipeline paths ──────────────────────────────────────────────────────────
 *
 *  FAST PATH (high-confidence single read):
 *   screenshot → fenExtract → voteConfirm(≈0ms) → engineCall → engineTip
 *                                                             → coachingLLM → coachingTip
 *
 *   fenStabilizationMs  = fenExtract (single read, wall-clock from seenAt to voteConfirm end)
 *
 *  SLOW PATH (majority-vote two reads):
 *   [cycle N]  screenshot → fenExtract (read 1) → voteInconclusive
 *   [cycle N+1] screenshot → fenExtract (read 2) → voteConfirm → engineCall → engineTip
 *                                                              → coachingLLM → coachingTip
 *
 *   fenStabilizationMs  = fenExtract1 + scheduler gap + screenshot2 + fenExtract2 + voteConfirm
 *
 * ─── Promotion metadata ──────────────────────────────────────────────────────
 *
 *  promotionPath   — 'fast' (single-read fast-path) | 'slow' (majority-vote)
 *  fenRetried      — true when the FEN vision call needed a math-error recount
 *  turnTimedOut    — true when the turn vision call timed out or returned null
 *
 * ─── Usage ───────────────────────────────────────────────────────────────────
 *
 * Each pipeline cycle is identified by a monotonically-increasing `cycleId`.
 * Services call:
 *   tracker.startStep(cycleId, 'screenshot')
 *   tracker.endStep(cycleId, 'screenshot')
 *
 * After FEN promotion call:
 *   tracker.setVoteMeta(cycleId, { seenAt, fenExtract1Ms })
 *   tracker.setPromotionMeta(cycleId, { promotionPath, fenRetried, turnTimedOut })
 *
 * When the coaching tip is emitted:
 *   tracker.endCycle(cycleId, 'coachingTip')
 */

import { logger } from './logger';

const log = logger.child({ module: 'pipeline-latency' });

export type PipelineStep =
  | 'screenshot'    // desktopCapturer capture + PNG encode
  | 'fenExtract'    // gpt-5.4 vision LLM call (current cycle's read)
  | 'voteConfirm'   // majority-vote confirmation (≈0ms on fast path)
  | 'engineCall'    // chess-api.com engine analysis
  | 'engineTip'     // format + emit engine-only tip
  | 'coachingLLM'   // coaching LLM call (background)
  | 'coachingTip';  // parse + emit final coaching tip

/** Ordered list used to compute step latencies in the summary. */
const STEP_ORDER: PipelineStep[] = [
  'screenshot',
  'fenExtract',
  'voteConfirm',
  'engineCall',
  'engineTip',
  'coachingLLM',
  'coachingTip',
];

/** Steps that belong to each named phase (for phase computation). */
const PHASE_STEPS = {
  engine: ['engineCall', 'engineTip'] as PipelineStep[],
  tip:    ['coachingLLM', 'coachingTip'] as PipelineStep[],
};

interface StepTiming {
  startAt: number;
  endAt?: number;
  elapsedMs?: number;
  error?: string;
}

/**
 * Metadata about vote read 1 — stored on the confirming cycle so the
 * fenStabilization phase can be computed correctly for both paths.
 *
 * Fast path:  seenAt = start of the single read, fenExtract1Ms = that read's duration.
 * Slow path:  seenAt = start of read 1 in a prior cycle, fenExtract1Ms = that read's duration.
 */
export interface VoteMeta {
  /** Date.now() when the FEN was first extracted (start of vote read 1 or fast-path read). */
  seenAt: number;
  /** Wall-clock duration of the FEN extraction LLM call, in ms. */
  fenExtract1Ms: number;
}

/**
 * Metadata about how the FEN was promoted into live-assist.
 */
export interface PromotionMeta {
  /** 'fast' = single-read fast-path promotion; 'slow' = majority-vote two-read path. */
  promotionPath: 'fast' | 'slow';
  /** True when the FEN call needed a math-error recount retry (attempt > 0). */
  fenRetried: boolean;
  /** True when the turn call timed out or returned null. */
  turnTimedOut: boolean;
}

interface CycleRecord {
  cycleId: number;
  createdAt: number;
  steps: Partial<Record<PipelineStep, StepTiming>>;
  /** Metadata from the FEN extraction — set by setVoteMeta(). */
  voteMeta?: VoteMeta;
  /** Metadata about how the FEN was promoted — set by setPromotionMeta(). */
  promotionMeta?: PromotionMeta;
  /** True once the summary has been logged (avoid double-logging). */
  logged: boolean;
  /** The reason string from the first endCycle call that closed this cycle. */
  loggedReason?: string;
}

class PipelineLatencyTracker {
  private cycles = new Map<number, CycleRecord>();
  private nextCycleId = 1;

  /** Create a new cycle and return its ID. Call once per screenshot tick. */
  newCycle(): number {
    const id = this.nextCycleId++;
    this.cycles.set(id, {
      cycleId: id,
      createdAt: Date.now(),
      steps: {},
      logged: false,
    });
    // Evict old cycles, but never evict an unlogged cycle — it may still be
    // waiting for a background coachingLLM call to complete and log its summary.
    if (this.cycles.size > 40) {
      for (const [key, cycle] of this.cycles) {
        if (cycle.logged) {
          this.cycles.delete(key);
          break;
        }
      }
    }
    return id;
  }

  /** Mark the start of a pipeline step for the given cycle. */
  startStep(cycleId: number, step: PipelineStep): void {
    const cycle = this.cycles.get(cycleId);
    if (!cycle) return;
    cycle.steps[step] = { startAt: Date.now() };
  }

  /**
   * Mark the end of a pipeline step.
   * @param error  Optional error message when the step failed/timed out.
   */
  endStep(cycleId: number, step: PipelineStep, error?: string): void {
    const cycle = this.cycles.get(cycleId);
    if (!cycle) return;
    const s = cycle.steps[step];
    if (!s) return;
    const endAt = Date.now();
    s.endAt = endAt;
    s.elapsedMs = endAt - s.startAt;
    if (error) s.error = error;
  }

  /**
   * Attach FEN extraction metadata to the cycle.
   * Call from chess-screenshot.service after FEN is promoted into live-assist.
   */
  setVoteMeta(cycleId: number, meta: VoteMeta): void {
    const cycle = this.cycles.get(cycleId);
    if (!cycle) return;
    cycle.voteMeta = meta;
  }

  /**
   * Attach promotion-path metadata to the cycle.
   * Call from chess-screenshot.service when a FEN is promoted (fast or slow path).
   */
  setPromotionMeta(cycleId: number, meta: PromotionMeta): void {
    const cycle = this.cycles.get(cycleId);
    if (!cycle) return;
    cycle.promotionMeta = meta;
  }

  /**
   * Explicitly close a cycle and emit the latency summary.
   * @param reason  Short human-readable label (e.g. 'coachingTip', 'fenNull').
   */
  endCycle(cycleId: number, reason: string): void {
    const cycle = this.cycles.get(cycleId);
    if (!cycle) {
      log.debug({ cycleId, reason }, '[PipelineLatency] endCycle: cycleId not found (evicted or never created)');
      return;
    }
    if (cycle.logged) {
      log.debug({ cycleId, reason, firstReason: cycle.loggedReason }, '[PipelineLatency] endCycle: already logged, skipping');
      return;
    }
    cycle.logged = true;
    cycle.loggedReason = reason;
    if (reason !== 'coachingTip') return;
    this._logSummary(cycle, reason);
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private _logSummary(cycle: CycleRecord, reason: string): void {
    const stepLatencies: Partial<Record<string, number | string>> = {};
    let lastEnd: number | undefined;

    for (const step of STEP_ORDER) {
      const s = cycle.steps[step];
      if (!s) continue;
      if (s.endAt !== undefined && (lastEnd === undefined || s.endAt > lastEnd)) {
        lastEnd = s.endAt;
      }
      stepLatencies[step] = s.error
        ? `${s.elapsedMs ?? '?'}ms [ERR: ${s.error}]`
        : s.elapsedMs !== undefined ? s.elapsedMs : 'incomplete';
    }

    const vm = cycle.voteMeta;
    const pm = cycle.promotionMeta;

    // ── Phase computation (only when vote meta is available) ────────────────
    let phases: Record<string, number> | undefined;
    let e2eMs: number | undefined;

    if (vm !== undefined && lastEnd !== undefined) {
      const screenshot2Ms = (cycle.steps.screenshot?.elapsedMs ?? 0);
      const fenExtract2Ms = (cycle.steps.fenExtract?.elapsedMs  ?? 0);
      const voteConfirmMs = (cycle.steps.voteConfirm?.elapsedMs ?? 0);

      // fenStabilization:
      //   fast path: wall-clock from seenAt (start of the single read) to voteConfirm end
      //   slow path: wall-clock from read-1 seenAt to vote-confirmed end
      // Both paths store seenAt correctly so the formula is the same.
      const voteConfirmEnd = cycle.steps.voteConfirm?.endAt ?? cycle.steps.fenExtract?.endAt;
      const fenStabilizationMs = voteConfirmEnd !== undefined
        ? voteConfirmEnd - vm.seenAt
        : vm.fenExtract1Ms + screenshot2Ms + fenExtract2Ms + voteConfirmMs;

      const engineAnalysisMs = PHASE_STEPS.engine.reduce(
        (sum, step) => sum + (cycle.steps[step]?.elapsedMs ?? 0), 0
      );

      const tipGenerationMs = PHASE_STEPS.tip.reduce(
        (sum, step) => sum + (cycle.steps[step]?.elapsedMs ?? 0), 0
      );

      e2eMs = lastEnd - vm.seenAt;

      phases = {};
      phases.fenStabilizationMs = fenStabilizationMs;
      if (engineAnalysisMs > 0) phases.engineAnalysisMs = engineAnalysisMs;
      if (tipGenerationMs  > 0) phases.tipGenerationMs  = tipGenerationMs;

      // On slow path: expose both reads separately for easy comparison.
      // On fast path: expose only fenExtract1 (the single read); fenExtract2 = 0.
      if (pm?.promotionPath === 'fast') {
        stepLatencies['fenExtract1'] = vm.fenExtract1Ms;
        stepLatencies['fenExtract2'] = 0; // fast path — second read skipped
      } else {
        stepLatencies['fenExtract1'] = vm.fenExtract1Ms;
        stepLatencies['fenExtract2'] = fenExtract2Ms;
      }
      delete stepLatencies['fenExtract']; // replaced by the two named entries
    }

    // totalMs: span of this single cycle only (no cross-cycle context)
    const cycleFirstStart = STEP_ORDER.map(s => cycle.steps[s]?.startAt)
      .filter((t): t is number => t !== undefined)
      .reduce((min, t) => Math.min(min, t), Infinity);
    const totalMs = isFinite(cycleFirstStart) && lastEnd !== undefined
      ? lastEnd - cycleFirstStart
      : undefined;

    log.info(
      {
        cycleId: cycle.cycleId,
        reason,
        ...(e2eMs     !== undefined ? { e2eMs }     : {}),
        ...(totalMs   !== undefined ? { totalMs }    : {}),
        ...(phases    !== undefined ? { phases }     : {}),
        // Promotion metadata — always included when available
        promotionPath:  pm?.promotionPath  ?? 'unknown',
        fenRetried:     pm?.fenRetried     ?? false,
        turnTimedOut:   pm?.turnTimedOut   ?? false,
        steps: stepLatencies,
      },
      '[PipelineLatency] Cycle summary'
    );
  }
}

// Module-level singleton — imported directly by services.
export const pipelineLatency = new PipelineLatencyTracker();
