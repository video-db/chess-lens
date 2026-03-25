/**
 * useSessionLifecycle Hook
 *
 * Centralized session lifecycle manager that ensures atomic state transitions.
 * All session start/stop operations should go through this hook to prevent
 * stale state issues and race conditions.
 */

import { useCallback } from 'react';
import { useSessionStore } from '../stores/session.store';
import { useCopilotStore } from '../stores/copilot.store';
import { useMeetingSetupStore } from '../stores/meeting-setup.store';
import { useTranscriptionStore } from '../stores/transcription.store';
import { useLiveAssistStore } from '../stores/live-assist.store';
import { useVisualIndexStore } from '../stores/visual-index.store';
import { useMCPStore } from '../stores/mcp.store';

/**
 * Clears all session-related stores atomically.
 * This is the single source of truth for "what needs to be reset for a fresh session".
 */
export function resetAllSessionStores() {
  // Clear copilot state (metrics, nudges, summary, transcripts)
  useCopilotStore.getState().reset();

  // Clear meeting setup state (name, description, questions, checklist)
  useMeetingSetupStore.getState().reset();

  // Clear transcription state
  useTranscriptionStore.getState().clear();

  // Clear live assist state
  useLiveAssistStore.getState().clear();

  // Clear visual index state
  useVisualIndexStore.getState().clear();

  // Clear MCP results (but keep server configs)
  useMCPStore.getState().clearResults();
}

/**
 * Returns a promise that resolves when session status becomes 'idle'.
 * Uses Zustand subscription for proper state-based waiting.
 */
export function waitForSessionIdle(): Promise<void> {
  return new Promise<void>((resolve) => {
    // Check if already idle
    if (useSessionStore.getState().status === 'idle') {
      resolve();
      return;
    }

    // Subscribe and wait for idle
    const unsub = useSessionStore.subscribe((state) => {
      if (state.status === 'idle') {
        unsub();
        resolve();
      }
    });
  });
}

export function useSessionLifecycle() {
  const sessionStore = useSessionStore();

  /**
   * Prepares a fresh session by clearing all stale state.
   * MUST be called before any new recording starts.
   *
   * This ensures:
   * - Old call summaries don't show up for new calls
   * - Previous meeting setup data is cleared
   * - Transcripts, assists, and visual index are fresh
   */
  const prepareNewSession = useCallback(() => {
    resetAllSessionStores();

    // Clear session error but preserve stream preferences
    sessionStore.setError(null);
  }, [sessionStore]);

  /**
   * Wait for the current session to reach idle state.
   * Use this instead of arbitrary setTimeout delays.
   */
  const waitForIdle = useCallback(() => {
    return waitForSessionIdle();
  }, []);

  /**
   * Prepare for a new session and optionally pre-fill meeting info.
   * Use this when navigating to meeting setup from notifications/calendar.
   */
  const prepareNewSessionWithInfo = useCallback(
    (name: string, description: string) => {
      prepareNewSession();
      useMeetingSetupStore.getState().setInfo(name, description);
    },
    [prepareNewSession]
  );

  return {
    prepareNewSession,
    prepareNewSessionWithInfo,
    waitForIdle,
    resetAllSessionStores,
  };
}

export default useSessionLifecycle;
