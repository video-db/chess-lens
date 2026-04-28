import { ipcMain, BrowserWindow, app } from 'electron';
import { createChildLogger } from '../lib/logger';

const logger = createChildLogger('ipc-widget');
import { getWidgetWindow, sendToWidget, closeWidgetWindow } from '../windows/widget.window';

let mainWindowRef: BrowserWindow | null = null;

export function setWidgetMainWindow(window: BrowserWindow): void {
  mainWindowRef = window;
}

let widgetSessionState = {
  isRecording: false,
  isPaused: false,
  isMicMuted: false,
  startTime: null as number | null,
  gameId: '' as string,
};

let widgetLiveAssist = {
  sayThis: [] as Array<{ id: string; text: string; timestamp: number }>,
  askThis: [] as Array<{ id: string; text: string; timestamp: number }>,
};

let widgetVisualAnalysis = {
  description: '',
};

let widgetNudge: { id: string; message: string; type: 'info' | 'warning' | 'action'; timestamp: number } | null = null;

let widgetFen: { fen: string; board: string | null; turn: 'w' | 'b' | null } | null = null;

const NON_ACTIONABLE_PATTERN = /no actionable gameplay moment(?: in this frame)?\.?/i;

function isNonActionableText(text: string): boolean {
  return NON_ACTIONABLE_PATTERN.test(text.trim());
}

