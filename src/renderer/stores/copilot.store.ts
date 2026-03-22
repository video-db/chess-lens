/**
 * Meeting Co-Pilot Store
 *
 * Centralized state management for Meeting Co-Pilot features:
 * - Conversation metrics
 * - Nudges
 * - Call summary
 */

import { create } from 'zustand';
import type {
  CopilotMetrics,
  CopilotNudge,
  CopilotCallSummary,
  CopilotConfig,
  CopilotTranscriptSegment,
} from '../../shared/types/ipc.types';

// Types

export interface CopilotState {
  // Configuration
  config: CopilotConfig;
  isInitialized: boolean;
  isCallActive: boolean;
  recordingId: number | null;

  // Metrics
  metrics: CopilotMetrics | null;
  healthScore: number;

  // Nudges
  activeNudge: CopilotNudge | null;
  nudgeHistory: CopilotNudge[];

  // Call Summary
  callSummary: CopilotCallSummary | null;
  callDuration: number;

  // Transcript segments (for UI display with copilot annotations)
  transcriptSegments: CopilotTranscriptSegment[];

  // Actions
  setConfig: (config: Partial<CopilotConfig>) => void;
  setInitialized: (value: boolean) => void;
  startCall: (recordingId: number) => void;
  endCall: () => void;

  // Metrics actions
  setMetrics: (metrics: CopilotMetrics, health: number) => void;

  // Nudge actions
  setNudge: (nudge: CopilotNudge) => void;
  dismissNudge: () => void;

  // Summary actions
  setCallSummary: (summary: CopilotCallSummary, duration: number) => void;

  // Transcript actions
  addTranscriptSegment: (segment: CopilotTranscriptSegment) => void;
  clearTranscripts: () => void;

  // Reset
  reset: () => void;
}

// Initial State

const initialConfig: CopilotConfig = {
  enableTranscription: true,
  enableMetrics: true,
  enableNudges: true,
};

const initialState = {
  config: initialConfig,
  isInitialized: false,
  isCallActive: false,
  recordingId: null,
  metrics: null,
  healthScore: 100,
  activeNudge: null,
  nudgeHistory: [],
  callSummary: null,
  callDuration: 0,
  transcriptSegments: [],
};

// Store

export const useCopilotStore = create<CopilotState>((set, get) => ({
  ...initialState,

  // Configuration
  setConfig: (config) => {
    set((state) => ({
      config: { ...state.config, ...config },
    }));
  },

  setInitialized: (value) => set({ isInitialized: value }),

  startCall: (recordingId) => {
    set({
      isCallActive: true,
      recordingId,
      metrics: null,
      healthScore: 100,
      activeNudge: null,
      nudgeHistory: [],
      callSummary: null,
      callDuration: 0,
      transcriptSegments: [],
    });
  },

  endCall: () => {
    set({
      isCallActive: false,
      activeNudge: null,
    });
  },

  // Metrics
  setMetrics: (metrics, health) => {
    set({ metrics, healthScore: health });
  },

  // Nudges
  setNudge: (nudge) => {
    set((state) => ({
      activeNudge: nudge,
      nudgeHistory: [...state.nudgeHistory, nudge],
    }));
  },

  dismissNudge: () => {
    set({ activeNudge: null });
  },

  // Summary
  setCallSummary: (summary, duration) => {
    set({ callSummary: summary, callDuration: duration });
  },

  // Transcripts
  addTranscriptSegment: (segment) => {
    set((state) => ({
      transcriptSegments: [...state.transcriptSegments.slice(-200), segment], // Keep last 200
    }));
  },

  clearTranscripts: () => {
    set({ transcriptSegments: [] });
  },

  // Reset
  reset: () => {
    set({
      ...initialState,
    });
  },
}));

// Selectors (for optimized re-renders)

export const selectMetrics = (state: CopilotState) => state.metrics;
export const selectActiveNudge = (state: CopilotState) => state.activeNudge;
export const selectCallSummary = (state: CopilotState) => state.callSummary;
export const selectIsCallActive = (state: CopilotState) => state.isCallActive;
export const selectConfig = (state: CopilotState) => state.config;
export const selectHealthScore = (state: CopilotState) => state.healthScore;
