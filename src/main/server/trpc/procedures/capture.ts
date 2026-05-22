import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import {
  CreateCaptureSessionInputSchema,
  CaptureSessionSchema,
} from '../../../../shared/schemas/capture.schema';
import { createVideoDBService } from '../../../services/videodb.service';
import { loadRuntimeConfig } from '../../../lib/config';
import { createChildLogger } from '../../../lib/logger';

const logger = createChildLogger('capture-procedure');

export const captureRouter = router({
  createSession: protectedProcedure
    .input(CreateCaptureSessionInputSchema)
    .output(CaptureSessionSchema)
    .mutation(async ({ ctx, input }) => {
      const { user } = ctx;

      const runtimeConfig = loadRuntimeConfig();

      logger.info({ userId: user.id, collectionId: user.collectionId }, '[Capture] Creating capture session');

      const videodbService = createVideoDBService(user.apiKey, runtimeConfig.apiUrl, user.collectionId || undefined);

      try {
        const session = await videodbService.createCaptureSession({
          endUserId: `user-${user.id}`,
          metadata: input.metadata,
        });

        logger.info({ sessionId: session.sessionId }, 'Capture session created');
        return session;
      } catch (error) {
        // The VideoDB SDK stores the API's response body message in error.cause,
        // but only puts the HTTP status line (e.g. "Error 403: Forbidden") in
        // error.message. Log both so we can see the exact reason from VideoDB.
        const message = error instanceof Error ? error.message : String(error);
        const cause = (error as any)?.cause;
        logger.error({ userId: user.id, collectionId: user.collectionId, message, cause }, 'Failed to create capture session');
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: cause ? `${message}: ${cause}` : message,
        });
      }
    }),
});
