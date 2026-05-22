/**
 * Live Assist Store
 *
 * Manages the state for real-time meeting insights generated
 * from transcript analysis every 20 seconds.
 */

import { create } from 'zustand';
import type { LiveInsights } from '../../shared/types/live-assist.types';

export interface MoveEntry {
  no: number;
  white?: string;
  black?: string;
}

export interface WinProbabilityPoint {
  /** White's win probability (0–100) after this move */
  winChance: number;
  /** Side that just moved */
  turn: 'w' | 'b';
  /** Position of this point in the canonical move sequence (0-based) */
  moveIndex: number;
  /** SAN of the move that produced this position (e.g. "Bc4") */
  moveSan?: string;
}

export interface CoachingTipEntry {
  /** The coaching text */
  text: string;
  /** SAN of the move that triggered this tip (e.g. "Bc4") */
  moveSan?: string;
  /** Sequential move number (1, 2, 3…) assigned at time of receipt */
  moveNo: number;
}

interface LiveAssistState {
  sayThis: string[];
  askThis: string[];
  /** Structured coaching tips with move context for the live panel */
  coachingTips: CoachingTipEntry[];
  /** Move history table: canonical snapshot from the main process */
  moveHistory: MoveEntry[];
  isProcessing: boolean;
  lastProcessedAt: number | null;
  error: string | null;
  /** Win probability history — canonical snapshot from the main process.
   *  Replaced wholesale on every fen event, mirroring the same self-healing
   *  mechanism used by moveHistory. */
  winProbabilityHistory: WinProbabilityPoint[];

  // Actions
  addInsights: (insights: LiveInsights, moveSan?: string) => void;
  /**
   * Replace the entire move history with the canonical snapshot emitted by the
   * main process on every confirmed FEN.  Using a full replace (not append)
   * means hallucinated branches are automatically pruned the moment the board
   * reverts — no stale rows can persist in the renderer.
   */
  setMoveHistory: (snapshot: MoveEntry[]) => void;
  /**
   * Replace the entire win-probability history with the canonical snapshot
   * emitted by the main process on every fen event.  Same self-healing
   * mechanism as setMoveHistory — any hallucinated chart points are wiped
   * the moment the canonical history reverts or replaces them.
   */
  setWinProbabilityHistory: (snapshot: WinProbabilityPoint[]) => void;
  setProcessing: (isProcessing: boolean) => void;
  setError: (error: string | null) => void;
  clearTips: () => void;
  clear: () => void;
}

export const useLiveAssistStore = create<LiveAssistState>((set) => ({
  sayThis: [],
  askThis: [],
  coachingTips: [],
  moveHistory: [],
  isProcessing: false,
  lastProcessedAt: null,
  error: null,
  winProbabilityHistory: [],

  addInsights: (insights, moveSan) => set((state) => {
    // Filter out engine-only text (stage-1 emits have say_this starting with "engine:")
    const isEngineText = (s: string) => s.toLowerCase().startsWith('engine:');

    const existingSayThis = new Set(state.sayThis.map(s => s.toLowerCase()));
    const existingAskThis = new Set(state.askThis.map(s => s.toLowerCase()));

    const newSayThis = insights.say_this.filter(
      item => !isEngineText(item) && !existingSayThis.has(item.toLowerCase())
    );
    const newAskThis = insights.ask_this.filter(
      item => !isEngineText(item) && !existingAskThis.has(item.toLowerCase())
    );

    // Append new items to the end (max 15 per category)
    const combinedSayThis = [...state.sayThis, ...newSayThis].slice(-15);
    const combinedAskThis = [...state.askThis, ...newAskThis].slice(-15);

    // Build structured coaching tip entries with move context.
    // Use the current move history length as the move number — moveHistory is updated
    // by fen events which fire before coaching tips arrive, so this reflects the real game clock.
    const newCoachingTips = [...state.coachingTips];
    const currentMoveNo = state.moveHistory.length > 0 ? state.moveHistory.length : newCoachingTips.length + 1;
    const existingTipTexts = new Set(state.coachingTips.map(t => t.text.toLowerCase()));
    for (const text of newSayThis) {
      if (!existingTipTexts.has(text.toLowerCase())) {
        newCoachingTips.push({
          text,
          moveSan,
          moveNo: currentMoveNo,
        });
      }
    }
    const trimmedTips = newCoachingTips.slice(-15);

    // NOTE: winProbabilityHistory is NOT updated here.  It is owned exclusively
    // by the main process and delivered as a canonical snapshot via the 'fen'
    // event → setWinProbabilityHistory().  This mirrors how moveHistory works
    // and ensures the chart self-heals when the canonical history reverts.

    // NOTE: move history is NOT updated here.  It is owned exclusively by the
    // main process and delivered as a canonical snapshot via the 'fen' event →
    // setMoveHistory().  Updating it here too would create a second source of
    // truth and cause the row-misalignment bug where late-arriving insights
    // re-add moves that are already in the snapshot.

    return {
      sayThis: combinedSayThis,
      askThis: combinedAskThis,
      coachingTips: trimmedTips,
      lastProcessedAt: Date.now(),
      error: null,
    };
  }),

  setMoveHistory: (snapshot) => set({ moveHistory: snapshot }),

  setWinProbabilityHistory: (snapshot) => set({ winProbabilityHistory: snapshot }),

  setProcessing: (isProcessing) => set({ isProcessing }),

  setError: (error) => set({ error, isProcessing: false }),

  clearTips: () => set({
    sayThis: [],
    askThis: [],
    coachingTips: [],
    // winProbabilityHistory and moveHistory preserved intentionally
  }),

  clear: () => set({
    sayThis: [],
    askThis: [],
    coachingTips: [],
    moveHistory: [],
    isProcessing: false,
    lastProcessedAt: null,
    error: null,
    winProbabilityHistory: [],
  }),
}));
