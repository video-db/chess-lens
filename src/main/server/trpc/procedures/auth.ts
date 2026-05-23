import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { router, publicProcedure, protectedProcedure } from '../trpc';
import { RegisterInputSchema, RegisterOutputSchema } from '../../../../shared/schemas/auth.schema';
import { createUser, getUserByAccessToken, updateUser } from '../../../db';
import { createVideoDBService } from '../../../services/videodb.service';
import { createChildLogger } from '../../../lib/logger';
import { loadRuntimeConfig, loadAppConfig, saveAppConfig } from '../../../lib/config';
import { getLLMService } from '../../../services/llm.service';

const logger = createChildLogger('auth-procedure');

export const authRouter = router({
  register: publicProcedure
    .input(RegisterInputSchema)
    .output(RegisterOutputSchema)
    .mutation(async ({ input }) => {
      const { name, apiKey, litellmKey } = input;

      logger.info({ name }, 'Registration attempt');

      // Verify API key with VideoDB
      const runtimeConfig = loadRuntimeConfig();
      const videodbService = createVideoDBService(apiKey, runtimeConfig.apiUrl);

      const isValid = await videodbService.verifyApiKey();

      if (!isValid) {
        logger.warn({ name }, 'Registration failed: Invalid API key');
        return {
          success: false,
          error: 'Invalid API key',
        };
      }

      // Find or create the chess-lens collection
      let collectionId: string;
      try {
        collectionId = await videodbService.findOrCreateCallMdCollection();
        logger.info({ collectionId }, 'Using chess-lens collection');
      } catch (error) {
        logger.error({ error, name }, 'Failed to setup chess-lens collection');
        return {
          success: false,
          error: 'Failed to setup collection. Please try again.',
        };
      }

      // Generate access token
      const accessToken = uuidv4();

      // Check if user with this token already exists (shouldn't happen with UUID)
      const existingUser = getUserByAccessToken(accessToken);
      if (existingUser) {
        logger.error({ name }, 'Token collision detected');
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Token generation failed, please try again',
        });
      }

      // Create user with collection ID
      try {
        const user = createUser({
          name,
          apiKey,
          accessToken,
          collectionId,
          litellmKey: litellmKey || null,
        });

        logger.info({ userId: user.id, name, collectionId }, 'User registered successfully');

        // Persist to AppConfig so the LLM service picks up the LiteLLM key immediately
        const existingConfig = loadAppConfig();
        saveAppConfig({
          ...existingConfig,
          accessToken: user.accessToken,
          userName: user.name,
          apiKey: user.apiKey,
          ...(litellmKey ? { litellmKey } : {}),
        });

        return {
          success: true,
          accessToken: user.accessToken,
          name: user.name,
        };
      } catch (error) {
        logger.error({ error, name }, 'Failed to create user');
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create user',
        });
      }
    }),

  // Update the stored API key for the currently authenticated user.
  // Verifies the new key against the live VideoDB API before persisting it.
  updateApiKey: protectedProcedure
    .input(z.object({ apiKey: z.string().min(1, 'API key is required') }))
    .output(z.object({ success: z.boolean(), error: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { user } = ctx;
      const { apiKey } = input;

      logger.info({ userId: user.id }, 'API key update requested');

      const runtimeConfig = loadRuntimeConfig();
      const videodbService = createVideoDBService(apiKey, runtimeConfig.apiUrl);

      const isValid = await videodbService.verifyApiKey();
      if (!isValid) {
        logger.warn({ userId: user.id }, 'API key update failed: invalid key');
        return { success: false, error: 'Invalid API key — could not connect to VideoDB.' };
      }

      // Find or create the chess-lens collection under the new key.
      // This is essential when the new key belongs to a different VideoDB account —
      // the old collectionId would be inaccessible and cause 403s during recording.
      let collectionId: string;
      try {
        collectionId = await videodbService.findOrCreateCallMdCollection();
        logger.info({ userId: user.id, collectionId }, 'Collection resolved for new API key');
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error({ userId: user.id, error: errMsg }, 'Failed to set up collection for new API key');
        return { success: false, error: 'API key is valid but failed to set up collection. Please try again.' };
      }

      // Persist both apiKey and collectionId to the DB user record
      updateUser(user.id, { apiKey, collectionId });

      // Keep AppConfig in sync so the main process picks it up immediately
      const existingConfig = loadAppConfig();
      saveAppConfig({ ...existingConfig, apiKey });

      logger.info({ userId: user.id, collectionId }, 'API key updated successfully');
      return { success: true };
    }),
});
