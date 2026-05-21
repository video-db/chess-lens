/**
 * useLiveAssist Hook
 *
 * Manages the live assist feature lifecycle and subscribes to
 * insight updates from the main process.
 */

import { useEffect, useRef } from 'react';
import { useLiveAssistStore } from '../stores/live-assist.store';
import { useSessionStore } from '../stores/session.store';
import { useGameSetupStore } from '../stores/meeting-setup.store';
import { getElectronAPI } from '../api/ipc';

export function useLiveAssist() {
  const store = useLiveAssistStore();
  const { status, selectedGameId } = useSessionStore();
  const isRecording = status === 'recording';
  const wasRecordingRef = useRef(false);
  const startedGameIdRef = useRef<string | null>(null);

  // Start/stop live assist based on recording state
  useEffect(() => {
    const api = getElectronAPI();
    if (!api) return;

    const currentGameId = selectedGameId || null;

    if (isRecording && (!wasRecordingRef.current || startedGameIdRef.current !== currentGameId)) {
      // Recording just started, or the selected game changed while recording.
      const meetingSetup = useGameSetupStore.getState();
      const context = {
        name: meetingSetup.name || undefined,
        description: meetingSetup.description || undefined,
        gameId: meetingSetup.gameId || selectedGameId,
        coachPersonalityId: meetingSetup.coachPersonalityId || undefined,
        questions: meetingSetup.questions.length > 0 ? meetingSetup.questions : undefined,
        checklist: meetingSetup.checklist.length > 0 ? meetingSetup.checklist : undefined,
      };

      // Only pass context if at least one field has content
      const hasContext = context.name || context.description || context.gameId || context.questions || context.checklist;

      console.log('[LiveAssist] Starting live assist service', {
        hasContext,
        gameId: context.gameId,
        selectedGameId,
      });

      if (wasRecordingRef.current) {
        api.liveAssist.stop().catch(err => {
          console.error('[LiveAssist] Failed to restart before game change:', err);
        });
      }

      api.liveAssist.start(hasContext ? context : undefined).catch(err => {
        console.error('[LiveAssist] Failed to start:', err);
      });
      wasRecordingRef.current = true;
      startedGameIdRef.current = currentGameId;
    } else if (!isRecording && wasRecordingRef.current) {
      // Recording just stopped
      console.log('[LiveAssist] Stopping live assist service');
      api.liveAssist.stop().catch(err => {
        console.error('[LiveAssist] Failed to stop:', err);
      });
      store.clear();
      wasRecordingRef.current = false;
      startedGameIdRef.current = null;
    }
  }, [isRecording, selectedGameId, store]);

  // Subscribe to live assist updates
  useEffect(() => {
    const api = getElectronAPI();
    if (!api) return;

    console.log('[LiveAssist] Setting up event listener');

    const unsubscribe = api.liveAssistOn.onUpdate((event) => {
      console.log('[LiveAssist] Received insights:', {
        sayThis: event.insights.say_this.length,
        askThis: event.insights.ask_this.length,
        clearExisting: !!event.clearExisting,
        winChance: event.winChance,
        turn: event.turn,
        moveSan: event.moveSan,
      });

      if (event.clearExisting) {
        // NOTE: We intentionally do NOT clear tips here — clearExisting is sent on every
        // position change but the live session UI should accumulate all tips over time.
        // The widget handles its own clearing separately. Full reset only happens on session end.
      }

      // Pass winChance data alongside insights so the store can build the live chart.
      // winChance arrives on every emit (both stage-1 engine-only and stage-2 LLM tips).
      // We only add a chart point when we have a real winChance value.
      store.addInsights(event.insights, {
        winChance: event.winChance,
        turn: event.turn,
        moveSan: event.moveSan,
      });
    });

    // Subscribe to FEN events to keep move history in sync with the main process.
    // The main process owns the canonical move history and sends a full snapshot on
    // every confirmed position change.  Replacing (not appending) ensures that any
    // hallucinated branch is immediately pruned when the board reverts.
    let unsubFen: (() => void) | undefined;
    if (typeof api.liveAssistOn.onFen === 'function') {
      unsubFen = api.liveAssistOn.onFen((data) => {
        if (data.moveHistorySnapshot) {
          store.setMoveHistory(data.moveHistorySnapshot);
        }
      });
    }

    return () => {
      console.log('[LiveAssist] Cleaning up event listener');
      unsubscribe();
      unsubFen?.();
    };
  }, [store]);

  return {
    sayThis: store.sayThis,
    askThis: store.askThis,
    coachingTips: store.coachingTips,
    moveHistory: store.moveHistory,
    isProcessing: store.isProcessing,
    lastProcessedAt: store.lastProcessedAt,
    error: store.error,
    winProbabilityHistory: store.winProbabilityHistory,
    clear: store.clear,
  };
}

export default useLiveAssist;
