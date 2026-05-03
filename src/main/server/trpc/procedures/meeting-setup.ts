/**
 * Game Setup tRPC Procedures
 * Endpoints for generating coaching questions and game checklist
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { getMeetingSetupService } from '../../../services/meeting-setup.service';

const probingQuestionSchema = z.object({
  question: z.string(),
  options: z.array(z.string()),
  answer: z.string(),
  customAnswer: z.string().optional(),
});

export const meetingSetupRouter = router({
  generateProbingQuestions: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1, 'Game name is required'),
        description: z.string().optional().default(''),
      })
    )
    .mutation(async ({ input }) => {
      const service = getMeetingSetupService();
      return service.generateProbingQuestions(input.name, input.description);
    }),

  generateChecklist: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        description: z.string().optional().default(''),
        questions: z.array(probingQuestionSchema),
      })
    )
    .mutation(async ({ input }) => {
      const service = getMeetingSetupService();
      return service.generateChecklist(input.name, input.description, input.questions);
    }),
});
