import { ipcMain, BrowserWindow, app } from 'electron';
import { CaptureClient } from 'videodb/capture';
import { connect } from 'videodb';
import type { WebSocketConnection, WebSocketMessage } from 'videodb';
import type { Channel } from '../../shared/schemas/capture.schema';
import type { RecorderEvent, TranscriptEvent, VisualIndexEvent, StartRecordingParams } from '../../shared/types/ipc.types';
import { setupSessionWebSocket, cleanupSessionWebSocket } from '../services/session-events.service';
import { startExportPoller, stopExportPoller, stopAllExportPollers } from '../services/export-poller.service';
import { createChildLogger } from '../lib/logger';
import { applyVideoDBPatches } from '../lib/videodb-patch';
import { loadAppConfig, loadRuntimeConfig } from '../lib/config';
import { getUserByAccessToken, updateRecordingBySessionId } from '../db';
import { getLiveAssistService } from '../services/live-assist.service';
import { getChessScreenshotService } from '../services/chess-screenshot.service';
import { getGameIndexingPrompt } from '../../shared/config/game-coaching';
import {
  showWidgetWindow,
  closeWidgetWindow,
} from '../windows/widget.window';
import {
  setWidgetRecordingControls,
  updateWidgetSessionState,
  updateWidgetVisualAnalysis,
  clearWidgetState,
} from './widget';

const logger = createChildLogger('ipc-capture');

let mainWindow: BrowserWindow | null = null;
let captureClient: CaptureClient | null = null;
let captureStartInFlight = false;
let captureStopInFlight = false;

// Store bound event handlers so we can remove them later to prevent memory leaks
const captureEventHandlers: {
  'recording:started'?: () => void;
  'recording:stopped'?: () => void;
  'recording:error'?: (error: unknown) => void;
  'upload:progress'?: (progress: unknown) => void;
  'upload:complete'?: (data: unknown) => void;
  'error'?: (error: unknown) => void;
} = {};

let micWebSocket: WebSocketConnection | null = null;
let sysAudioWebSocket: WebSocketConnection | null = null;
let screenWebSocket: WebSocketConnection | null = null;
let transcriptListenerActive = false;
let visualIndexListenerActive = false;

// Track current session for export polling
let currentSessionId: string | null = null;
let currentApiKey: string | null = null;
let currentAccessToken: string | null = null;
let currentApiUrl: string | undefined = undefined;
let currentCollectionId: string | null = null;

function attachCaptureErrorGuard(client: CaptureClient, source: string): void {
  client.on('error', (error: unknown) => {
    const maybe = error as { code?: string; message?: string } | undefined;
    const code = maybe?.code;
    const message = maybe?.message;

    if (code === 'INSTANCE_ALREADY_RUNNING') {
      logger.warn({ code, message, source }, 'Recorder instance already running');
      if (captureClient === client) {
        cleanupCapture();
      }
      return;
    }

    logger.error({ error, source }, 'CaptureClient error');
  });
}

function ensureVideoDBPatched(): void {
  if (!app.isPackaged) return;
  try {
    applyVideoDBPatches();
  } catch (error) {
    logger.error({ error }, 'Failed to apply VideoDB patches before CaptureClient usage');
  }
}

async function setupTranscriptWebSockets(
  sessionToken: string,
  apiUrl?: string
): Promise<{ micWsId: string | null; sysAudioWsId: string | null } | null> {
  try {
    if (!sessionToken) {
      logger.warn('[WS] No session token');
      return null;
    }

    const connectOptions: { sessionToken: string; baseUrl?: string } = { sessionToken };
    if (apiUrl) {
      connectOptions.baseUrl = apiUrl;
    }
    const videodbConnection = connect(connectOptions);

    const [micWsResult, sysWsResult] = await Promise.all([
      (async () => {
        try {
          const wsConnection = await videodbConnection.connectWebsocket();
          micWebSocket = await wsConnection.connect();
          logger.info({ connectionId: micWebSocket.connectionId }, '[WS] Mic WebSocket connected');
          return { ws: micWebSocket, id: micWebSocket.connectionId || null };
        } catch (err) {
          logger.error({ error: err }, '[WS] Failed to create mic WebSocket');
          return { ws: null, id: null };
        }
      })(),
      (async () => {
        try {
          const wsConnection = await videodbConnection.connectWebsocket();
          sysAudioWebSocket = await wsConnection.connect();
          logger.info({ connectionId: sysAudioWebSocket.connectionId }, '[WS] SysAudio WebSocket connected');
          return { ws: sysAudioWebSocket, id: sysAudioWebSocket.connectionId || null };
        } catch (err) {
          logger.error({ error: err }, '[WS] Failed to create sys_audio WebSocket');
          return { ws: null, id: null };
        }
      })(),
    ]);

    if (!micWsResult.id && !sysWsResult.id) {
      logger.error('[WS] Failed to create any WebSocket connections');
      return null;
    }

    transcriptListenerActive = true;
    if (micWsResult.ws) listenForMessages(micWsResult.ws, 'mic');
    if (sysWsResult.ws) listenForMessages(sysWsResult.ws, 'system_audio');

    return { micWsId: micWsResult.id, sysAudioWsId: sysWsResult.id };
  } catch (err) {
    logger.error({ error: err }, '[WS] Error setting up WebSockets');
    return null;
  }
}