function sanitizeWidgetText(text: string): string {
  const sanitized = text
    .replace(/\*\*/g, '')
    .replace(/__+/g, '')
    .replace(/`+/g, '')
    .replace(/^\s*(say|ask)\s*:\s*/i, '')
    .replace(/(No actionable gameplay moment in this frame\.\s*){2,}/gi, 'No actionable gameplay moment in this frame.')
    .replace(/\s+/g, ' ')
    .trim();

  const tryParse = (input: string): string | null => {
    try {
      const parsed = JSON.parse(input) as unknown;
      if (typeof parsed === 'string') return parsed;
      if (parsed && typeof parsed === 'object') {
        const data = parsed as Record<string, unknown>;
        const headingTip = typeof data.heading_tip === 'string' ? data.heading_tip : '';
        const tip = typeof data.tip === 'string' ? data.tip : '';
        const analysis = typeof data.analysis === 'string' ? data.analysis : '';
        const combined = [headingTip, tip, analysis].filter(Boolean).join(' ||| ').trim();
        return combined || null;
      }
    } catch {
      return null;
    }
    return null;
  };

  const parsedDirect = tryParse(sanitized);
  if (parsedDirect) {
    const compact = parsedDirect
      .replace(/\s*\|\|\|\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return isNonActionableText(compact) ? '' : parsedDirect;
  }

  const start = sanitized.indexOf('{');
  const end = sanitized.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const parsedSlice = tryParse(sanitized.slice(start, end + 1));
    if (parsedSlice) {
      const compact = parsedSlice
        .replace(/\s*\|\|\|\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return isNonActionableText(compact) ? '' : parsedSlice;
    }
  }

  return isNonActionableText(sanitized) ? '' : sanitized;
}

let pauseRecordingFn: (() => Promise<void>) | null = null;
let resumeRecordingFn: (() => Promise<void>) | null = null;
let stopRecordingFn: (() => Promise<void>) | null = null;
let muteMicFn: (() => Promise<void>) | null = null;
let unmuteMicFn: (() => Promise<void>) | null = null;
let widgetStopInFlight = false;

export function setWidgetRecordingControls(
  pause: () => Promise<void>,
  resume: () => Promise<void>,
  stop: () => Promise<void>,
  muteMic: () => Promise<void>,
  unmuteMic: () => Promise<void>
): void {
  pauseRecordingFn = pause;
  resumeRecordingFn = resume;
  stopRecordingFn = stop;
  muteMicFn = muteMic;
  unmuteMicFn = unmuteMic;
}

export function syncWidgetState(): void {
  sendToWidget('widget:session-state', widgetSessionState);
  sendToWidget('widget:live-assist', widgetLiveAssist);
  sendToWidget('widget:visual-analysis', widgetVisualAnalysis);
  sendToWidget('widget:nudge', widgetNudge);
  if (widgetFen) sendToWidget('widget:fen', widgetFen);
}

export function setupWidgetIpcHandlers(): void {
  ipcMain.handle('widget:pause', async () => {
    if (pauseRecordingFn) {
      await pauseRecordingFn();
      updateWidgetSessionState({ isPaused: true });
    }
  });

  ipcMain.handle('widget:resume', async () => {
    if (resumeRecordingFn) {
      await resumeRecordingFn();
      // If mic was muted before pause, re-mute it after resuming all tracks
      if (widgetSessionState.isMicMuted && muteMicFn) {
        await muteMicFn();
      }
      updateWidgetSessionState({ isPaused: false });
    }
  });

  ipcMain.handle('widget:stop', async () => {
    if (widgetStopInFlight) {
      logger.debug('Ignoring duplicate widget stop request (already in flight)');
      return;
    }

    widgetStopInFlight = true;
    updateWidgetSessionState({
      isRecording: false,
      isPaused: false,
    });

    if (stopRecordingFn) {
      void stopRecordingFn()
        .then(() => {
          closeWidgetWindow();
        })
        .catch((error) => {
          logger.error({ error }, 'Widget stop request failed');
        })
        .finally(() => {
          widgetStopInFlight = false;
        });

      return;
    }

    widgetStopInFlight = false;
  });

  ipcMain.handle('widget:mute-mic', async () => {
    if (muteMicFn) {
      await muteMicFn();
      updateWidgetSessionState({ isMicMuted: true });
    }
  });

  ipcMain.handle('widget:unmute-mic', async () => {
    if (unmuteMicFn) {
      await unmuteMicFn();
      updateWidgetSessionState({ isMicMuted: false });
    }
  });

  ipcMain.handle('widget:dismiss-card', async (_event, type: 'sayThis' | 'askThis', id: string) => {
    if (type === 'sayThis') {
      widgetLiveAssist.sayThis = widgetLiveAssist.sayThis.filter(card => card.id !== id);
    } else {
      widgetLiveAssist.askThis = widgetLiveAssist.askThis.filter(card => card.id !== id);
    }
    sendToWidget('widget:live-assist', widgetLiveAssist);
    logger.debug({ type, id }, 'Widget card dismissed');
  });

  ipcMain.handle('widget:dismiss-nudge', async (_event, id: string) => {
    if (widgetNudge?.id === id) {
      widgetNudge = null;
      sendToWidget('widget:nudge', null);
    }
    logger.debug({ id }, 'Widget nudge dismissed');
  });

  ipcMain.handle('widget:request-initial-state', async () => {
    const window = getWidgetWindow();
    if (window) {
      syncWidgetState();
    }
  });

  ipcMain.handle('widget:show-main-window', async () => {
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.show();
      mainWindowRef.focus();
      if (process.platform === 'darwin') {
        app.dock?.show();
      }
    }
  });

  ipcMain.handle('widget:hide', async () => {
    const window = getWidgetWindow();
    if (window && !window.isDestroyed()) {
      window.hide();
    }
  });
}

export function removeWidgetIpcHandlers(): void {
  ipcMain.removeHandler('widget:pause');
  ipcMain.removeHandler('widget:resume');
  ipcMain.removeHandler('widget:stop');
  ipcMain.removeHandler('widget:mute-mic');
  ipcMain.removeHandler('widget:unmute-mic');
  ipcMain.removeHandler('widget:dismiss-card');
  ipcMain.removeHandler('widget:dismiss-nudge');
  ipcMain.removeHandler('widget:request-initial-state');
  ipcMain.removeHandler('widget:show-main-window');
  ipcMain.removeHandler('widget:hide');
}

export function updateWidgetSessionState(state: Partial<typeof widgetSessionState>): void {
  widgetSessionState = { ...widgetSessionState, ...state };
  sendToWidget('widget:session-state', widgetSessionState);
}

export function updateWidgetLiveAssist(data: { sayThis?: string[] | string; askThis?: string[] | string; clearExisting?: boolean }): void {
  const timestamp = Date.now();

  const normalizeList = (value?: string[] | string): string[] => {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
    if (typeof value === 'string') return [value];
    return [];
  };

  const sayThisList = normalizeList(data.sayThis);
  const askThisList = normalizeList(data.askThis);

  logger.info(
    {
      sayCount: data.sayThis?.length || 0,
      askCount: data.askThis?.length || 0,
      clearExisting: !!data.clearExisting,
    },
    'Updating widget live assist'
  );

  if (data.clearExisting) {
    widgetLiveAssist.sayThis = [];
    widgetLiveAssist.askThis = [];
  }

  if (sayThisList.length > 0) {
    const newCards = sayThisList
      .map((text, i) => ({
        id: `say-${timestamp}-${i}`,
        text: sanitizeWidgetText(text),
        timestamp,
      }))
      .filter((card) => !!card.text);
    widgetLiveAssist.sayThis = [...newCards, ...widgetLiveAssist.sayThis].slice(0, 5);
  }

  if (askThisList.length > 0) {
    const newCards = askThisList
      .map((text, i) => ({
        id: `ask-${timestamp}-${i}`,
        text: sanitizeWidgetText(text),
        timestamp,
      }))
      .filter((card) => !!card.text);
    widgetLiveAssist.askThis = [...newCards, ...widgetLiveAssist.askThis].slice(0, 5);
  }

  logger.info({ totalSay: widgetLiveAssist.sayThis.length, totalAsk: widgetLiveAssist.askThis.length }, 'Sending live assist to widget');
  sendToWidget('widget:live-assist', widgetLiveAssist);
}

export function updateWidgetVisualAnalysis(description: string): void {
  const sanitized = sanitizeWidgetText(description);
  widgetVisualAnalysis = { description: sanitized };
  sendToWidget('widget:visual-analysis', widgetVisualAnalysis);
}

export function updateWidgetNudge(nudge: { id: string; message: string; type: 'info' | 'warning' | 'action' } | null): void {
  if (nudge) {
    widgetNudge = { ...nudge, timestamp: Date.now() };
  } else {
    widgetNudge = null;
  }
  sendToWidget('widget:nudge', widgetNudge);
}

export function updateWidgetFen(data: { fen: string; board: string | null; turn: 'w' | 'b' | null }): void {
  widgetFen = data;
  sendToWidget('widget:fen', widgetFen);
  logger.debug({ fen: data.fen, turn: data.turn }, 'Sent FEN to widget for board verification');
}

export function clearWidgetState(): void {
  widgetSessionState = {
    isRecording: false,
    isPaused: false,
    isMicMuted: false,
    startTime: null,
    gameId: '',
  };
  widgetLiveAssist = { sayThis: [], askThis: [] };
  widgetVisualAnalysis = { description: '' };
  widgetNudge = null;
  widgetFen = null;
}
