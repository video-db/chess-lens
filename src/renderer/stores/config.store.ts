import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ConfigState {
  accessToken: string | null;
  userName: string | null;
  apiKey: string | null;
  litellmKey: string | null;
  apiUrl: string | null;
  onboardingComplete: boolean;

  setAuth: (accessToken: string, userName: string, apiKey: string, litellmKey?: string | null) => void;
  setConfig: (config: Partial<ConfigState>) => void;
  clearAuth: () => void;
  isAuthenticated: () => boolean;
  completeOnboarding: () => void;
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      userName: null,
      apiKey: null,
      litellmKey: null,
      apiUrl: null,
      onboardingComplete: false,

      setAuth: (accessToken, userName, apiKey, litellmKey) => {
        set({ accessToken, userName, apiKey, litellmKey: litellmKey ?? null });
      },

      setConfig: (config) => {
        set(config);
      },

      clearAuth: () => {
        set({
          accessToken: null,
          userName: null,
          apiKey: null,
          litellmKey: null,
          onboardingComplete: false,
        });
      },

      isAuthenticated: () => {
        return !!get().accessToken;
      },

      completeOnboarding: () => {
        set({ onboardingComplete: true });
      },
    }),
    {
      name: 'chess-lens-config',
      partialize: (state) => ({
        accessToken: state.accessToken,
        userName: state.userName,
        apiKey: state.apiKey,
        litellmKey: state.litellmKey,
        onboardingComplete: state.onboardingComplete,
      }),
    }
  )
);