async function listenForMessages(ws: WebSocketConnection, source: 'mic' | 'system_audio'): Promise<void> {
  try {
    for await (const msg of ws.receive()) {
      if (!transcriptListenerActive) break;

      const channel = (msg.channel || msg.type || msg.event_type || 'event') as string;

      if (channel === 'transcript' || msg.text) {
        const msgData = msg.data as Record<string, unknown>;
        const text = (msgData.text || msg.text || '') as string;
        const isFinal = (msgData.is_final ?? msg.is_final ?? msg.isFinal ?? false) as boolean;
      const start = (msgData.start ?? msg.start) as number;
      const end = (msgData.end ?? msg.end) as number;

      if (isFinal) {
        }

        const transcriptEvent: TranscriptEvent = {
          text,
          isFinal,
          source,
          start,
          end,
        };

        sendRecorderEvent({
          event: 'transcript',
          data: transcriptEvent,
        });
      }
    }
  } catch (err) {
    if (transcriptListenerActive) {
      logger.error({ error: err, source }, '[WS] Error in listener');
    }
  }
}

async function cleanupTranscriptWebSockets(): Promise<void> {
  transcriptListenerActive = false;

  if (micWebSocket) {
    try {
      await micWebSocket.close();
    } catch (e) {
      // Ignore close errors
    }
    micWebSocket = null;
  }

  if (sysAudioWebSocket) {
    try {
      await sysAudioWebSocket.close();
    } catch (e) {
      // Ignore close errors
    }
    sysAudioWebSocket = null;
  }
}

async function setupVisualIndexWebSocket(
  sessionToken: string,
  apiUrl?: string
): Promise<string | null> {
  try {
    if (!sessionToken) {
      logger.warn('[WS] No session token for visual index');
      return null;
    }

    const connectOptions: { sessionToken: string; baseUrl?: string } = { sessionToken };
    if (apiUrl) {
      connectOptions.baseUrl = apiUrl;
    }
    const videodbConnection = connect(connectOptions);

    try {
      const wsConnection = await videodbConnection.connectWebsocket();
      screenWebSocket = await wsConnection.connect();
      logger.info({ connectionId: screenWebSocket.connectionId }, '[WS] Screen WebSocket connected for visual indexing');

      visualIndexListenerActive = true;
      listenForVisualIndexMessages(screenWebSocket);

      return screenWebSocket.connectionId || null;
    } catch (err) {
      logger.error({ error: err }, '[WS] Failed to create screen WebSocket');
      return null;
    }
  } catch (err) {
    logger.error({ error: err }, '[WS] Error setting up visual index WebSocket');
    return null;
  }
}

