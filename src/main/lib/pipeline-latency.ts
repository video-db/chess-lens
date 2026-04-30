/**
 * Pipeline Latency Tracker
 *
 * Tracks wall-clock latency for each stage of the chess coaching pipeline
 * and logs a structured summary when a full cycle completes (or is abandoned).
 *
 * Pipeline stages (in order):
 *   1. screenshot   — desktopCapturer.getSources() + toPNG() encode
 *   2. fenExtract   — gpt-5.4 vision call (vote read 1, in a prior cycle)
 *   3. fenExtract   — gpt-5.4 vision call (vote read 2, confirming cycle)
 *   4. voteConfirm  — majority-vote buffer produces a confirmed FEN
 *   5. engineCall   — chess-api.com depth-12 analysis
 *   6. engineTip    — format + emit engine-only overlay tip
 *   7. coachingLLM  — VideoDB `pro` model coaching call (background)
 *   8. coachingTip  — parse + emit final coaching tip
 *
 * ─── Phase model ─────────────────────────────────────────────────────────────
 *
 *   fenStabilizationMs  = fenExtract1 + screenshot2 + fenExtract2 + voteConfirm
 *   engineAnalysisMs    = engineCall  + engineTip
 *   tipGenerationMs     = coachingLLM + coachingTip
 *   e2eMs               = fenStabilizationMs + engineAnalysisMs + tipGenerationMs
 *
 * Phases are only emitted on terminal cycles that ran past the vote window
 * (reason = 'coachingTip' / 'coachingStale' / 'coachingNullResponse' etc.).
 * Intermediate cycles (voteInconclusive, fenUnchanged, frameUnchanged) keep
 * the flat `steps` format.
 *
 * ─── Usage ───────────────────────────────────────────────────────────────────
 *
 * Each pipeline cycle is identified by a monotonically-increasing `cycleId`.
 * Services call:
 *   tracker.startStep(cycleId, 'screenshot')
 *   tracker.endStep(cycleId, 'screenshot')
 *
 * After vote read 1 completes and the FEN enters the buffer, call:
 *   tracker.setVoteMeta(cycleId, { seenAt, fenExtract1Ms })
 * on the *confirming* cycle (passed in via injectConfirmedFen).
 *
 * When all expected steps in a cycle have ended (or when endCycle() is called
 * explicitly), a summary log line is emitted at INFO level.
 */

import { logger } from './logger';

const log = logger.child({ module: 'pipeline-latency' });

export type PipelineStep =
  | 'screenshot'    // Stage 1: desktopCapturer capture + PNG encode (vote read 2 cycle)
  | 'fenExtract'    // Stage 2: gpt-5.4 vision LLM call (vote read 2)
  | 'voteConfirm'   // Stage 3: majority-vote confirmation
  | 'engineCall'    // Stage 4/5a: chess-api.com engine analysis
  | 'engineTip'     // Stage 5a: format + emit engine-only tip
  | 'coachingLLM'   // Stage 5b/6: VideoDB `pro` coaching call (background)
  | 'coachingTip';  // Stage 7: parse + emit final coaching tip

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
 * fenStabilization phase can be computed from both reads together.
 */
export interface VoteMeta {
  /** Date.now() when the FEN was first extracted (start of vote read 1). */
  seenAt: number;
  /** Wall-clock duration of the vote read 1 fenExtract LLM call, in ms. */
  fenExtract1Ms: number;
}

interface CycleRecord {
  cycleId: number;
  createdAt: number;
  steps: Partial<Record<PipelineStep, StepTiming>>;
  /** Metadata from vote read 1 — set by setVoteMeta() after injectConfirmedFen. */
  voteMeta?: VoteMeta;
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
    if (!s) return; // endStep called without startStep — ignore
    const endAt = Date.now();
    s.endAt = endAt;
    s.elapsedMs = endAt - s.startAt;
    if (error) s.error = error;
  }

  /**
   * Attach vote-read-1 metadata to the confirming cycle.
   * Call this from live-assist after injectConfirmedFen stores the cycleId.
   *
   * @param cycleId  The confirming cycle (vote read 2).
   * @param meta     seenAt + fenExtract1Ms from the vote-read-1 cycle.
   */
  setVoteMeta(cycleId: number, meta: VoteMeta): void {
    const cycle = this.cycles.get(cycleId);
    if (!cycle) return;
    cycle.voteMeta = meta;
  }

  /**
   * Explicitly close a cycle and emit the latency summary.
   *
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

    // ── Phase computation (only when vote meta is available) ────────────────
    let phases: Record<string, number> | undefined;
    let e2eMs: number | undefined;

    if (vm !== undefined && lastEnd !== undefined) {
      // fenStabilization: from first extraction start to vote confirmed
      //   = fenExtract1 duration
      //   + gap between read-1 end and read-2 screenshot start (scheduler delay)
      //   + screenshot2 + fenExtract2 + voteConfirm of this cycle
      const screenshot2Ms  = (cycle.steps.screenshot?.elapsedMs  ?? 0);
      const fenExtract2Ms  = (cycle.steps.fenExtract?.elapsedMs  ?? 0);
      const voteConfirmMs  = (cycle.steps.voteConfirm?.elapsedMs ?? 0);

      // Wall-clock time from first extraction start to vote confirmed end.
      const voteConfirmEnd = cycle.steps.voteConfirm?.endAt ?? cycle.steps.fenExtract?.endAt;
      const fenStabilizationMs = voteConfirmEnd !== undefined
        ? voteConfirmEnd - vm.seenAt
        : vm.fenExtract1Ms + screenshot2Ms + fenExtract2Ms + voteConfirmMs;

      // engineAnalysis: engineCall + engineTip
      const engineAnalysisMs = PHASE_STEPS.engine.reduce(
        (sum, step) => sum + (cycle.steps[step]?.elapsedMs ?? 0), 0
      );

      // tipGeneration: coachingLLM + coachingTip
      const tipGenerationMs = PHASE_STEPS.tip.reduce(
        (sum, step) => sum + (cycle.steps[step]?.elapsedMs ?? 0), 0
      );

      e2eMs = lastEnd - vm.seenAt;

      // Only include phases that actually ran (non-zero)
      phases = {};
      phases.fenStabilizationMs = fenStabilizationMs;
      if (engineAnalysisMs > 0) phases.engineAnalysisMs = engineAnalysisMs;
      if (tipGenerationMs  > 0) phases.tipGenerationMs  = tipGenerationMs;

      // Expose read-1 and read-2 fenExtract durations explicitly in steps
      stepLatencies['fenExtract1'] = vm.fenExtract1Ms;
      stepLatencies['fenExtract2'] = fenExtract2Ms;
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
        ...(e2eMs   !== undefined ? { e2eMs }   : {}),
        ...(totalMs !== undefined ? { totalMs }  : {}),
        ...(phases  !== undefined ? { phases }   : {}),
        steps: stepLatencies,
      },
      '[PipelineLatency] Cycle summary'
    );
  }
}

// Module-level singleton — imported directly by services.
export const pipelineLatency = new PipelineLatencyTracker();
