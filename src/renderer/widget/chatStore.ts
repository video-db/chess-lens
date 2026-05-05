/**
 * Module-level chat store for the widget overlay.
 *
 * Keeping chat state outside PairCompactOverlay prevents it from being
 * accidentally reset when the component re-renders due to frequent FEN /
 * coaching-tip prop updates coming from the parent WidgetApp.
 */
import { create } from 'zustand';

export interface WidgetChatMsg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  tipCtx?: string;
}

interface WidgetChatState {
  messages: WidgetChatMsg[];
  isOpen: boolean;
  isLoading: boolean;
  error: string | null;

  open: () => void;
  toggle: () => void;
  addMessage: (msg: Omit<WidgetChatMsg, 'id'>) => string; // returns new id
  setLoading: (v: boolean) => void;
  setError: (v: string | null) => void;
  clear: () => void;
}

let _counter = 0;
function nextId(): string {
  return `wcm-${Date.now()}-${_counter++}`;
}

export const useWidgetChatStore = create<WidgetChatState>((set) => ({
  messages: [],
  isOpen: false,
  isLoading: false,
  error: null,

  open: () => set({ isOpen: true }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  addMessage: (msg) => {
    const id = nextId();
    set((s) => ({ messages: [...s.messages, { ...msg, id }], error: null }));
    return id;
  },
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error, isLoading: false }),
  clear: () => set({ messages: [], isLoading: false, error: null, isOpen: false }),
}));
