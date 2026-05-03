import type { SupportedGameId } from '../config/game-coaching';

/**
 * Game Setup Types
 * Types for the multi-step game setup flow
 */

export interface ProbingQuestion {
  question: string;
  options: string[];
  answer: string; // comma-separated selected options
  customAnswer?: string; // "other" option for custom input
}

export interface GameSetup {
  name: string;
  description: string;
  gameId: SupportedGameId;
  questions: ProbingQuestion[];
  checklist: string[];
}

/** @deprecated Use GameSetup */
export type MeetingSetup = GameSetup;

export interface GameSetupStep {
  step: 'sources' | 'info' | 'questions' | 'checklist' | 'ready';
}

/** @deprecated Use GameSetupStep */
export type MeetingSetupStep = GameSetupStep;

// Response types for LLM calls
export interface ProbingQuestionsResponse {
  questions: Array<{
    question: string;
    options: string[];
  }>;
}

export interface ChecklistResponse {
  checklist: string[];
}
