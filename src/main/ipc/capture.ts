import { ipcMain, BrowserWindow, app } from 'electron';
import { CaptureClient } from 'videodb/capture';
import { connect } from 'videodb';
import type { Channel } from '../../shared/schemas/capture.schema';
import type { RecorderEvent, StartRecordingParams } from '../../shared/types/ipc.types';
import { setupSessionWebSocket, cleanupSessionWebSocket } from '../services/session-events.service';
import { startExportPoller, stopAllExportPollers } from '../services/recording/export-poller.service';
import { createChildLogger } from '../lib/logger';
import { applyVideoDBPatches } from '../lib/videodb-patch';
import { getUserByAccessToken, updateRecordingBySessionId } from '../db';
import { getLiveAssistService } from '../services/live-assist.service';
import { getMCPInferenceService } from '../services/mcp/mcp-inference.service';
import { getChessScreenshotService } from '../services/chess/chess-screenshot.service';
import { CaptureWebSocketManager } from './capture-websockets';
import {
  buildCaptureChannelsFromListed,
  buildFallbackCaptureChannels,
  type CaptureChannelConfig,
} from './capture-channels';
import {
  showWidgetWindow,
  closeWidgetWindow,
} from '../windows/widget.window';
import {
  setWidgetRecordingControls,
  updateWidgetSessionState,
  sendWidgetStartError,
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

const captureWebSockets = new CaptureWebSocketManager(sendRecorderEvent);

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

  // Stop live assist and MCP inference immediately in the main process.
  // This is a safety net: the renderer's useLiveAssist effect also calls stop()
  // via IPC, but it fires asynchronously after a React re-render. Stopping here
  // ensures the 2-second interval and the 20-second MCP interval both halt as
  // soon as the capture pipeline stops, preventing spurious "No new gameplay
  // action feed to process" / "No recent transcript to process" debug logs.
  getLiveAssistService().stop();
  getMCPInferenceService().stop();

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

    await captureWebSockets.cleanupTranscriptWebSockets();
    await captureWebSockets.cleanupVisualIndexWebSocket();
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

    await captureWebSockets.cleanupTranscriptWebSockets();
    await captureWebSockets.cleanupVisualIndexWebSocket();
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

      // Show the overlay immediately so the user sees it as soon as capture
      // is requested — before the async setup (listChannels, startSession, etc.)
      // which can take several seconds. The widget's built-in "Connecting..."
      // status text is displayed until the session state is updated to isRecording.
      updateWidgetSessionState({
        isRecording: false,
        isPaused: false,
        startTime: null,
        gameId: params.gameId || '',
      });
      showWidgetWindow();

      const user = getUserByAccessToken(accessToken);
      if (!user?.apiKey) {
        logger.error({ hasUser: Boolean(user) }, 'Missing VideoDB API key for capture session');
        captureStartInFlight = false;
        sendWidgetStartError('Missing VideoDB API key. Please re-authenticate.');
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
        sendWidgetStartError(`Session unauthorized or not found: ${message}`);
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
          wsConnectionIds = await captureWebSockets.setupTranscriptWebSockets(sessionToken, apiUrl);
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
          screenWsConnectionId = await captureWebSockets.setupVisualIndexWebSocket(sessionToken, apiUrl);
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

        let captureChannels: CaptureChannelConfig[] = [];
        
        try {
          logger.info('Listing available channels');
          const channels = await captureClient.listChannels();
          logger.info({ channelCount: channels.all().length }, 'Channels listed successfully');
          captureChannels = buildCaptureChannelsFromListed(channels, config, enableTranscription, logger);
        } catch (listError) {
          logger.warn({ error: listError }, 'listChannels failed, using fallback channel IDs');
          captureChannels = buildFallbackCaptureChannels(config, enableTranscription);
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
        // LiveAssist prefers RTStream FEN when indexVisuals emits validated
        // <raw_board> tags. Keep the screenshot loop as a fallback during
        // RTStream warmup or outages.
        getChessScreenshotService().start();

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
        sendWidgetStartError(errorMessage);
        await captureWebSockets.cleanupTranscriptWebSockets();
        await captureWebSockets.cleanupVisualIndexWebSocket();
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
          } catch {
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
  await captureWebSockets.cleanupTranscriptWebSockets();
  await captureWebSockets.cleanupVisualIndexWebSocket();
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

