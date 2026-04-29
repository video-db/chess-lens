import { create } from 'zustand';

export interface VisualIndexItem {
  id: string;
  text: string;
  start: number; // epoch ms from server
  end: number;   // epoch ms from server
  timestamp: number; // when received (Date.now())
  rtstreamId?: string;
  rtstreamName?: string;
}

interface VisualIndexState {
  items: VisualIndexItem[];
  enabled: boolean;
  isRunning: boolean; // Whether indexing is actively running
  sceneIndexId: string | null; // ID of the created scene index
  rtstreamId: string | null;   // RTStream ID used for this session

  // Actions
  addItem: (item: Omit<VisualIndexItem, 'id' | 'timestamp'>) => void;
  setEnabled: (enabled: boolean) => void;
  setRunning: (isRunning: boolean) => void;
  setSceneIndexId: (id: string | null) => void;
  setRtstreamId: (id: string | null) => void;
  clear: () => void;
}

let itemIdCounter = 0;

export const useVisualIndexStore = create<VisualIndexState>((set) => ({
  items: [],
  enabled: false, // Off by default, user toggles on to start
  isRunning: false,
  sceneIndexId: null,
  rtstreamId: null,

  addItem: (item) => {
    const newItem: VisualIndexItem = {
      ...item,
      id: `visual-${++itemIdCounter}`,
      timestamp: Date.now(),
    };

    set((state) => ({
      items: [...state.items.slice(-50), newItem], // Keep last 50
    }));
  },

  setEnabled: (enabled) => set({ enabled }),
  setRunning: (isRunning) => set({ isRunning }),
  setSceneIndexId: (sceneIndexId) => set({ sceneIndexId }),
  setRtstreamId: (rtstreamId) => set({ rtstreamId }),

  clear: () => {
    set({ items: [], sceneIndexId: null, rtstreamId: null, isRunning: false });
  },
}));
