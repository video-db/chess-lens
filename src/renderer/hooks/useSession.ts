import { useEffect, useCallback, useRef } from 'react';
import { useSessionStore } from '../stores/session.store';
import { useTranscriptionStore } from '../stores/transcription.store';
import { useVisualIndexStore } from '../stores/visual-index.store';
import { useConfigStore } from '../stores/config.store';
import { useCopilotStore } from '../stores/copilot.store';
import { useMCPStore } from '../stores/mcp.store';
import { useLiveAssistStore } from '../stores/live-assist.store';
import { trpc } from '../api/trpc';
import { getElectronAPI } from '../api/ipc';
import { rendererLog } from '../lib/utils';
import type { ProbingQuestion } from '../../shared/types/meeting-setup.types';
import {
  DEFAULT_GAME_ID,
  getGameIndexingPrompt,
  type SupportedGameId,
} from '../../shared/config/game-coaching';

interface MeetingSetupData {
  name: string;
  description: string;
  gameId: SupportedGameId;
  coachPersonalityId?: string;
  questions: ProbingQuestion[];
  checklist: string[];
}

export function useSession() {
  const sessionStore = useSessionStore();
  const transcriptionStore = useTranscriptionStore();
  const configStore = useConfigStore();

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const generateTokenMutation = trpc.token.generate.useMutation();
  const createSessionMutation = trpc.capture.createSession.useMutation();
  const startRecordingMutation = trpc.recordings.start.useMutation();
  const stopRecordingMutation = trpc.recordings.stop.useMutation();
  const startTranscriptionMutation = trpc.transcription.start.useMutation();
  const startVisualIndexMutation = trpc.visualIndex.start.useMutation();

  // Recorder events are global to prevent transcript loss on navigation.

  useEffect(() => {
    if (sessionStore.status === 'recording' && sessionStore.startTime) {
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - sessionStore.startTime!) / 1000);
        sessionStore.setElapsedTime(elapsed);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [sessionStore.status, sessionStore.startTime]);

  const startRecording = useCallback(async (meetingSetup?: MeetingSetupData) => {
    rendererLog('info', 'use-session', 'startRecording called', { name: meetingSetup?.name ?? null });
    const api = getElectronAPI();
    if (!api) {
      rendererLog('error', 'use-session', 'startRecording failed: Electron API not available');
      sessionStore.setError('Electron API not available');
      return;
    }

    const accessToken = configStore.accessToken;
    const apiUrl = configStore.apiUrl;

    if (!accessToken) {
      rendererLog('error', 'use-session', 'startRecording failed: not authenticated');
      sessionStore.setError('Not authenticated. Please log in first.');
      return;
    }

    rendererLog('info', 'use-session', 'Setting status to starting');
    sessionStore.setStatus('starting');
    transcriptionStore.clear();
    useVisualIndexStore.getState().clear();
    useMCPStore.getState().clearResults();

    try {
      // Always generate a fresh session token before creating a new capture session.
      // Reusing a cached token causes 403 "Unauthorized access to session" because
      // the VideoDB server only authorises sessions created within the same token context.
      rendererLog('info', 'use-session', 'Generating session token');
      const tokenResult = await generateTokenMutation.mutateAsync({});
      const sessionToken = tokenResult.sessionToken;
      const tokenExpiresAt = tokenResult.expiresAt;
      sessionStore.setSessionToken(sessionToken, tokenExpiresAt);

      if (!sessionToken) {
        throw new Error('Failed to get session token');
      }
      rendererLog('info', 'use-session', 'Session token obtained');

      rendererLog('info', 'use-session', 'Creating capture session');
      const captureSession = await createSessionMutation.mutateAsync({});
      rendererLog('info', 'use-session', 'Capture session created', { sessionId: captureSession.sessionId });

      const streamsConfig = {
        microphone: sessionStore.streams.microphone,
        systemAudio: sessionStore.streams.systemAudio,
        screen: sessionStore.streams.screen,
      };

      rendererLog('info', 'use-session', 'Stream config', {
        microphone: streamsConfig.microphone,
        systemAudio: streamsConfig.systemAudio,
        screen: streamsConfig.screen,
      });

      if (!streamsConfig.microphone && !streamsConfig.systemAudio && !streamsConfig.screen) {
        throw new Error('No streams enabled for recording');
      }

      rendererLog('info', 'use-session', 'Calling capture.startRecording IPC', {
        sessionId: captureSession.sessionId,
        enableTranscription: transcriptionStore.enabled,
        enableVisualIndex: streamsConfig.screen,
        gameId: meetingSetup?.gameId ?? DEFAULT_GAME_ID,
      });
       const result = await api.capture.startRecording({
         config: {
           sessionId: captureSession.sessionId,
           streams: streamsConfig,
         },
         sessionToken,
         accessToken,
         apiUrl: apiUrl || undefined,
         enableTranscription: transcriptionStore.enabled,
         // Always create screen WebSocket when screen is enabled - user controls indexing via toggle
         enableVisualIndex: streamsConfig.screen,
         // Used by the floating widget overlay to render game-specific UI (e.g. detailed chess tips).
         gameId: meetingSetup?.gameId || DEFAULT_GAME_ID,
       });

      rendererLog('info', 'use-session', 'capture.startRecording IPC returned', {
        success: result.success,
        error: result.error ?? null,
        hasMicWs: !!result.micWsConnectionId,
        hasSysAudioWs: !!result.sysAudioWsConnectionId,
        hasScreenWs: !!result.screenWsConnectionId,
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to start recording');
      }

      // Start recording with meeting setup data if provided
      const recordingResult = await startRecordingMutation.mutateAsync({
        sessionId: captureSession.sessionId,
        gameId: meetingSetup?.gameId || DEFAULT_GAME_ID,
        meetingName: meetingSetup?.name,
        meetingDescription: meetingSetup?.description,
        probingQuestions: meetingSetup?.questions,
        meetingChecklist: meetingSetup?.checklist,
      });

      // Store recording ID for post-session navigation
      if (recordingResult?.id) {
        sessionStore.setRecordingId(recordingResult.id);
      }

      const hasTranscription = transcriptionStore.enabled && (result.micWsConnectionId || result.sysAudioWsConnectionId);
      const hasVisualIndex = !!result.screenWsConnectionId;
      const selectedGameId = meetingSetup?.gameId || DEFAULT_GAME_ID;
      const visualIndexPrompt = getGameIndexingPrompt(selectedGameId);

      if (hasTranscription || hasVisualIndex) {
        await startTranscriptionMutation.mutateAsync({
          sessionId: captureSession.sessionId,
          micWsConnectionId: transcriptionStore.enabled ? result.micWsConnectionId : undefined,
          sysAudioWsConnectionId: transcriptionStore.enabled ? result.sysAudioWsConnectionId : undefined,
          screenWsConnectionId: hasVisualIndex ? result.screenWsConnectionId : undefined,
        });
      }

      if (hasVisualIndex && result.screenWsConnectionId) {
        try {
          const visualStart = await startVisualIndexMutation.mutateAsync({
            sessionId: captureSession.sessionId,
            screenWsConnectionId: result.screenWsConnectionId,
            gameId: selectedGameId,
            prompt: visualIndexPrompt,
          });

          if (visualStart.success && visualStart.sceneIndexId) {
            const visualIndexStore = useVisualIndexStore.getState();
            visualIndexStore.setEnabled(true);
            visualIndexStore.setSceneIndexId(visualStart.sceneIndexId);
            if (visualStart.rtstreamId) {
              visualIndexStore.setRtstreamId(visualStart.rtstreamId);
            }
            visualIndexStore.setRunning(true);
          }
        } catch (visualError) {
          rendererLog('warn', 'use-session', 'Failed to auto-start visual index', {
            error: visualError instanceof Error ? visualError.message : String(visualError),
          });
        }
      }

      if (recordingResult?.id) {
        try {
          const copilotResult = await api.copilot.startCall(
            recordingResult.id,
            captureSession.sessionId
          );
          if (copilotResult.success) {
            useCopilotStore.getState().startCall(recordingResult.id);
          }
        } catch (copilotError) {
          rendererLog('warn', 'use-session', 'Failed to start copilot call (non-fatal)', {
            error: copilotError instanceof Error ? copilotError.message : String(copilotError),
          });
        }
      }

      rendererLog('info', 'use-session', 'Recording started successfully', { sessionId: captureSession.sessionId });
      sessionStore.startSession(
        captureSession.sessionId,
        sessionToken!,
        tokenExpiresAt!,
        result.screenWsConnectionId,
        selectedGameId,
        visualIndexPrompt,
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to start recording';
      const errorStack = error instanceof Error ? error.stack : undefined;
      rendererLog('error', 'use-session', 'startRecording failed', {
        error: errorMessage,
        stack: errorStack ?? null,
        // tRPC always sets data.path to the procedure name (e.g. "token.generate",
        // "capture.createSession"). Logging it here tells us exactly which call threw.
        trpcPath: (error as any)?.data?.path ?? null,
      });

      if (errorMessage.includes('logged in') || errorMessage.includes('UNAUTHORIZED')) {
        configStore.clearAuth();
        sessionStore.setError('Session expired. Please log in again.');
      } else {
        sessionStore.setError(errorMessage);
      }
      sessionStore.setStatus('idle');
    }
  }, [
    sessionStore,
    transcriptionStore,
    configStore,
    generateTokenMutation,
    createSessionMutation,
    startRecordingMutation,
    startTranscriptionMutation,
    startVisualIndexMutation,
  ]);

  const stopRecording = useCallback(async () => {
    const api = getElectronAPI();
    if (!api) return;

    sessionStore.setStatus('stopping');

    // Stop live assist and MCP inference immediately — don't rely on the
    // useLiveAssist React effect which fires asynchronously after re-render.
    // This prevents the interval from continuing to log "No new gameplay
    // action feed to process" during the (potentially slow) capture shutdown.
    api.liveAssist.stop().catch((err: Error) => {
      console.warn('[useSession] Failed to stop live assist on recording stop:', err);
    });

    try {
      const result = await api.capture.stopRecording();

      if (!result.success) {
        throw new Error(result.error || 'Failed to stop recording');
      }

      useMCPStore.getState().clearResults();

      if (sessionStore.sessionId) {
        await stopRecordingMutation.mutateAsync({
          sessionId: sessionStore.sessionId,
        });
      }

      try {
        const copilotResult = await api.copilot.endCall();
        if (copilotResult.success && copilotResult.summary) {
          const duration = useCopilotStore.getState().callDuration || 0;
          useCopilotStore.getState().setCallSummary(copilotResult.summary, duration);
        }
      } catch (copilotError) {
        // Ignore copilot errors
      }

      transcriptionStore.clear();
      useVisualIndexStore.getState().clear();
      useLiveAssistStore.getState().clear();

      const copilotState = useCopilotStore.getState();
      if (!copilotState.callSummary) {
        copilotState.reset();
      } else {
        copilotState.endCall();
      }

      // Transition session to idle now that all work (including copilot) is complete
      sessionStore.setElapsedTime(0);
      sessionStore.stopSession();
    } catch (error) {
      sessionStore.setError(error instanceof Error ? error.message : 'Failed to stop recording');
      sessionStore.stopSession();

      transcriptionStore.clear();
      useVisualIndexStore.getState().clear();
      useLiveAssistStore.getState().clear();
      useCopilotStore.getState().reset();
    }
  }, [sessionStore, transcriptionStore, stopRecordingMutation]);

  const toggleStream = useCallback(
    async (stream: 'microphone' | 'systemAudio' | 'screen') => {
      const api = getElectronAPI();
      if (!api) return;

      const currentState = sessionStore.streams[stream];
      sessionStore.toggleStream(stream);

      if (sessionStore.status === 'recording') {
        const channelIdMap: Record<string, string> = {
          microphone: 'mic',
          systemAudio: 'system_audio',
          screen: 'screen',
        };
        const channelId = channelIdMap[stream];

        if (channelId) {
          if (currentState) {
            await api.capture.pauseTracks([channelId]);
          } else {
            await api.capture.resumeTracks([channelId]);
          }
        }
      }
    },
    [sessionStore]
  );

  const pauseRecording = useCallback(async () => {
    const api = getElectronAPI();
    if (!api || sessionStore.status !== 'recording') return;

    await api.capture.pauseTracks(['mic', 'system_audio', 'screen']);
    sessionStore.setPaused(true);
  }, [sessionStore]);

  const resumeRecording = useCallback(async () => {
    const api = getElectronAPI();
    if (!api || sessionStore.status !== 'recording') return;

    await api.capture.resumeTracks(['mic', 'system_audio', 'screen']);
    sessionStore.setPaused(false);
  }, [sessionStore]);

  return {
    ...sessionStore,
    startRecording,
    stopRecording,
    toggleStream,
    pauseRecording,
    resumeRecording,
    isRecording: sessionStore.status === 'recording',
    isStarting: sessionStore.status === 'starting',
    isStopping: sessionStore.status === 'stopping',
  };
}
