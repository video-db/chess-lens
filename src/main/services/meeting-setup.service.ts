/**
 * Game Setup Service
 * Handles LLM calls for generating coaching questions and game checklist
 */

import { logger } from '../lib/logger';
import { getVideoDBServiceFromConfig } from './videodb.service';
import {
  PROBING_QUESTIONS_SYSTEM_PROMPT,
  buildProbingQuestionsUserPrompt,
  CHECKLIST_SYSTEM_PROMPT,
  buildChecklistUserPrompt,
} from './meeting-setup.prompts';
import type {
  ProbingQuestion,
  ProbingQuestionsResponse,
  ChecklistResponse,
} from '../../shared/types/meeting-setup.types';

const log = logger.child({ module: 'game-setup-service' });

export class MeetingSetupService {
  /**
   * Generate coaching questions based on game name and description.
   * Uses VideoDB's pro model via generateCoachingText.
   */
  async generateProbingQuestions(
    name: string,
    description: string
  ): Promise<{ success: boolean; questions: ProbingQuestion[]; error?: string }> {
    log.info({ name, description: description.slice(0, 100) }, 'Generating coaching questions');

    const userPrompt = buildProbingQuestionsUserPrompt(name, description);
    const fullPrompt = `${PROBING_QUESTIONS_SYSTEM_PROMPT}\n\n${userPrompt}`;

    const videodb = getVideoDBServiceFromConfig();
    if (!videodb) {
      return { success: false, questions: [], error: 'VideoDB service not available' };
    }

    try {
      const raw = await videodb.generateCoachingText(fullPrompt, 'pro', 'json', 30000);
      if (!raw) {
        log.error('generateCoachingText returned empty for probing questions');
        return { success: false, questions: [], error: 'Empty response from model' };
      }

      const parsed = this.parseJSON<ProbingQuestionsResponse>(raw);
      if (!parsed?.questions?.length) {
        log.error({ raw: raw.slice(0, 200) }, 'Failed to parse probing questions JSON');
        return { success: false, questions: [], error: 'Failed to parse questions response' };
      }

      const questions: ProbingQuestion[] = parsed.questions.map((q) => ({
        question: q.question,
        options: q.options,
        answer: '',
        customAnswer: undefined,
      }));

      log.info({ questionCount: questions.length }, 'Coaching questions generated');
      return { success: true, questions };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error({ error }, 'Failed to generate coaching questions');
      return { success: false, questions: [], error };
    }
  }

  /**
   * Generate game checklist based on setup data.
   * Uses VideoDB's pro model via generateCoachingText.
   */
  async generateChecklist(
    name: string,
    description: string,
    questions: ProbingQuestion[]
  ): Promise<{ success: boolean; checklist: string[]; error?: string }> {
    log.info({ name, questionCount: questions.length }, 'Generating game checklist');

    const userPrompt = buildChecklistUserPrompt(name, description, questions);
    const fullPrompt = `${CHECKLIST_SYSTEM_PROMPT}\n\nOutput format:\n{"checklist":["item1","item2"]}\n\n${userPrompt}`;

    const videodb = getVideoDBServiceFromConfig();
    if (!videodb) {
      return { success: false, checklist: [], error: 'VideoDB service not available' };
    }

    try {
      const raw = await videodb.generateCoachingText(fullPrompt, 'pro', 'json', 30000);
      if (!raw) {
        log.error('generateCoachingText returned empty for checklist');
        return { success: false, checklist: [], error: 'Empty response from model' };
      }

      const parsed = this.parseJSON<ChecklistResponse>(raw);
      const checklist = parsed?.checklist;
      if (!Array.isArray(checklist) || checklist.length === 0) {
        log.error({ raw: raw.slice(0, 200) }, 'Failed to parse checklist JSON');
        return { success: false, checklist: [], error: 'Failed to parse checklist response' };
      }

      log.info({ checklistCount: checklist.length }, 'Game checklist generated');
      return { success: true, checklist };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error({ error }, 'Failed to generate game checklist');
      return { success: false, checklist: [], error };
    }
  }

  private parseJSON<T>(raw: string): T | null {
    try {
      let s = raw.trim();
      const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fence) s = fence[1].trim();
      const j0 = s.indexOf('{'), j1 = s.lastIndexOf('}');
      if (j0 !== -1 && j1 > j0) s = s.slice(j0, j1 + 1);
      return JSON.parse(s) as T;
    } catch {
      return null;
    }
  }
}

// Singleton instance
let instance: MeetingSetupService | null = null;

export function getMeetingSetupService(): MeetingSetupService {
  if (!instance) {
    instance = new MeetingSetupService();
  }
  return instance;
}

export function resetMeetingSetupService(): void {
  instance = null;
}
