import { create } from 'zustand';
import type { ProbingQuestion } from '../../shared/types/meeting-setup.types';
import {
  DEFAULT_GAME_ID,
  type SupportedGameId,
} from '../../shared/config/game-coaching';

export type GameSetupStep = 'sources' | 'info' | 'questions' | 'checklist' | 'ready';
/** @deprecated Use GameSetupStep */
export type MeetingSetupStep = GameSetupStep;

interface GameSetupState {
  step: GameSetupStep;
  name: string;
  description: string;
  gameId: SupportedGameId;
  coachPersonalityId: string;
  questions: ProbingQuestion[];
  checklist: string[];
  isGenerating: boolean;
  error: string | null;

  // Actions
  setStep: (step: GameSetupStep) => void;
  setInfo: (name: string, description: string) => void;
  setGameId: (gameId: SupportedGameId) => void;
  setCoachPersonalityId: (id: string) => void;
  setQuestions: (questions: ProbingQuestion[]) => void;
  setQuestionAnswer: (index: number, answer: string, customAnswer?: string) => void;
  setChecklist: (checklist: string[]) => void;
  setIsGenerating: (isGenerating: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;

  // Computed helpers
  isSetupComplete: () => boolean;
  getMeetingSetupData: () => {
    name: string;
    description: string;
    gameId: SupportedGameId;
    coachPersonalityId: string;
    questions: ProbingQuestion[];
    checklist: string[];
  };
}

const initialState = {
  step: 'sources' as GameSetupStep,
  name: '',
  description: '',
  gameId: DEFAULT_GAME_ID,
  coachPersonalityId: 'default',
  questions: [] as ProbingQuestion[],
  checklist: [] as string[],
  isGenerating: false,
  error: null as string | null,
};

export const useGameSetupStore = create<GameSetupState>((set, get) => ({
  ...initialState,

  setStep: (step) => set({ step, error: null }),

  setInfo: (name, description) => set({ name, description }),

  setGameId: (gameId) => set({ gameId }),

  setCoachPersonalityId: (coachPersonalityId) => set({ coachPersonalityId }),

  setQuestions: (questions) => set({ questions }),

  setQuestionAnswer: (index, answer, customAnswer) => {
    const questions = [...get().questions];
    if (questions[index]) {
      questions[index] = {
        ...questions[index],
        answer,
        customAnswer,
      };
      set({ questions });
    }
  },

  setChecklist: (checklist) => set({ checklist }),

  setIsGenerating: (isGenerating) => set({ isGenerating }),

  setError: (error) => set({ error }),

  reset: () => set(initialState),

  isSetupComplete: () => {
    const state = get();
    return (
      state.name.trim().length > 0 &&
      state.description.trim().length > 0 &&
      state.questions.length > 0 &&
      state.checklist.length > 0
    );
  },

  getMeetingSetupData: () => {
    const state = get();
    return {
      name: state.name,
      description: state.description,
      gameId: state.gameId,
      coachPersonalityId: state.coachPersonalityId,
      questions: state.questions,
      checklist: state.checklist,
    };
  },
}));

/** @deprecated Use useGameSetupStore */
export const useMeetingSetupStore = useGameSetupStore;

