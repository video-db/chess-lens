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
import { rendererLog } from '../lib/utils';

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

      rendererLog('info', 'live-assist-hook', 'Starting live assist service', {
        hasContext,
        gameId: context.gameId,
        selectedGameId,
      });

      if (wasRecordingRef.current) {
        api.liveAssist.stop().catch(err => {
          rendererLog('error', 'live-assist-hook', 'Failed to restart before game change', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      api.liveAssist.start(hasContext ? context : undefined).catch(err => {
        rendererLog('error', 'live-assist-hook', 'Failed to start', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
      wasRecordingRef.current = true;
      startedGameIdRef.current = currentGameId;
    } else if (!isRecording && wasRecordingRef.current) {
      // Recording just stopped
      rendererLog('info', 'live-assist-hook', 'Stopping live assist service');
      api.liveAssist.stop().catch(err => {
        rendererLog('error', 'live-assist-hook', 'Failed to stop', {
          error: err instanceof Error ? err.message : String(err),
        });
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

    rendererLog('debug', 'live-assist-hook', 'Setting up event listener');

    const unsubscribe = api.liveAssistOn.onUpdate((event) => {
      rendererLog('debug', 'live-assist-hook', 'Received insights', {
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

      // Pass moveSan alongside insights so coaching tips can display which move triggered them.
      store.addInsights(event.insights, event.moveSan);
    });

    // Subscribe to FEN events to keep move history and win-probability chart in
    // sync with the main process.  The main process owns both canonical snapshots
    // and sends them on every confirmed position change.  Replacing (not appending)
    // ensures that any hallucinated branch is immediately pruned when the board reverts.
    let unsubFen: (() => void) | undefined;
    if (typeof api.liveAssistOn.onFen === 'function') {
      unsubFen = api.liveAssistOn.onFen((data) => {
        if (data.moveHistorySnapshot) {
          store.setMoveHistory(data.moveHistorySnapshot);
        }
        // Only replace win-probability history when the snapshot is non-empty.
        // An empty snapshot means no positions have been analysed yet in this
        // cycle — replacing with [] would wipe valid points that are already
        // in the store from a previous successful analysis.
        if (data.winProbabilitySnapshot && data.winProbabilitySnapshot.length > 0) {
          store.setWinProbabilityHistory(data.winProbabilitySnapshot);
        }
      });
    }

    return () => {
      rendererLog('debug', 'live-assist-hook', 'Cleaning up event listener');
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
