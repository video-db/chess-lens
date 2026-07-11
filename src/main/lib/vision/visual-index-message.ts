import type { WebSocketMessage } from 'videodb';

function sanitizeVisualText(value: string): string {
  return value
    .replace(/\*\*/g, '')
    .replace(/__+/g, '')
    .replace(/`+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeVisualIndexText(raw: string): string {
  const fromJson = (value: string): string | null => {
    const tryParse = (input: string): string | null => {
      try {
        const parsed = JSON.parse(input) as unknown;

        if (typeof parsed === 'string') {
          if (/<raw_board>|<board_mapping>|<perspective>/i.test(parsed)) {
            return sanitizeVisualText(parsed);
          }
          return sanitizeVisualText(parsed);
        }

        if (Array.isArray(parsed) && parsed.length > 0) {
          const first = parsed[0] as Record<string, unknown>;
          return extractVisualTextFromObject(first);
        }

        if (parsed && typeof parsed === 'object') {
          return extractVisualTextFromObject(parsed as Record<string, unknown>);
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
      return tryParse(value.slice(start, end + 1));
    }

    return null;
  };

  const text = (raw || '').trim();
  if (!text) return '';

  if (/<raw_board>|<board_mapping>|<perspective>/i.test(text)) {
    return sanitizeVisualText(text);
  }

  const parsedText = fromJson(text);
  return parsedText || sanitizeVisualText(text);
}

function extractVisualTextFromObject(data: Record<string, unknown>): string | null {
  for (const key of ['tip', 'analysis', 'heading_tip']) {
    const val = typeof data[key] === 'string' ? (data[key] as string) : '';
    if (/<raw_board>|<board_mapping>|<perspective>/i.test(val)) {
      return sanitizeVisualText(val);
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
  return combined ? sanitizeVisualText(combined) : null;
}

export function extractEventDetectionMarker(
  msg: WebSocketMessage,
  msgData: Record<string, unknown>,
  normalizedText: string,
  channel: string
): string | null {
  const channelLower = channel.toLowerCase();
  const isDedicatedEventChannel = /^(event_detection|game_event|hud_event)$/.test(channelLower);
  const hasStructuredDetections = Array.isArray(msgData.events) || Array.isArray(msgData.detections);

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

  // Preserve the existing behavior: event tokens are gathered for future
  // marker support, but no marker is emitted yet.
  return null;
}
