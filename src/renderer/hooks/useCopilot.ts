/**
 * useCopilot Hook
 *
 * Provides integration between the Meeting Co-Pilot backend and React components.
 * Handles IPC event subscriptions and state synchronization.
 */

import { useEffect, useCallback, useRef } from 'react';
import { useCopilotStore } from '../stores/copilot.store';
import { useConfigStore } from '../stores/config.store';

// Hook

export function useCopilot() {
  const {
    config,
    isInitialized,
    isCallActive,
    recordingId,
    metrics,
    healthScore,
    activeNudge,
    callSummary,
    callDuration,
    setConfig,
    setInitialized,
    startCall,
    endCall,
    setMetrics,
    setNudge,
    dismissNudge,
    setCallSummary,
    addTranscriptSegment,
    reset,
  } = useCopilotStore();

  const { apiKey } = useConfigStore();
  const unsubscribersRef = useRef<Array<() => void>>([]);

  /**
   * Initialize copilot with API key
   */
  const initialize = useCallback(async () => {
    if (!apiKey || isInitialized) return;

    try {
      const result = await window.electronAPI.copilot.initialize(apiKey);
      if (result.success) {
        setInitialized(true);
      } else {
        console.error('Failed to initialize copilot:', result.error);
      }
    } catch (error) {
      console.error('Error initializing copilot:', error);
    }
  }, [apiKey, isInitialized, setInitialized]);

  /**
   * Start copilot for a call
   */
  const startCopilot = useCallback(async (recId: number, sessionId: string) => {
    if (!isInitialized) {
      await initialize();
    }

    try {
      const result = await window.electronAPI.copilot.startCall(recId, sessionId);
      if (result.success) {
        startCall(recId);
      } else {
        console.error('Failed to start copilot:', result.error);
      }
    } catch (error) {
      console.error('Error starting copilot:', error);
    }
  }, [isInitialized, initialize, startCall]);

  /**
   * End copilot and get summary
   */
  const stopCopilot = useCallback(async () => {
    try {
      const result = await window.electronAPI.copilot.endCall();
      if (result.success && result.summary) {
        // Summary will come through the event listener
      }
      endCall();
    } catch (error) {
      console.error('Error stopping copilot:', error);
      endCall();
    }
  }, [endCall]);

  /**
   * Update copilot configuration
   */
  const updateConfig = useCallback(async (newConfig: Partial<typeof config>) => {
    setConfig(newConfig);
    try {
      await window.electronAPI.copilot.updateConfig(newConfig);
    } catch (error) {
      console.error('Error updating copilot config:', error);
    }
  }, [setConfig]);

  /**
   * Dismiss active nudge
   */
  const handleDismissNudge = useCallback(async () => {
    if (activeNudge) {
      dismissNudge();
      try {
        await window.electronAPI.copilot.dismissNudge(activeNudge.id);
      } catch (error) {
        console.error('Error dismissing nudge:', error);
      }
    }
  }, [activeNudge, dismissNudge]);

  /**
   * Setup IPC event listeners
   */
  useEffect(() => {
    // Clean up previous listeners
    unsubscribersRef.current.forEach(unsub => unsub());
    unsubscribersRef.current = [];

    // Subscribe to copilot events
    const unsubTranscript = window.electronAPI.copilotOn.onTranscript((segment) => {
      addTranscriptSegment(segment);
    });

    const unsubMetrics = window.electronAPI.copilotOn.onMetrics(({ metrics, health }) => {
      setMetrics(metrics, health);
    });

    const unsubNudge = window.electronAPI.copilotOn.onNudge(({ nudge }) => {
      setNudge(nudge);
    });

    const unsubCallEnded = window.electronAPI.copilotOn.onCallEnded(({ summary, metrics, duration }) => {
      setCallSummary(summary, duration);
      setMetrics(metrics, 0);
    });

    const unsubError = window.electronAPI.copilotOn.onError(({ error, context }) => {
      console.error('Copilot error:', error, context);
    });

    unsubscribersRef.current = [
      unsubTranscript,
      unsubMetrics,
      unsubNudge,
      unsubCallEnded,
      unsubError,
    ];

    return () => {
      unsubscribersRef.current.forEach(unsub => unsub());
    };
  }, [
    addTranscriptSegment,
    setMetrics,
    setNudge,
    setCallSummary,
  ]);

  /**
   * Initialize on mount if API key is available
   */
  useEffect(() => {
    if (apiKey && !isInitialized) {
      initialize();
    }
  }, [apiKey, isInitialized, initialize]);

  return {
    // State
    config,
    isInitialized,
    isCallActive,
    recordingId,
    metrics,
    healthScore,
    activeNudge,
    callSummary,
    callDuration,

    // Actions
    initialize,
    startCopilot,
    stopCopilot,
    updateConfig,
    dismissNudge: handleDismissNudge,
    reset,
  };
}

export default useCopilot;
