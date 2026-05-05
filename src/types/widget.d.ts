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
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  hide: () => Promise<void>;
  muteMic: () => Promise<void>;
  unmuteMic: () => Promise<void>;
  dismissCard: (type: 'sayThis' | 'askThis', id: string) => Promise<void>;
  dismissNudge: (id: string) => Promise<void>;
  showMainWindow: () => Promise<void>;
  chat: (question: string, tipContext?: string) => Promise<{ success: boolean; reply?: string; error?: string }>;
  onSessionState: (callback: (state: WidgetSessionState) => void) => () => void;
  onLiveAssist: (callback: (data: WidgetLiveAssistData) => void) => () => void;
  onVisualAnalysis: (callback: (data: { description: string }) => void) => () => void;
  onNudge: (callback: (nudge: WidgetNudge | null) => void) => () => void;
  onFen: (callback: (data: { fen: string; displayFen: string; board: string | null; turn: 'w' | 'b' | null; engineSan?: string; engineEval?: number; engineMate?: number | null }) => void) => () => void;
  requestInitialState: () => Promise<void>;
  reportContentHeight: (height: number) => void;
}

// Extend the Window interface
declare global {
  interface Window {
    widgetAPI?: WidgetApi;
  }
}

// This export is needed to make this a module
export {};
