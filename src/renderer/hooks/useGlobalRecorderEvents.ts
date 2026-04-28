import { useEffect, useRef } from 'react';
import { useSessionStore } from '../stores/session.store';
import { useTranscriptionStore } from '../stores/transcription.store';
import { useVisualIndexStore } from '../stores/visual-index.store';
import { useCopilotStore } from '../stores/copilot.store';
import { useLiveAssistStore } from '../stores/live-assist.store';
import { getElectronAPI } from '../api/ipc';
import type { RecorderEvent, TranscriptEvent, VisualIndexEvent } from '../../shared/types/ipc.types';

function normalizeVisualIndexText(raw: string): string {
  const sanitized = (value: string) => value
    .replace(/\*\*/g, '')
    .replace(/__+/g, '')
    .replace(/`+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const tryParse = (input: string): string | null => {
    try {
      const parsed = JSON.parse(input) as unknown;
      if (typeof parsed === 'string') return sanitized(parsed);
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        const headingTip = typeof obj.heading_tip === 'string' ? obj.heading_tip : '';
        const tip = typeof obj.tip === 'string' ? obj.tip : '';
        const analysis = typeof obj.analysis === 'string' ? obj.analysis : '';
        const combined = [headingTip, tip, analysis].filter(Boolean).join(' ||| ').trim();
        return combined || null;
      }
    } catch {
      return null;
    }
    return null;
  };

  const text = (raw || '').trim();
  if (!text) return '';

  const direct = tryParse(text);
  if (direct) return direct;

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const sliced = tryParse(text.slice(start, end + 1));
    if (sliced) return sliced;
  }

  return sanitized(text);
}

/**
 * Global hook to listen for recorder events from the main process.
 * This should be called ONCE at the App level to ensure transcript events
 * are captured even when navigating between pages.
 */
export function useGlobalRecorderEvents() {
  const sessionStore = useSessionStore();
  const transcriptionStore = useTranscriptionStore();
  const visualIndexStore = useVisualIndexStore();

  // Use refs to avoid re-subscribing when stores change
  const sessionStoreRef = useRef(sessionStore);
  const transcriptionStoreRef = useRef(transcriptionStore);
  const visualIndexStoreRef = useRef(visualIndexStore);

  // Keep refs updated
  useEffect(() => {
    sessionStoreRef.current = sessionStore;
  }, [sessionStore]);

  useEffect(() => {
    transcriptionStoreRef.current = transcriptionStore;
  }, [transcriptionStore]);

  useEffect(() => {
    visualIndexStoreRef.current = visualIndexStore;
  }, [visualIndexStore]);

  useEffect(() => {
    const api = getElectronAPI();
    if (!api) return;

    const unsubscribe = api.on.recorderEvent((event: RecorderEvent) => {
      const session = sessionStoreRef.current;
      const transcription = transcriptionStoreRef.current;
      const visualIndex = visualIndexStoreRef.current;

      switch (event.event) {
        case 'recording:started':
          // Guard against stale/out-of-order start events after a stop.
          if (session.status === 'starting' || session.status === 'recording') {
            session.setStatus('recording');
          }
          break;

        case 'recording:stopped':
          {
            // Always clear volatile analysis UI state on stop, including overlay-stop path.
            transcription.clear();
            visualIndex.clear();
            useLiveAssistStore.getState().clear();

            // Ignore stale stop events after the session is already finalized.
            if (session.status === 'idle') {
              break;
            }

            // If stop is already orchestrated by useSession.stopRecording(), keep existing behavior.
            if (session.status === 'stopping') {
              session.setStatus('processing');
              break;
            }

            // Fallback path (e.g., stop from floating widget): finalize copilot summary here.
            const isCallActive = useCopilotStore.getState().isCallActive;
            if (!isCallActive) {
              session.setStatus('idle');
              break;
            }

            session.setStatus('processing');

            const currentApi = getElectronAPI();
            if (!currentApi) {
              useCopilotStore.getState().reset();
              session.setStatus('idle');
              break;
            }

            currentApi.copilot.endCall()
              .then((copilotResult) => {
                if (copilotResult.success && copilotResult.summary) {
                  const duration = useCopilotStore.getState().callDuration || 0;
                  useCopilotStore.getState().setCallSummary(copilotResult.summary, duration);
                  useCopilotStore.getState().endCall();
                } else {
                  useCopilotStore.getState().reset();
                }
              })
              .catch((err: Error) => {
                console.warn('[GlobalRecorderEvents] Error finalizing copilot on stop:', err);
                useCopilotStore.getState().reset();
              })
              .finally(() => {
                session.setStatus('idle');
              });
          }
          break;

        case 'recording:error':
          session.setError(String(event.data));
          session.setStatus('idle');
          break;

        case 'transcript':
          if (event.data && transcription.enabled) {
            const transcript = event.data as TranscriptEvent;
            if (transcript.isFinal) {
              transcription.finalizePending(transcript.source, transcript.text);
            } else {
              transcription.updatePending(transcript.source, transcript.text);
            }

            // Forward transcript to copilot backend (for final segments only)
            const currentApi = getElectronAPI();
            if (transcript.isFinal && currentApi) {
              // Forward to copilot if active
              if (useCopilotStore.getState().isCallActive) {
                const channel: 'me' | 'them' = transcript.source === 'mic' ? 'me' : 'them';
                currentApi.copilot.sendTranscript(channel, {
                  text: transcript.text,
                  is_final: true,
                  start: transcript.start,
                  end: transcript.end,
                }).catch((err: Error) => {
                  console.warn('[GlobalRecorderEvents] Error forwarding transcript to copilot:', err);
                });
              }
            }

            // Live assist is visual/game-action based; do not feed transcript/audio.
          }
          break;

        case 'visual_index':
          if (event.data) {
            const visualData = event.data as VisualIndexEvent;
            const normalizedVisualText = normalizeVisualIndexText(visualData.text);
            visualIndex.addItem({
              text: normalizedVisualText,
              start: visualData.start,
              end: visualData.end,
              rtstreamId: visualData.rtstreamId,
              rtstreamName: visualData.rtstreamName,
            });

            // NOTE: Live assist forwarding is handled on the main process side (capture.ts)
            // to avoid duplicate/out-of-order processing. Renderer only handles UI state and DB storage.

            // Save to database for durable storage
            const currentSession = useSessionStore.getState();
            if (currentSession.recordingId && currentSession.sessionId) {
              const currentApi = getElectronAPI();
              if (currentApi) {
                // Convert epoch ms timestamps to seconds from call start
                const callStartSec = currentSession.startTime ? currentSession.startTime / 1000 : visualData.start;
                currentApi.visualIndex.saveItem({
                  recordingId: currentSession.recordingId,
                  sessionId: currentSession.sessionId,
                  text: normalizedVisualText,
                  startTime: Math.max(0, visualData.start - callStartSec),
                  endTime: Math.max(0, visualData.end - callStartSec),
                  rtstreamId: visualData.rtstreamId,
                  rtstreamName: visualData.rtstreamName,
                }).catch((err: Error) => {
                  console.warn('[GlobalRecorderEvents] Error saving visual index item:', err);
                });
              }
            }
          }
          break;

        case 'upload:progress':
          console.log('[GlobalRecorderEvents] Upload progress:', event.data);
          break;

        case 'upload:complete':
          // Safety net: if summary is not active, ensure we don't stay stuck in processing.
          if (session.status === 'processing' && !useCopilotStore.getState().isCallActive) {
            session.setStatus('idle');
          }
          console.log('[GlobalRecorderEvents] Upload complete received');
          break;

        case 'error':
          console.error('[GlobalRecorderEvents] Error:', event.data);
          session.setError(String(event.data));
          break;
      }
    });

    // Only unsubscribe when the entire app unmounts (which shouldn't happen during normal use)
    return () => {
      console.log('[Global] Cleaning up recorder event listener');
      unsubscribe();
    };
  }, []); // Empty deps - only run once on mount
}
