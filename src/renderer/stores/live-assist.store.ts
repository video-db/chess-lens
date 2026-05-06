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
  /** Timestamp (ms) when this point was recorded */
  timestamp: number;
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
  /** Move history table: pairs of white/black moves */
  moveHistory: MoveEntry[];
  isProcessing: boolean;
  lastProcessedAt: number | null;
  error: string | null;
  /** Accumulated win probability history for the live chart */
  winProbabilityHistory: WinProbabilityPoint[];

  // Actions
  addInsights: (insights: LiveInsights, winData?: { winChance?: number; turn?: 'w' | 'b'; moveSan?: string }) => void;
  addMove: (san: string, turn: 'w' | 'b') => void;
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

  addInsights: (insights, winData) => set((state) => {
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

    // Build structured coaching tip entries with move context
    const newCoachingTips = [...state.coachingTips];
    const existingTipTexts = new Set(state.coachingTips.map(t => t.text.toLowerCase()));
    for (const text of newSayThis) {
      if (!existingTipTexts.has(text.toLowerCase())) {
        newCoachingTips.push({
          text,
          moveSan: winData?.moveSan,
          moveNo: newCoachingTips.length + 1,
        });
      }
    }
    const trimmedTips = newCoachingTips.slice(-15);

    // Append win probability point if we have valid data for this position
    const newHistory = [...state.winProbabilityHistory];
    if (winData?.winChance !== undefined && winData?.turn !== undefined) {
      const lastPoint = newHistory[newHistory.length - 1];
      const isDuplicate = lastPoint &&
        Math.abs(lastPoint.winChance - winData.winChance) < 0.01 &&
        lastPoint.turn === winData.turn &&
        Date.now() - lastPoint.timestamp < 2000;

      if (!isDuplicate) {
        newHistory.push({
          winChance: winData.winChance,
          turn: winData.turn,
          timestamp: Date.now(),
        });
        if (newHistory.length > 100) newHistory.splice(0, newHistory.length - 100);
      }
    }

    return {
      sayThis: combinedSayThis,
      askThis: combinedAskThis,
      coachingTips: trimmedTips,
      lastProcessedAt: Date.now(),
      error: null,
      winProbabilityHistory: newHistory,
    };
  }),

  setProcessing: (isProcessing) => set({ isProcessing }),

  setError: (error) => set({ error, isProcessing: false }),

  addMove: (san, turn) => set((state) => {
    const history = [...state.moveHistory];
    if (turn === 'w') {
      // White just played — start a new move entry
      history.push({ no: history.length + 1, white: san });
    } else {
      // Black just played — fill in the last entry's black move
      const last = history[history.length - 1];
      if (last && !last.black) {
        history[history.length - 1] = { ...last, black: san };
      } else {
        // Edge case: Black plays first (rare) or last entry already has black
        history.push({ no: history.length + 1, black: san });
      }
    }
    return { moveHistory: history };
  }),

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
