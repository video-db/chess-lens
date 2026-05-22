import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { GenerateTokenInputSchema, SessionTokenSchema } from '../../../../shared/schemas/auth.schema';
import { createVideoDBService } from '../../../services/videodb.service';
import { loadRuntimeConfig } from '../../../lib/config';
import { createChildLogger } from '../../../lib/logger';

const logger = createChildLogger('token-procedure');

export const tokenRouter = router({
  generate: protectedProcedure
    .input(GenerateTokenInputSchema)
    .output(SessionTokenSchema)
    .mutation(async ({ ctx, input }) => {
      const { user } = ctx;
      const userId = input.userId || `user-${user.id}`;

      logger.info({ userId }, 'Generating session token');

      // ─── SIMULATION: set CHESS_SIMULATE_403=1 to reproduce the 403 error ──
      // Throws exactly what the SDK throws for a real 403 response so that the
      // full logging + renderer error banner can be verified without a bad key.
      //
      // Usage:  CHESS_SIMULATE_403=1 npm run dev  → start a recording
      //
      // Expected main-process log:
      //   ERROR: Failed to generate session token
      //     message: "Error 403: Forbidden"
      //     cause:   "Capture feature not available on this plan"
      //
      // Expected renderer log:
      //   ERROR: startRecording failed
      //     trpcPath: "token.generate"
      //     error:    "Error 403: Forbidden: Capture feature not available on this plan"
      //
      // Expected UI: red inline banner on the setup screen with the full message.
      // ────────────────────────────────────────────────────────────────────────
      if (process.env.CHESS_SIMULATE_403 === '1') {
        logger.warn({ userId }, '[SIMULATION] Throwing fake 403 — CHESS_SIMULATE_403=1');
        // Mimics the exact shape of InvalidRequestError from the VideoDB SDK:
        //   .message = "Error <status>: <statusText>"
        //   .cause   = API response body message
        const fakeError = new Error('Error 403: Forbidden') as Error & { cause: string };
        fakeError.cause = 'Capture feature not available on this plan';
        throw fakeError;
      }
      // ────────────────────────────────────────────────────────────────────────

      const runtimeConfig = loadRuntimeConfig();
      const videodbService = createVideoDBService(user.apiKey, runtimeConfig.apiUrl);

      try {
        const token = await videodbService.createSessionToken(userId);
        logger.info({ userId, expiresAt: token.expiresAt }, 'Session token generated');
        return token;
      } catch (error) {
        // The VideoDB SDK stores the API's response body message in error.cause,
        // but only puts the HTTP status line (e.g. "Error 403: Forbidden") in
        // error.message. Log both so we can see the exact reason from VideoDB.
        const message = error instanceof Error ? error.message : String(error);
        const cause = (error as any)?.cause;
        logger.error({ userId, message, cause }, 'Failed to generate session token');
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: cause ? `${message}: ${cause}` : message,
        });
      }
    }),
});
