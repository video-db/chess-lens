import { connect } from 'videodb';
import type { WebSocketConnection } from 'videodb';
import type { RecorderEvent, TranscriptEvent, VisualIndexEvent } from '../../shared/types/ipc.types';
import { createChildLogger } from '../lib/logger';
import { extractEventDetectionMarker, normalizeVisualIndexText } from '../lib/vision/visual-index-message';
import { getLiveAssistService } from '../services/live-assist.service';
import { updateWidgetVisualAnalysis } from './widget';

const logger = createChildLogger('ipc-capture-websockets');

type EmitRecorderEvent = (event: RecorderEvent) => void;

export class CaptureWebSocketManager {
  private micWebSocket: WebSocketConnection | null = null;
  private sysAudioWebSocket: WebSocketConnection | null = null;
  private screenWebSocket: WebSocketConnection | null = null;
  private transcriptListenerActive = false;
  private visualIndexListenerActive = false;

  constructor(private readonly emitRecorderEvent: EmitRecorderEvent) {}

  async setupTranscriptWebSockets(
    sessionToken: string,
    apiUrl?: string,
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
            this.micWebSocket = await wsConnection.connect();
            logger.info({ connectionId: this.micWebSocket.connectionId }, '[WS] Mic WebSocket connected');
            return { ws: this.micWebSocket, id: this.micWebSocket.connectionId || null };
          } catch (err) {
            logger.error({ error: err }, '[WS] Failed to create mic WebSocket');
            return { ws: null, id: null };
          }
        })(),
        (async () => {
          try {
            const wsConnection = await videodbConnection.connectWebsocket();
            this.sysAudioWebSocket = await wsConnection.connect();
            logger.info({ connectionId: this.sysAudioWebSocket.connectionId }, '[WS] SysAudio WebSocket connected');
            return { ws: this.sysAudioWebSocket, id: this.sysAudioWebSocket.connectionId || null };
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

      this.transcriptListenerActive = true;
      if (micWsResult.ws) void this.listenForMessages(micWsResult.ws, 'mic');
      if (sysWsResult.ws) void this.listenForMessages(sysWsResult.ws, 'system_audio');

      return { micWsId: micWsResult.id, sysAudioWsId: sysWsResult.id };
    } catch (err) {
      logger.error({ error: err }, '[WS] Error setting up WebSockets');
      return null;
    }
  }

  async cleanupTranscriptWebSockets(): Promise<void> {
    this.transcriptListenerActive = false;
    this.micWebSocket = await this.closeWebSocket(this.micWebSocket);
    this.sysAudioWebSocket = await this.closeWebSocket(this.sysAudioWebSocket);
  }

  async setupVisualIndexWebSocket(sessionToken: string, apiUrl?: string): Promise<string | null> {
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
        this.screenWebSocket = await wsConnection.connect();
        logger.info({ connectionId: this.screenWebSocket.connectionId }, '[WS] Screen WebSocket connected for visual indexing');

        this.visualIndexListenerActive = true;
        void this.listenForVisualIndexMessages(this.screenWebSocket);

        return this.screenWebSocket.connectionId || null;
      } catch (err) {
        logger.error({ error: err }, '[WS] Failed to create screen WebSocket');
        return null;
      }
    } catch (err) {
      logger.error({ error: err }, '[WS] Error setting up visual index WebSocket');
      return null;
    }
  }

  async cleanupVisualIndexWebSocket(): Promise<void> {
    this.visualIndexListenerActive = false;
    this.screenWebSocket = await this.closeWebSocket(this.screenWebSocket);
  }

  private async listenForMessages(ws: WebSocketConnection, source: 'mic' | 'system_audio'): Promise<void> {
    try {
      for await (const msg of ws.receive()) {
        if (!this.transcriptListenerActive) break;

        const channel = (msg.channel || msg.type || msg.event_type || 'event') as string;
        if (channel !== 'transcript' && !msg.text) continue;

        const msgData = msg.data as Record<string, unknown>;
        const transcriptEvent: TranscriptEvent = {
          text: (msgData.text || msg.text || '') as string,
          isFinal: (msgData.is_final ?? msg.is_final ?? msg.isFinal ?? false) as boolean,
          source,
          start: (msgData.start ?? msg.start) as number,
          end: (msgData.end ?? msg.end) as number,
        };

        this.emitRecorderEvent({
          event: 'transcript',
          data: transcriptEvent,
        });
      }
    } catch (err) {
      if (this.transcriptListenerActive) {
        logger.error({ error: err, source }, '[WS] Error in listener');
      }
    }
  }

  private async listenForVisualIndexMessages(ws: WebSocketConnection): Promise<void> {
    try {
      for await (const msg of ws.receive()) {
        if (!this.visualIndexListenerActive) break;

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
          '[WS] Visual websocket message received',
        );

        const marker = extractEventDetectionMarker(msg, msgData, normalizedText, channel);
        if (marker) {
          this.forwardEventMarker(marker, msg, msgData, channel);

          if (channel === 'event_detection' || channel === 'game_event' || channel === 'hud_event') {
            continue;
          }
        }

        this.forwardVisualTextIfUseful(normalizedText, msg, msgData, channel);
      }
    } catch (err) {
      if (this.visualIndexListenerActive) {
        logger.error({ error: err }, '[WS] Error in visual index listener');
      }
    }
  }

  private forwardEventMarker(
    marker: string,
    msg: Record<string, unknown>,
    msgData: Record<string, unknown>,
    channel: string,
  ): void {
    const now = Date.now();
    const markerEvent: VisualIndexEvent = {
      text: marker,
      start: (msgData.start ?? msg.start ?? now) as number,
      end: (msgData.end ?? msg.end ?? now) as number,
      rtstreamId: (msg.rtstream_id || msg.rtstreamId) as string | undefined,
      rtstreamName: (msg.rtstream_name || msg.rtstreamName) as string | undefined,
    };

    logger.info({ channel, marker }, '[WS] VideoDB event detection marker received');
    this.emitRecorderEvent({ event: 'visual_index', data: markerEvent });

    try {
      getLiveAssistService().addVisualIndex(marker);
      logger.debug({ marker }, '[WS] Forwarded event marker to live assist service');
    } catch (error) {
      logger.warn({ error, marker }, '[WS] Failed to forward event marker to live assist service');
    }
  }

  private forwardVisualTextIfUseful(
    normalizedText: string,
    msg: Record<string, unknown>,
    msgData: Record<string, unknown>,
    channel: string,
  ): void {
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
    const shouldForwardVisualText = hasNarrativeVisualPayload && (isVisualIndexChannel || !isDedicatedEventChannel);

    if (!shouldForwardVisualText) {
      logger.debug(
        {
          channel,
          isVisualIndexChannel,
          isDedicatedEventChannel,
          hasNarrativeVisualPayload,
          hasNormalizedText: !!normalizedText,
          normalizedPreview: normalizedText ? normalizedText.substring(0, 120) : '',
        },
        '[WS] Visual message not forwarded',
      );
      return;
    }

    const text = normalizedText;
    const now = Date.now();
    const visualIndexEvent: VisualIndexEvent = {
      text,
      start: (msgData.start ?? msg.start ?? now) as number,
      end: (msgData.end ?? msg.end ?? now) as number,
      rtstreamId: (msg.rtstream_id || msg.rtstreamId) as string | undefined,
      rtstreamName: (msg.rtstream_name || msg.rtstreamName) as string | undefined,
    };

    logger.info(
      {
        channel,
        forwardedVia: isVisualIndexChannel ? 'channel-match' : 'payload-fallback',
        text: text.substring(0, 50),
      },
      '[WS] Visual index event received',
    );

    this.emitRecorderEvent({ event: 'visual_index', data: visualIndexEvent });
    this.forwardVisualTextToLiveAssist(text);
    updateWidgetVisualAnalysis(text.replace(/\s+/g, ' ').trim());
  }

  private forwardVisualTextToLiveAssist(text: string): void {
    try {
      const hasChessFenTags = /<raw_board>|<board_mapping>/i.test(text);
      if (hasChessFenTags) {
        getLiveAssistService().addVisualIndexFen(text, 'rtstream');
        logger.debug({ preview: text.substring(0, 120) }, '[WS] Forwarded RTStream chess FEN via raw path');
      } else {
        getLiveAssistService().addVisualIndex(text);
        logger.debug({ preview: text.substring(0, 120) }, '[WS] Forwarded visual index text to live assist service');
      }
    } catch (error) {
      logger.warn({ error, preview: text.substring(0, 120) }, '[WS] Failed to forward visual index text to live assist service');
    }
  }

  private async closeWebSocket(ws: WebSocketConnection | null): Promise<null> {
    if (!ws) return null;
    try {
      await ws.close();
    } catch {
      // Ignore close errors during cleanup.
    }
    return null;
  }
}
