import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** The tip/analysis text this message was triggered from, if any. */
  tipContext?: string;
  timestamp: number;
}

interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;

  addMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => ChatMessage;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clear: () => void;
}

let _idCounter = 0;
function nextId(): string {
  return `chat-${Date.now()}-${_idCounter++}`;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isLoading: false,
  error: null,

  addMessage: (msg) => {
    const full: ChatMessage = { ...msg, id: nextId(), timestamp: Date.now() };
    set((state) => ({ messages: [...state.messages, full], error: null }));
    return full;
  },

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error, isLoading: false }),

  clear: () => set({ messages: [], isLoading: false, error: null }),
}));