async function listenForVisualIndexMessages(ws: WebSocketConnection): Promise<void> {
  const normalizeVisualIndexText = (raw: string): string => {
    const sanitized = (value: string) => value
      .replace(/\*\*/g, '')
      .replace(/__+/g, '')
      .replace(/`+/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const fromJson = (value: string): string | null => {
      const tryParse = (input: string): string | null => {
        try {
          const parsed = JSON.parse(input) as unknown;

          if (typeof parsed === 'string') {
            // If the string itself contains chess board tags, return it as-is
            // so the FEN parser can work on the structured content.
            if (/<raw_board>|<board_mapping>|<perspective>/i.test(parsed)) {
              return sanitized(parsed);
            }
            return sanitized(parsed);
          }

          if (Array.isArray(parsed) && parsed.length > 0) {
            const first = parsed[0] as Record<string, unknown>;

            // If any field contains chess XML tags, return raw field content
            // so the FEN parser can extract <raw_board> / <board_mapping>.
            for (const key of ['tip', 'analysis', 'heading_tip']) {
              const val = typeof first[key] === 'string' ? (first[key] as string) : '';
              if (/<raw_board>|<board_mapping>|<perspective>/i.test(val)) {
                return sanitized(val);
              }
            }

            const headingTip = typeof first?.heading_tip === 'string' ? first.heading_tip : '';
            const tip = typeof first?.tip === 'string' ? first.tip : '';
            const analysis = typeof first?.analysis === 'string' ? first.analysis : '';
            const fen = typeof first?.fen === 'string' ? `FEN: ${first.fen}` : '';
            const san = typeof first?.san === 'string' ? `SAN: ${first.san}` : '';
            const move = typeof first?.move === 'string' ? `Move: ${first.move}` : '';
            const evalScore = typeof first?.eval === 'number' ? `Eval: ${first.eval}` : '';
            const continuation = Array.isArray(first?.continuationArr)
              ? `Continuation: ${(first.continuationArr as unknown[]).filter((m) => typeof m === 'string').join(' ')}`
              : '';
            const combined = [headingTip, tip, analysis, fen, san, move, evalScore, continuation].filter(Boolean).join(' ||| ');
            return combined ? sanitized(combined) : null;
          }

          if (parsed && typeof parsed === 'object') {
            const data = parsed as Record<string, unknown>;

            // If any field contains chess XML tags, return raw field content
            for (const key of ['tip', 'analysis', 'heading_tip']) {
              const val = typeof data[key] === 'string' ? (data[key] as string) : '';
              if (/<raw_board>|<board_mapping>|<perspective>/i.test(val)) {
                return sanitized(val);
              }
            }

            const headingTip = typeof data.heading_tip === 'string' ? data.heading_tip : '';
            const tip = typeof data.tip === 'string' ? data.tip : '';
            const analysis = typeof data.analysis === 'string' ? data.analysis : '';
            const fen = typeof data.fen === 'string' ? `FEN: ${data.fen}` : '';
            const san = typeof data.san === 'string' ? `SAN: ${data.san}` : '';
            const move = typeof data.move === 'string' ? `Move: ${data.move}` : '';
            const evalScore = typeof data.eval === 'number' ? `Eval: ${data.eval}` : '';
            const continuation = Array.isArray(data.continuationArr)
              ? `Continuation: ${(data.continuationArr as unknown[]).filter((m) => typeof m === 'string').join(' ')}`
              : '';
            const combined = [headingTip, tip, analysis, fen, san, move, evalScore, continuation].filter(Boolean).join(' ||| ');
            return combined ? sanitized(combined) : null;
          }
        } catch {
          return null;
        }

        return null;
      };

      const direct = tryParse(value);
      if (direct) return direct;

      const start = value.indexOf('{');
      const end = value.lastIndexOf('}');
      if (start >= 0 && end > start) {
        const sliced = value.slice(start, end + 1);
        return tryParse(sliced);
      }

      return null;
    };

    let text = (raw || '').trim();
    if (!text) return '';

    // If the raw text contains chess board XML tags, preserve them as-is —
    // do NOT attempt JSON parsing which would strip <raw_board> / <board_mapping>.
    if (/<raw_board>|<board_mapping>|<perspective>/i.test(text)) {
      return sanitized(text);
    }

    const parsedText = fromJson(text);
    if (parsedText) return parsedText;

    return sanitized(text);
  };

  const extractEventDetectionMarker = (
    msg: WebSocketMessage,
    msgData: Record<string, unknown>,
    normalizedText: string,
    channel: string
  ): string | null => {
    const channelLower = channel.toLowerCase();
    const isDedicatedEventChannel = /^(event_detection|game_event|hud_event)$/.test(channelLower);
    const hasStructuredDetections = Array.isArray(msgData.events) || Array.isArray(msgData.detections);

    // Avoid deriving event markers from normal scene/visual narration text.
    if (!isDedicatedEventChannel && !hasStructuredDetections) {
      return null;
    }

    const tokens: string[] = [];

    const addToken = (value: unknown): void => {
      if (typeof value === 'string' && value.trim()) {
        tokens.push(value.trim().toLowerCase());
      }
    };

    addToken(channel);
    addToken(msg.event);
    addToken(msg.type);
    addToken(msg.event_type);
    addToken(msgData.event);
    addToken(msgData.type);
    addToken(msgData.event_type);
    addToken(msgData.label);
    addToken(msgData.name);
    if (isDedicatedEventChannel) {
      addToken(normalizedText);
    }

    const collectFromArray = (items: unknown): void => {
      if (!Array.isArray(items)) return;
      for (const item of items) {
        if (typeof item === 'string') {
          addToken(item);
          continue;
        }
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          addToken(obj.event);
          addToken(obj.event_type);
          addToken(obj.type);
          addToken(obj.label);
          addToken(obj.name);
          addToken(obj.class);
        }
      }
    };

    collectFromArray(msgData.events);
    collectFromArray(msgData.detections);

    const joined = tokens.join(' | ');

    return null;
  };

  try {
    for await (const msg of ws.receive()) {
      if (!visualIndexListenerActive) break;

      const channel = (msg.channel || msg.type || msg.event_type || 'event') as string;
      const msgData = (msg.data || {}) as Record<string, unknown>;
      const rawText = (msgData.text || msg.text || '') as string;
      const normalizedText = normalizeVisualIndexText(rawText);

      logger.debug(
        {
          channel,
          hasRawText: !!rawText,
          hasNormalizedText: !!normalizedText,
          rawPreview: rawText ? rawText.substring(0, 120) : '',
          normalizedPreview: normalizedText ? normalizedText.substring(0, 120) : '',
        },
        '[WS] Visual websocket message received'
      );

      const marker = extractEventDetectionMarker(msg, msgData, normalizedText, channel);

      if (marker) {
        const now = Date.now();
        const markerEvent: VisualIndexEvent = {
          text: marker,
          start: (msgData.start ?? msg.start ?? now) as number,
          end: (msgData.end ?? msg.end ?? now) as number,
          rtstreamId: (msg.rtstream_id || msg.rtstreamId) as string | undefined,
          rtstreamName: (msg.rtstream_name || msg.rtstreamName) as string | undefined,
        };

        logger.info({ channel, marker }, '[WS] VideoDB event detection marker received');
        sendRecorderEvent({ event: 'visual_index', data: markerEvent });

        try {
          getLiveAssistService().addVisualIndex(marker);
          logger.debug({ marker }, '[WS] Forwarded event marker to live assist service');
        } catch (error) {
          logger.warn({ error, marker }, '[WS] Failed to forward event marker to live assist service');
        }

        // For dedicated event-detection channels, marker is sufficient and avoids duplicate noise.
        if (channel === 'event_detection' || channel === 'game_event' || channel === 'hud_event') {
          continue;
        }
      }

      // Listen for scene/visual index events (SDK channel names can vary by version)
      const normalizedChannel = channel.toLowerCase();
      const isVisualIndexChannel =
        normalizedChannel === 'scene_index' ||
        normalizedChannel === 'visual_index' ||
        normalizedChannel.includes('scene_index') ||
        normalizedChannel.includes('visual_index') ||
        (normalizedChannel.includes('scene') && normalizedChannel.includes('index')) ||
        (normalizedChannel.includes('visual') && normalizedChannel.includes('index'));
      const isDedicatedEventChannel =
        normalizedChannel === 'event_detection' ||
        normalizedChannel === 'game_event' ||
        normalizedChannel === 'hud_event';
      const hasNarrativeVisualPayload = normalizedText.length >= 16;
      const shouldForwardVisualText =
        hasNarrativeVisualPayload && (isVisualIndexChannel || !isDedicatedEventChannel);

      if (shouldForwardVisualText) {
        const text = normalizedText;
        const now = Date.now();
        const start = (msgData.start ?? msg.start ?? now) as number;
        const end = (msgData.end ?? msg.end ?? start) as number;

        const visualIndexEvent: VisualIndexEvent = {
          text,
          start,
          end,
          rtstreamId: (msg.rtstream_id || msg.rtstreamId) as string | undefined,
          rtstreamName: (msg.rtstream_name || msg.rtstreamName) as string | undefined,
        };

        logger.info(
          {
            channel,
            forwardedVia: isVisualIndexChannel ? 'channel-match' : 'payload-fallback',
            text: text.substring(0, 50),
          },
          '[WS] Visual index event received'
        );

        sendRecorderEvent({
          event: 'visual_index',
          data: visualIndexEvent,
        });

        try {
          getLiveAssistService().addVisualIndex(text);
          logger.debug({ preview: text.substring(0, 120) }, '[WS] Forwarded visual index text to live assist service');
        } catch (error) {
          logger.warn({ error, preview: text.substring(0, 120) }, '[WS] Failed to forward visual index text to live assist service');
        }

        // Also send to floating widget
        const compactText = text.replace(/\s+/g, ' ').trim();
        updateWidgetVisualAnalysis(compactText);
      } else {
        logger.debug(
          {
            channel,
            isVisualIndexChannel,
            isDedicatedEventChannel,
            hasNarrativeVisualPayload,
            hasNormalizedText: !!normalizedText,
            normalizedPreview: normalizedText ? normalizedText.substring(0, 120) : '',
          },
          '[WS] Visual message not forwarded'
        );
      }
    }
  } catch (err) {
    if (visualIndexListenerActive) {
      logger.error({ error: err }, '[WS] Error in visual index listener');
    }
  }
}

async function cleanupVisualIndexWebSocket(): Promise<void> {
  visualIndexListenerActive = false;

  if (screenWebSocket) {
    try {
      await screenWebSocket.close();
    } catch (e) {
      // Ignore close errors
    }
    screenWebSocket = null;
  }
}

export function setMainWindow(window: BrowserWindow): void {
  mainWindow = window;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function sendToRenderer(channel: string, data: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function sendRecorderEvent(event: RecorderEvent): void {
  sendToRenderer('recorder-event', event);
}

// Set up event listeners with stored references to prevent memory leaks
function setupCaptureEventListeners(): void {
  if (!captureClient) return;

  captureEventHandlers['recording:started'] = () => {
    logger.info('Recording started');
    sendRecorderEvent({ event: 'recording:started' });
  };

  captureEventHandlers['recording:stopped'] = () => {
    logger.info('Recording stopped');
    sendRecorderEvent({ event: 'recording:stopped' });
  };

  captureEventHandlers['recording:error'] = (error: unknown) => {
    logger.error({ error }, 'Recording error');
    sendRecorderEvent({ event: 'recording:error', data: error });
  };

  captureEventHandlers['upload:progress'] = (progress: unknown) => {
    sendRecorderEvent({ event: 'upload:progress', data: progress });
  };

  captureEventHandlers['upload:complete'] = (data: unknown) => {
    logger.info('Upload complete');
    sendRecorderEvent({ event: 'upload:complete', data });
  };

  captureEventHandlers['error'] = (error: unknown) => {
    logger.error({ error }, 'CaptureClient error');
    sendRecorderEvent({ event: 'error', data: error });
  };

  captureClient.on('recording:started', captureEventHandlers['recording:started']);
  captureClient.on('recording:stopped', captureEventHandlers['recording:stopped']);
  captureClient.on('recording:error', captureEventHandlers['recording:error']);
  captureClient.on('upload:progress', captureEventHandlers['upload:progress']);
  captureClient.on('upload:complete', captureEventHandlers['upload:complete']);
  captureClient.on('error', captureEventHandlers['error']);
}

function removeCaptureEventListeners(): void {
  if (!captureClient) return;

  // Cast to access EventEmitter methods not in CaptureClient's type definition
  const emitter = captureClient as unknown as {
    removeListener: (event: string, listener: (...args: unknown[]) => void) => void;
  };

  if (captureEventHandlers['recording:started']) {
    emitter.removeListener('recording:started', captureEventHandlers['recording:started']);
  }
  if (captureEventHandlers['recording:stopped']) {
    emitter.removeListener('recording:stopped', captureEventHandlers['recording:stopped']);
  }
  if (captureEventHandlers['recording:error']) {
    emitter.removeListener('recording:error', captureEventHandlers['recording:error']);
  }
  if (captureEventHandlers['upload:progress']) {
    emitter.removeListener('upload:progress', captureEventHandlers['upload:progress']);
  }
  if (captureEventHandlers['upload:complete']) {
    emitter.removeListener('upload:complete', captureEventHandlers['upload:complete']);
  }
  if (captureEventHandlers['error']) {
    emitter.removeListener('error', captureEventHandlers['error']);
  }

  Object.keys(captureEventHandlers).forEach((key) => {
    delete captureEventHandlers[key as keyof typeof captureEventHandlers];
  });
}

// Function to stop recording (used by widget and IPC handler)
async function stopRecordingInternal(): Promise<{ success: boolean; error?: string }> {
  if (captureStopInFlight) {
    logger.warn('Stop recording requested while stop is already in progress');
    return { success: true };
  }

  captureStopInFlight = true;
  logger.info('Stopping recording (internal)');

  // Stop the direct screenshot FEN extraction loop immediately
  getChessScreenshotService().stop();

  let stopEventSent = false;
  const emitRecordingStoppedOnce = () => {
    if (stopEventSent) return;
    stopEventSent = true;
    sendRecorderEvent({
      event: 'recording:stopped',
      data: {},
    });
  };

  // Emit immediately so renderer exits "recording" state even if SDK stop/shutdown is slow.
  emitRecordingStoppedOnce();

  // Capture session info before cleanup
  const sessionIdForPoller = currentSessionId;
  const apiKeyForPoller = currentApiKey;
  const accessTokenForPoller = currentAccessToken;
  const apiUrlForPoller = currentApiUrl;
  const collectionIdForPoller = currentCollectionId;

  if (sessionIdForPoller) {
    updateRecordingBySessionId(sessionIdForPoller, {
      status: 'processing',
    });
  }

  try {
    if (captureClient) {
      removeCaptureEventListeners();

      await captureClient.stopSession();
      logger.info('Capture session stopped');

      await captureClient.shutdown();
      logger.info('CaptureClient shutdown complete');
      captureClient = null;

      // Ensure stop event is emitted (idempotent helper avoids duplicates)
      emitRecordingStoppedOnce();

      // Manually emit upload:complete
      sendRecorderEvent({
        event: 'upload:complete',
        data: {},
      });

      // Close the floating widget window
      clearWidgetState();
      closeWidgetWindow();
    } else {
      logger.warn('No active capture client to stop');

      // Still notify renderer so UI exits recording/analysis state.
      emitRecordingStoppedOnce();
      sendRecorderEvent({
        event: 'upload:complete',
        data: {},
      });

      clearWidgetState();
      closeWidgetWindow();
    }

    await cleanupTranscriptWebSockets();
    await cleanupVisualIndexWebSocket();
    await cleanupSessionWebSocket();

    // Start export poller to detect when video is ready
    if (sessionIdForPoller && apiKeyForPoller && accessTokenForPoller) {
      logger.info({ sessionId: sessionIdForPoller, collectionId: collectionIdForPoller }, 'Starting export poller');
      startExportPoller(
        sessionIdForPoller,
        apiKeyForPoller,
        accessTokenForPoller,
        apiUrlForPoller,
        collectionIdForPoller || undefined
      );
    } else {
      logger.warn('Missing session info for export poller');
    }

    // Clear stored session info
    currentSessionId = null;
    currentApiKey = null;
    currentAccessToken = null;
    currentApiUrl = undefined;
    currentCollectionId = null;

    return { success: true };
  } catch (error) {
    logger.error({ error }, 'Failed to stop recording');

    // Ensure UI is not left in recording/analysis state on stop failure.
    emitRecordingStoppedOnce();
    sendRecorderEvent({
      event: 'upload:complete',
      data: {},
    });

    clearWidgetState();
    closeWidgetWindow();

    await cleanupTranscriptWebSockets();
    await cleanupVisualIndexWebSocket();
    await cleanupSessionWebSocket();
    cleanupCapture();

    // Clear stored session info on error too
    currentSessionId = null;
    currentApiKey = null;
    currentAccessToken = null;
    currentApiUrl = undefined;
    currentCollectionId = null;

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    captureStopInFlight = false;
  }
}

export function setupCaptureHandlers(): void {
  // Register widget recording controls
  setWidgetRecordingControls(
    // pause
    async () => {
      if (captureClient) {
        await captureClient.pauseTracks(['mic', 'system_audio', 'screen'] as ('mic' | 'system_audio' | 'screen')[]);
      }
    },
    // resume
    async () => {
      if (captureClient) {
        await captureClient.resumeTracks(['mic', 'system_audio', 'screen'] as ('mic' | 'system_audio' | 'screen')[]);
      }
    },
    // stop
    async () => {
      await stopRecordingInternal();
    },
    // muteMic
    async () => {
      if (captureClient) {
        await captureClient.pauseTracks(['mic'] as ('mic' | 'system_audio' | 'screen')[]);
      }
    },
    // unmuteMic
    async () => {
      if (captureClient) {
        await captureClient.resumeTracks(['mic'] as ('mic' | 'system_audio' | 'screen')[]);
      }
    }
  );

  ipcMain.handle(
    'recorder-start-recording',
    async (
      _event,
      params: StartRecordingParams
    ): Promise<{
      success: boolean;
      sessionId?: string;
      error?: string;
      micWsConnectionId?: string;
      sysAudioWsConnectionId?: string;
      screenWsConnectionId?: string;
    }> => {
      const { config, sessionToken, accessToken, apiUrl, enableTranscription, enableVisualIndex } = params;

      if (captureStartInFlight) {
        logger.warn('Start recording requested while a capture start is already in progress');
        return {
          success: false,
          error: 'Recorder is already starting. Please try again in a moment.',
        };
      }

      captureStartInFlight = true;

      logger.info({ sessionId: config.sessionId, enableTranscription }, 'Starting recording - IPC handler called');

      const user = getUserByAccessToken(accessToken);
      if (!user?.apiKey) {
        logger.error({ hasUser: Boolean(user) }, 'Missing VideoDB API key for capture session');
        captureStartInFlight = false;
        return {
          success: false,
          error: 'Missing VideoDB API key for capture session. Please re-authenticate.',
        };
      }

      // Preflight: confirm the session belongs to this API key (avoids 403 Unauthorized access to session)
      try {
        const conn = apiUrl
          ? connect({ apiKey: user.apiKey, baseUrl: apiUrl })
          : connect({ apiKey: user.apiKey });
        await conn.getCaptureSession(config.sessionId);
      } catch (preflightError) {
        const message = preflightError instanceof Error ? preflightError.message : String(preflightError);
        logger.error(
          { err: preflightError, sessionId: config.sessionId, apiUrl },
          'Capture session preflight failed (unauthorized or not found)'
        );
        captureStartInFlight = false;
        return {
          success: false,
          error: `Capture session unauthorized or not found. Regenerate the session and try again. (${message})`,
        };
      }

      try {
        // Set up session WebSocket for capture_session events (informational logging)
        const sessionWsId = await setupSessionWebSocket(sessionToken, apiUrl);
        if (sessionWsId) {
          logger.info({ sessionWsId }, '[WS] Session WebSocket connected for capture events');
        }

        let wsConnectionIds: { micWsId: string | null; sysAudioWsId: string | null } | null = null;
        if (enableTranscription) {
          wsConnectionIds = await setupTranscriptWebSockets(sessionToken, apiUrl);
          if (wsConnectionIds) {
            logger.info(
              { micWsId: wsConnectionIds.micWsId, sysAudioWsId: wsConnectionIds.sysAudioWsId },
              '[WS] WebSocket connections established'
            );
          }
        }

        // Set up visual index WebSocket for screen capture
        let screenWsConnectionId: string | null = null;
        if (enableVisualIndex && config.streams?.screen !== false) {
          screenWsConnectionId = await setupVisualIndexWebSocket(sessionToken, apiUrl);
          if (screenWsConnectionId) {
            logger.info({ screenWsId: screenWsConnectionId }, '[WS] Visual index WebSocket established');
          }
        }

        // Reuse existing client when available to avoid duplicate recorder instances
        if (!captureClient) {
          ensureVideoDBPatched();
          logger.info('Creating new CaptureClient');
          captureClient = new CaptureClient({
            sessionToken,
            ...(apiUrl && { apiUrl }),
            restartOnError: false,
          });
          // Attach immediately so SDK "error" events never go unhandled
          attachCaptureErrorGuard(captureClient, 'start-recording');
        } else {
          logger.info('Reusing existing CaptureClient for start recording');
        }

        // Set up event listeners BEFORE listing channels (Python pattern)
        removeCaptureEventListeners();
        setupCaptureEventListeners();

        let captureChannels: Array<{
          channelId: string;
          type: 'audio' | 'video';
          record: boolean;
          store?: boolean;
          transcript?: boolean;
        }> = [];
        
        try {
          logger.info('Listing available channels');
          const channels = await captureClient.listChannels();
          logger.info({ channelCount: channels.all().length }, 'Channels listed successfully');

          const allChannels = channels.all();
          logger.info(
            {
              audioChannels: allChannels
                .filter((ch) => ch.type === 'audio')
                .map((ch) => ({ id: ch.id, name: ch.name })),
              systemAudioChannels: channels.systemAudio.map((ch) => ({ id: ch.id, name: ch.name })),
              micChannels: channels.mics.map((ch) => ({ id: ch.id, name: ch.name })),
              displayChannels: channels.displays.map((ch) => ({ id: ch.id, name: ch.name })),
            },
            'Capture channel inventory'
          );

          const micChannel = channels.mics.default || channels.mics[0];
          if (micChannel && config.streams?.microphone !== false) {
            captureChannels.push({
              channelId: micChannel.id,
              type: 'audio',
              record: true,
              store: true,
              transcript: enableTranscription,
            });
          } else if (config.streams?.microphone !== false) {
            logger.warn({ micCount: channels.mics.length }, 'Microphone stream enabled but no mic channel available');
          }

          if (config.streams?.systemAudio !== false) {
            const systemAudioCandidates: Array<{ id: string; name: string }> = [];

            const pushCandidate = (id: string, name: string) => {
              if (!id || id === micChannel?.id) return;
              if (systemAudioCandidates.some((c) => c.id === id)) return;
              systemAudioCandidates.push({ id, name });
            };

            // Prefer SDK system-audio list first.
            for (const ch of channels.systemAudio) {
              pushCandidate(ch.id, ch.name);
            }

            // On Windows, capture can surface loopback on generic audio channels.
            if (process.platform === 'win32') {
              for (const ch of allChannels) {
                if (ch.type !== 'audio') continue;
                if (/system|loopback|speaker|output|desktop|headphone|what\s*u\s*hear|stereo\s*mix|virtual\s*audio/i.test(`${ch.id} ${ch.name}`)) {
                  pushCandidate(ch.id, ch.name);
                }
              }
            }

            if (systemAudioCandidates.length > 0) {
              systemAudioCandidates.forEach((candidate, index) => {
                captureChannels.push({
                  channelId: candidate.id,
                  type: 'audio',
                  record: true,
                  store: true,
                  transcript: enableTranscription && index === 0,
                });
              });

              logger.info(
                { selectedSystemAudioChannels: systemAudioCandidates },
                'Selected system-audio capture candidates'
              );
            } else {
            logger.warn(
              {
                systemAudioCount: channels.systemAudio.length,
                audioChannels: allChannels
                  .filter((ch) => ch.type === 'audio')
                  .map((ch) => ({ id: ch.id, name: ch.name })),
              },
              'System audio stream enabled but no system-audio channel available; using explicit system_audio fallback'
            );

            captureChannels.push({
              channelId: 'system_audio',
              type: 'audio',
              record: true,
              store: true,
              transcript: enableTranscription,
            });
            }
          }

          const displayChannel = channels.displays.default || channels.displays[0];
          if (displayChannel && config.streams?.screen !== false) {
            captureChannels.push({
              channelId: displayChannel.id,
              type: 'video',
              record: true,
              store: true,
            });
          } else if (config.streams?.screen !== false) {
            logger.warn({ displayCount: channels.displays.length }, 'Screen stream enabled but no display channel available');
          }

          // Windows loopback audio can require an active display capture channel.
          // If user enabled system audio but disabled screen, attach a display channel anyway.
          const hasSystemAudioChannel = captureChannels.some(
            (ch) => ch.type === 'audio' && /system[_-]?audio|loopback|speaker|output|desktop/i.test(ch.channelId)
          );
          const hasDisplayChannel = captureChannels.some((ch) => ch.type === 'video');
          const wantsSystemAudio = config.streams?.systemAudio !== false;
          const screenDisabled = config.streams?.screen === false;

          if (
            process.platform === 'win32' &&
            wantsSystemAudio &&
            screenDisabled &&
            hasSystemAudioChannel &&
            !hasDisplayChannel &&
            displayChannel
          ) {
            captureChannels.push({
              channelId: displayChannel.id,
              type: 'video',
              record: true,
              store: true,
            });
            logger.info(
              { displayChannelId: displayChannel.id },
              'Added display channel automatically on Windows to support system audio loopback'
            );
          }

          logger.info({ captureChannels }, 'Channel configs prepared from listed channels');
        } catch (listError) {
          logger.warn({ error: listError }, 'listChannels failed, using fallback channel IDs');
          
          if (config.streams?.microphone !== false) {
            captureChannels.push({ channelId: 'mic', type: 'audio', record: true, store: true, transcript: enableTranscription });
          }
          if (config.streams?.systemAudio !== false) {
            captureChannels.push({ channelId: 'system_audio', type: 'audio', record: true, store: true, transcript: enableTranscription });
          }
          if (config.streams?.screen !== false) {
            captureChannels.push({ channelId: 'screen', type: 'video', record: true, store: true });
          }
          
          logger.info({ captureChannels }, 'Using fallback channel IDs');
        }

        if (captureChannels.length === 0) {
          throw new Error('No capture channels available. Check permissions.');
        }

        logger.info({ captureChannels }, 'Starting capture with channels');
        try {
          await captureClient.startSession({
            sessionId: config.sessionId,
            channels: captureChannels,
          });
          logger.info({ sessionId: config.sessionId }, 'Capture session started');
        } catch (captureError) {
          const msg = captureError instanceof Error ? captureError.message : String(captureError);
          const stack = captureError instanceof Error ? captureError.stack : undefined;
          logger.error({ err: captureError, message: msg, stack }, 'CaptureClient.startSession failed');
          throw captureError;
        }

        // Manually emit recording:started immediately (matches Python behavior, doesn't wait for SDK event)
        logger.info({ sessionId: config.sessionId }, 'Emitting recording:started event to renderer');
        sendRecorderEvent({
          event: 'recording:started',
          data: { sessionId: config.sessionId },
        });
        logger.info({ sessionId: config.sessionId }, 'recording:started event emitted');

        // Show the floating widget window and update its state
        updateWidgetSessionState({
          isRecording: true,
          isPaused: false,
          startTime: Date.now(),
          gameId: params.gameId || '',
        });
        showWidgetWindow();

        // Start the direct screenshot→LiteLLM FEN extraction loop.
        // This is the benchmark-proven path (98.61% accuracy) that calls
        // gpt-5.4 directly with a base64 screenshot, bypassing the VideoDB
        // text pipeline which strips the <raw_board> XML tags.
        // TO SWITCH TO VIDEODB: comment out these two lines and change
        // modelName in visual-index.ts to 'gpt-5.4' when supported.
        const chessFenPrompt = getGameIndexingPrompt(params.gameId || 'chess');
        getChessScreenshotService().start(chessFenPrompt);

        // Store session info for export polling when recording stops
        currentSessionId = config.sessionId;
        currentAccessToken = accessToken;
        currentApiUrl = apiUrl;

        // Get API key and collection ID from user record for export polling
        currentApiKey = user?.apiKey || null;
        currentCollectionId = user?.collectionId || null;

        return {
          success: true,
          sessionId: config.sessionId,
          micWsConnectionId: wsConnectionIds?.micWsId || undefined,
          sysAudioWsConnectionId: wsConnectionIds?.sysAudioWsId || undefined,
          screenWsConnectionId: screenWsConnectionId || undefined,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorStack = error instanceof Error ? error.stack : undefined;
        logger.error({ err: error, errorMessage, errorStack }, 'Failed to start recording');
        await cleanupTranscriptWebSockets();
        await cleanupVisualIndexWebSocket();
        await cleanupSessionWebSocket();
        await cleanupCaptureAsync();
        return {
          success: false,
          error: errorMessage,
        };
      } finally {
        captureStartInFlight = false;
      }
    }
  );

  ipcMain.handle(
    'recorder-stop-recording',
    async (): Promise<{ success: boolean; error?: string }> => {
      logger.info('Stopping recording via IPC');
      return stopRecordingInternal();
    }
  );

  ipcMain.handle(
    'recorder-pause-tracks',
    async (_event, tracks: string[]): Promise<void> => {
      if (captureClient) {
        await captureClient.pauseTracks(tracks as ('mic' | 'system_audio' | 'screen')[]);
      }
    }
  );

  ipcMain.handle(
    'recorder-resume-tracks',
    async (_event, tracks: string[]): Promise<void> => {
      if (captureClient) {
        await captureClient.resumeTracks(tracks as ('mic' | 'system_audio' | 'screen')[]);
      }
    }
  );

  ipcMain.handle(
    'recorder-list-channels',
    async (_event, sessionToken: string, apiUrl?: string): Promise<Channel[]> => {
      logger.info('recorder-list-channels IPC handler called');
      
      // Reuse existing captureClient to prevent "Another recorder instance" error
      if (!captureClient) {
        logger.info('Creating CaptureClient for listing channels');
        ensureVideoDBPatched();
        captureClient = new CaptureClient({
          sessionToken,
          ...(apiUrl && { apiUrl }),
          restartOnError: false,
        });

        // Set up error guard immediately (required for SDK to function properly)
        attachCaptureErrorGuard(captureClient, 'list-channels');
        
        logger.info('CaptureClient created, calling listChannels...');
      } else {
        logger.info('Reusing existing CaptureClient for listing channels');
      }

      try {
        logger.info('Calling captureClient.listChannels()...');
        
        const listChannelsWithTimeout = async (timeoutMs: number = 30000) => {
          return Promise.race([
            captureClient!.listChannels(),
            new Promise<never>((_, reject) => 
              setTimeout(() => reject(new Error(`listChannels timed out after ${timeoutMs}ms`)), timeoutMs)
            )
          ]);
        };
        
        const channels = await listChannelsWithTimeout(30000);
        const allChannels = channels.all();
        logger.info({ channelCount: allChannels.length, channels: allChannels }, 'listChannels returned');
        return allChannels.map((ch) => ({
          channelId: ch.id,
          type: ch.type as 'audio' | 'video',
          name: ch.name,
        }));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorCode = errorMessage.includes('exited') ? errorMessage.match(/\d+/)?.[0] : undefined;

        logger.error(
          { error, errorMessage, errorCode },
          'Failed to list channels - this may indicate a binary execution issue'
        );

        if (captureClient) {
          try {
            await captureClient.shutdown();
          } catch (e) {
            // Ignore shutdown errors during cleanup
          }
          captureClient = null;
        }

        const detailedError = new Error(
          `Failed to list recording channels: ${errorMessage}` +
            (errorCode === '101' ? '. This may be a binary compatibility issue - check if the recorder binary matches your system architecture.' : '')
        );
        throw detailedError;
      }
    }
  );
}

// Cleanup capture client for synchronous cleanup (doesn't wait for shutdown)
function cleanupCapture(): void {
  if (captureClient) {
    removeCaptureEventListeners();

    const client = captureClient;
    captureClient = null;

    client.shutdown().catch((error) => {
      logger.warn({ error }, 'Error shutting down CaptureClient during cleanup');
    });
  }
}

// Async cleanup that waits for shutdown to complete (for tests or external cleanup)
export async function cleanupCaptureAsync(): Promise<void> {
  if (captureClient) {
    removeCaptureEventListeners();

    const client = captureClient;
    captureClient = null;

    try {
      await client.shutdown();
      logger.info('CaptureClient shutdown completed');
    } catch (error) {
      logger.warn({ error }, 'Error during async CaptureClient shutdown');
    }
  }
}

export async function shutdownCaptureClient(): Promise<void> {
  await cleanupTranscriptWebSockets();
  await cleanupVisualIndexWebSocket();
  await cleanupSessionWebSocket();

  // Stop all export pollers
  stopAllExportPollers();

  // Clear session tracking
  currentSessionId = null;
  currentApiKey = null;
  currentAccessToken = null;
  currentApiUrl = undefined;
  currentCollectionId = null;

  if (captureClient) {
    logger.info('Shutting down CaptureClient before app quit');

    removeCaptureEventListeners();

    const client = captureClient;
    captureClient = null;

    try {
      await client.stopSession();
    } catch (error) {
      logger.warn({ error }, 'Error stopping capture session during shutdown');
    }
    try {
      await client.shutdown();
    } catch (error) {
      logger.warn({ error }, 'Error shutting down CaptureClient during shutdown');
    }
    logger.info('CaptureClient shutdown complete');
  }
}

export function isCaptureActive(): boolean {
  return captureClient !== null;
}
