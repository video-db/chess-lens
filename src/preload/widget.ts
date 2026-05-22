import { contextBridge, ipcRenderer } from 'electron';

export interface WidgetSessionState {
  isRecording: boolean;
  isPaused: boolean;
  isMicMuted: boolean;
  startTime: number | null;
  gameId: string;
}

export interface InsightCard {
  id: string;
  text: string;
  timestamp: number;
}

export interface WidgetLiveAssistData {
  sayThis: InsightCard[];
  askThis: InsightCard[];
}

export interface WidgetNudge {
  id: string;
  message: string;
  type: 'info' | 'warning' | 'action';
  timestamp: number;
}

export interface WidgetApi {
  // Actions
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  hide: () => Promise<void>;
  focus: () => Promise<void>;
  muteMic: () => Promise<void>;
  unmuteMic: () => Promise<void>;
  dismissCard: (type: 'sayThis' | 'askThis', id: string) => Promise<void>;
  dismissNudge: (id: string) => Promise<void>;
  showMainWindow: () => Promise<void>;
  chat: (question: string, tipContext?: string) => Promise<{ success: boolean; reply?: string; error?: string }>;
  flipTurn: () => Promise<{ success: boolean }>;
  /** Notify the main process that the overlay has been collapsed or expanded. */
  setCollapsed: (collapsed: boolean) => Promise<void>;

  // Events
  onSessionState: (callback: (state: WidgetSessionState) => void) => () => void;
  onLiveAssist: (callback: (data: WidgetLiveAssistData) => void) => () => void;
  onVisualAnalysis: (callback: (data: { description: string }) => void) => () => void;
  onNudge: (callback: (nudge: WidgetNudge | null) => void) => () => void;
  onFen: (callback: (data: { fen: string; displayFen: string; board: string | null; turn: 'w' | 'b' | null; boardOrientation?: 'white' | 'black'; engineSan?: string; engineLan?: string; engineFrom?: string; engineTo?: string; engineEval?: number; engineMate?: number | null; isFlipAck?: boolean; isSync?: boolean }) => void) => () => void;

  // Start-error event: fired when the recording pipeline fails to start
  onStartError: (callback: (data: { message: string }) => void) => () => void;

  // No-board event: fired each time the LLM reports NO_BOARD in a screenshot frame
  onNoBoard: (callback: () => void) => () => void;

  // Initial state request
  requestInitialState: () => Promise<void>;

  // Report rendered content height to the main process for auto-resize
  reportContentHeight: (height: number) => void;
}

const widgetApi: WidgetApi = {
  // Actions
  pause: () => ipcRenderer.invoke('widget:pause'),
  resume: () => ipcRenderer.invoke('widget:resume'),
  stop: () => ipcRenderer.invoke('widget:stop'),
  hide: () => ipcRenderer.invoke('widget:hide'),
  focus: () => ipcRenderer.invoke('widget:focus'),
  muteMic: () => ipcRenderer.invoke('widget:mute-mic'),
  unmuteMic: () => ipcRenderer.invoke('widget:unmute-mic'),
  dismissCard: (type: 'sayThis' | 'askThis', id: string) =>
    ipcRenderer.invoke('widget:dismiss-card', type, id),
  dismissNudge: (id: string) => ipcRenderer.invoke('widget:dismiss-nudge', id),
  showMainWindow: () => ipcRenderer.invoke('widget:show-main-window'),
  chat: (question: string, tipContext?: string) =>
    ipcRenderer.invoke('live-assist:chat', question, tipContext),
  flipTurn: () => ipcRenderer.invoke('live-assist:flip-turn'),
  setCollapsed: (collapsed: boolean) =>
    ipcRenderer.invoke('widget:set-collapsed', collapsed),

  // Events
  onSessionState: (callback: (state: WidgetSessionState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: WidgetSessionState) => callback(state);
    ipcRenderer.on('widget:session-state', listener);
    return () => ipcRenderer.removeListener('widget:session-state', listener);
  },

  onLiveAssist: (callback: (data: WidgetLiveAssistData) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: WidgetLiveAssistData) => callback(data);
    ipcRenderer.on('widget:live-assist', listener);
    return () => ipcRenderer.removeListener('widget:live-assist', listener);
  },

  onVisualAnalysis: (callback: (data: { description: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { description: string }) => callback(data);
    ipcRenderer.on('widget:visual-analysis', listener);
    return () => ipcRenderer.removeListener('widget:visual-analysis', listener);
  },

  onNudge: (callback: (nudge: WidgetNudge | null) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, nudge: WidgetNudge | null) => callback(nudge);
    ipcRenderer.on('widget:nudge', listener);
    return () => ipcRenderer.removeListener('widget:nudge', listener);
  },

  onFen: (callback: (data: { fen: string; displayFen: string; board: string | null; turn: 'w' | 'b' | null; boardOrientation?: 'white' | 'black'; engineSan?: string; engineLan?: string; engineFrom?: string; engineTo?: string; engineEval?: number; engineMate?: number | null; isFlipAck?: boolean; isSync?: boolean }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { fen: string; displayFen: string; board: string | null; turn: 'w' | 'b' | null; boardOrientation?: 'white' | 'black'; engineSan?: string; engineLan?: string; engineFrom?: string; engineTo?: string; engineEval?: number; engineMate?: number | null; isFlipAck?: boolean; isSync?: boolean }) => callback(data);
    ipcRenderer.on('widget:fen', listener);
    return () => ipcRenderer.removeListener('widget:fen', listener);
  },

  onStartError: (callback: (data: { message: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { message: string }) => callback(data);
    ipcRenderer.on('widget:start-error', listener);
    return () => ipcRenderer.removeListener('widget:start-error', listener);
  },

  onNoBoard: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('widget:no-board', listener);
    return () => ipcRenderer.removeListener('widget:no-board', listener);
  },

  // Initial state request
  requestInitialState: () => ipcRenderer.invoke('widget:request-initial-state'),

  // Notify the main process of the current rendered content height so it can
  // resize the BrowserWindow to fit without clipping.
  reportContentHeight: (height: number) => ipcRenderer.send('widget:content-height', height),
};

contextBridge.exposeInMainWorld('widgetAPI', widgetApi);
