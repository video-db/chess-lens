import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import {
  RecordingSchema,
  CreateRecordingInputSchema,
  StopRecordingInputSchema,
  GetRecordingInputSchema,
  KeyPointsSchema,
  PlaybookSnapshotSchema,
  MetricsSnapshotSchema,
  ProbingQuestionSchema,
  type KeyPoints,
  type PlaybookSnapshot,
  type MetricsSnapshot,
} from '../../../../shared/schemas/recording.schema';
import { DEFAULT_GAME_ID } from '../../../../shared/config/game-coaching';
import {
  getAllRecordings,
  createRecording,
  updateRecordingBySessionId,
  getRecordingById,
  getTranscriptSegmentsByRecording,
  getVisualIndexItemsByRecording,
  getCoachingTipsByRecording,
} from '../../../db';
import { createChildLogger } from '../../../lib/logger';
import { loadRuntimeConfig } from '../../../lib/config';
import {
  checkAndRecoverSession,
  checkSessionExport,
  recoverExportedRecording,
} from '../../../services/recording-export.service';
import { createVideoDBService } from '../../../services/videodb.service';

const logger = createChildLogger('recordings-procedure');

const PROCESSING_TIMEOUT_MS = 30 * 60 * 1000;
const VIDEODB_FAILED_MARKER = '__videodb_api_failed__';

function parseCreatedAtMs(createdAt: string): number {
  const normalized = createdAt.includes('T') ? createdAt : createdAt.replace(' ', 'T');
  const hasTimeZone = /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(normalized);
  const utcCandidate = hasTimeZone ? normalized : `${normalized}Z`;
  const parsedUtc = Date.parse(utcCandidate);

  if (Number.isFinite(parsedUtc)) {
    return parsedUtc;
  }

  return Date.parse(createdAt);
}

function toEmbedPlayerUrl(playerUrl: string | null | undefined): string | null {
  if (!playerUrl) return null;
  return playerUrl.replace('/watch', '/embed');
}

function toGameplayTip(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return 'Review this moment for piece positioning, tactical threats, and decision-making.';

  const cleaned = compact
    .replace(/\*\*/g, '')
    .replace(/__+/g, '')
    .replace(/`+/g, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/^image\s*\d+\s*:\s*/i, '')
    .replace(/\s*image\s*\d+\s*:\s*/gi, ' ')
    .replace(/^the screen\s+(shows|displays)\s*/i, '')
    .replace(/^this frame\s+(shows|displays)\s*/i, '')
    .replace(/^visible content\s*[:\-]?\s*/i, '')
    .trim();

  if (/no actionable gameplay context is available|no actionable gameplay moment/i.test(cleaned)) {
    return '';
  }

  const tip = cleaned || compact;
  return tip.length > 220 ? `${tip.slice(0, 217)}...` : tip;
}

async function recoverProcessingRecordings(
  recordings: ReturnType<typeof getAllRecordings>,
  apiKey?: string,
  apiUrl?: string,
  collectionId?: string
): Promise<void> {
  if (!apiKey) return;

  const now = Date.now();
  const processing = recordings.filter(
    (r) => (r.status === 'processing' || r.status === 'failed') && !r.videoId
  );

  for (const recording of processing.slice(0, 10)) {
    // Skip failed recordings - they should remain failed until explicitly retried by user
    if (recording.status === 'failed') {
      continue;
    }

    const createdAtMs = parseCreatedAtMs(recording.createdAt);
    const ageMs = Number.isFinite(createdAtMs) ? now - createdAtMs : 0;
    if (ageMs < 15_000) continue;

    const exportStatus = await checkSessionExport(recording.sessionId, apiKey, apiUrl, collectionId);

    if (exportStatus.exported && exportStatus.videoId) {
      const recovered = await recoverExportedRecording(
        recording.sessionId,
        exportStatus.videoId,
        apiKey,
        apiUrl,
        true,
        collectionId
      );
      if (recovered.success) {
        logger.info({ recordingId: recording.id, sessionId: recording.sessionId }, 'Recovered processing recording during list fetch');
      }
      continue;
    }

    if (exportStatus.status === 'failed') {
      updateRecordingBySessionId(recording.sessionId, {
        status: 'failed',
        insightsStatus: 'failed',
        insights: VIDEODB_FAILED_MARKER,
      });
      logger.warn({ recordingId: recording.id, sessionId: recording.sessionId, ageMs }, 'Marked stale processing recording as failed during list fetch');
      continue;
    }

    if (ageMs > PROCESSING_TIMEOUT_MS) {
      const shouldFailStaleProcessing = exportStatus.status === 'stopped' || !exportStatus.status;

      if (shouldFailStaleProcessing) {
        updateRecordingBySessionId(recording.sessionId, {
          status: 'failed',
          insightsStatus: 'failed',
          insights: VIDEODB_FAILED_MARKER,
        });
        logger.warn(
          { recordingId: recording.id, sessionId: recording.sessionId, ageMs, exportStatus: exportStatus.status },
          'Marked stale processing recording as failed after timeout'
        );
      } else {
        logger.warn(
          { recordingId: recording.id, sessionId: recording.sessionId, ageMs, exportStatus: exportStatus.status },
          'Processing recording exceeded timeout but remains in processing pending final export state'
        );
      }
    }
  }
}

// Safely parse and validate JSON against schema
function safeJsonParse<T>(
  json: string | null | undefined,
  schema: z.ZodType<T>
): T | undefined {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json);
    const result = schema.safeParse(parsed);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

// Transform database recording to API schema
function toApiRecording(dbRecording: ReturnType<typeof getRecordingById>) {
  if (!dbRecording) return null;

  const hasPlayableVideo = !!dbRecording.videoId && !!dbRecording.playerUrl;
  const isFailedStatus = dbRecording.status === 'failed';
  const isStaleProcessing =
    dbRecording.status === 'processing' &&
    !dbRecording.videoId &&
    (() => {
      const createdAtMs = parseCreatedAtMs(dbRecording.createdAt);
      const ageMs = Number.isFinite(createdAtMs) ? Date.now() - createdAtMs : 0;
      return ageMs > PROCESSING_TIMEOUT_MS;
    })();

  const normalizedStatus = hasPlayableVideo
    ? 'available'
    : isFailedStatus
      ? 'failed'
      : isStaleProcessing
        ? 'failed'
      : (dbRecording.status as 'recording' | 'processing' | 'available' | 'failed');

  // Parse meeting setup data
  const probingQuestions = safeJsonParse(
    (dbRecording as any).probingQuestions,
    z.array(ProbingQuestionSchema)
  );
  const meetingChecklist = safeJsonParse(
    (dbRecording as any).meetingChecklist,
    z.array(z.string())
  );
  const postMeetingChecklist = safeJsonParse(
    (dbRecording as any).postMeetingChecklist,
    z.array(z.string())
  );
  const postMeetingChecklistCompleted = safeJsonParse(
    (dbRecording as any).postMeetingChecklistCompleted,
    z.array(z.number())
  );

  return {
    id: dbRecording.id,
    videoId: dbRecording.videoId,
    collectionId: (dbRecording as any).collectionId || null,
    streamUrl: dbRecording.streamUrl,
    playerUrl: dbRecording.playerUrl,
    sessionId: dbRecording.sessionId,
    duration: dbRecording.duration,
    createdAt: dbRecording.createdAt,
    status: normalizedStatus,
    insights: dbRecording.insights,
    insightsStatus: dbRecording.insightsStatus as 'pending' | 'processing' | 'ready' | 'failed',
    // Parse and validate copilot data
    shortOverview: (dbRecording as any).shortOverview || null,
    keyPoints: safeJsonParse<KeyPoints>((dbRecording as any).keyPoints, KeyPointsSchema),
    playbookSnapshot: safeJsonParse<PlaybookSnapshot>(dbRecording.playbookSnapshot, PlaybookSnapshotSchema),
    metricsSnapshot: safeJsonParse<MetricsSnapshot>(dbRecording.metricsSnapshot, MetricsSnapshotSchema),
    // Meeting Setup data
    meetingName: (dbRecording as any).meetingName || null,
    meetingDescription: (dbRecording as any).meetingDescription || null,
    probingQuestions: probingQuestions || null,
    meetingChecklist: meetingChecklist || null,
    // Post-meeting analysis
    postMeetingChecklist: postMeetingChecklist || null,
    postMeetingChecklistCompleted: postMeetingChecklistCompleted || null,
    // Game result
    result: ((dbRecording as any).result as 'win' | 'loss' | 'draw' | null) || null,
  };
}

export const recordingsRouter = router({
  list: protectedProcedure
    .output(z.array(RecordingSchema))
    .query(async ({ ctx }) => {
      const runtimeConfig = loadRuntimeConfig();
      await recoverProcessingRecordings(
        getAllRecordings(),
        ctx.user?.apiKey,
        runtimeConfig.apiUrl,
        ctx.user?.collectionId || undefined,
      );

      logger.info('Fetching all recordings');
      const recordings = getAllRecordings();
      logger.info({
        count: recordings.length,
        recordings: recordings.map(r => ({
          id: r.id,
          sessionId: r.sessionId,
          status: r.status,
          insightsStatus: r.insightsStatus,
          videoId: r.videoId,
        })),
      }, 'Recordings fetched');
      return recordings.map((r) => toApiRecording(r)!);
    }),

  getGameplayTips: protectedProcedure
    .input(z.object({ recordingId: z.number() }))
    .output(z.array(z.object({
      id: z.string(),
      startTime: z.number(),
      endTime: z.number(),
      tip: z.string(),
    })))
    .query(async ({ input }) => {
      // Primary source: coaching tips persisted from the live assist pipeline.
      // These are clean human-readable chess tips ("The best move is a4 because...").
      const coachingTips = getCoachingTipsByRecording(input.recordingId);

      if (coachingTips.length > 0) {
        // Use tip timestamps relative to the first tip for readable display times.
        const sessionStart = coachingTips[0].timestamp;
        return coachingTips
          .map((tip, idx) => {
            const startTime = Math.round((tip.timestamp - sessionStart) / 1000);
            return {
              id: `coaching-tip-${idx}`,
              startTime,
              endTime: startTime + 5,
              tip: tip.sayThis,
            };
          })
          .filter((item) => !!item.tip);
      }

      // Fallback to visual index items for older sessions that predate coaching_tips.
      // Apply toGameplayTip to strip raw FEN/XML.
      const items = getVisualIndexItemsByRecording(input.recordingId);
      return items
        .map((item) => ({
          id: item.id,
          startTime: item.startTime,
          endTime: item.endTime,
          tip: toGameplayTip(item.text),
        }))
        .filter((item) => !!item.tip);
    }),

  get: protectedProcedure
    .input(GetRecordingInputSchema)
    .output(RecordingSchema.nullable())
    .query(async ({ input }) => {
      logger.debug({ recordingId: input.recordingId }, 'Fetching recording');
      const recording = getRecordingById(input.recordingId);
      return toApiRecording(recording);
    }),

  getTranscript: protectedProcedure
    .input(z.object({ recordingId: z.number() }))
    .output(z.array(z.object({
      id: z.string(),
      channel: z.enum(['me', 'them']),
      text: z.string(),
      startTime: z.number(),
      endTime: z.number(),
    })))
    .query(async ({ input }) => {
      logger.debug({ recordingId: input.recordingId }, 'Fetching transcript');
      const segments = getTranscriptSegmentsByRecording(input.recordingId);
      return segments.map(s => ({
        id: s.id,
        channel: s.channel as 'me' | 'them',
        text: s.text,
        startTime: s.startTime,
        endTime: s.endTime,
      }));
    }),

  getPlaybackUrl: protectedProcedure
    .input(z.object({ recordingId: z.number() }))
    .output(z.object({
      playerUrl: z.string().nullable(),
      embedUrl: z.string().nullable(),
    }))
    .query(async ({ input, ctx }) => {
      const recording = getRecordingById(input.recordingId);
      if (!recording || !recording.videoId) {
        return { playerUrl: null, embedUrl: null };
      }

      const fallbackPlayerUrl = recording.playerUrl;
      const fallbackEmbedUrl = toEmbedPlayerUrl(fallbackPlayerUrl);

      const apiKey = ctx.user?.apiKey;
      if (!apiKey) {
        return { playerUrl: fallbackPlayerUrl, embedUrl: fallbackEmbedUrl };
      }

      try {
        const runtimeConfig = loadRuntimeConfig();
        const collectionId = (recording as any).collectionId || ctx.user?.collectionId || undefined;
        const service = createVideoDBService(apiKey, runtimeConfig.apiUrl, collectionId);
        const video = await service.getVideo(recording.videoId);
        let freshPlayerUrl = (video.playerUrl as string | undefined) || fallbackPlayerUrl;

        try {
          const playResult = await (video as any).play?.();
          const playPlayerUrl =
            (playResult?.player_url as string | undefined) ||
            (playResult?.playerUrl as string | undefined);

          if (playPlayerUrl) {
            freshPlayerUrl = playPlayerUrl;
          }
        } catch (playError) {
          logger.warn({ playError, recordingId: input.recordingId }, 'video.play() failed, falling back to video.playerUrl');
        }

        if (freshPlayerUrl && freshPlayerUrl !== fallbackPlayerUrl) {
          updateRecordingBySessionId(recording.sessionId, { playerUrl: freshPlayerUrl });
        }

        return {
          playerUrl: freshPlayerUrl,
          embedUrl: toEmbedPlayerUrl(freshPlayerUrl),
        };
      } catch (error) {
        logger.warn({ error, recordingId: input.recordingId }, 'Failed to fetch fresh playback URL');
        return { playerUrl: fallbackPlayerUrl, embedUrl: fallbackEmbedUrl };
      }
    }),

  start: protectedProcedure
    .input(CreateRecordingInputSchema)
    .output(RecordingSchema)
    .mutation(async ({ input }) => {
      logger.info({ sessionId: input.sessionId, hasMeetingSetup: !!input.meetingName }, 'Starting recording');

      const recordingData: any = {
        sessionId: input.sessionId,
        status: 'recording',
        gameId: input.gameId || DEFAULT_GAME_ID,
      };

      // Add meeting setup data if provided
      if (input.meetingName) {
        recordingData.meetingName = input.meetingName;
      }
      if (input.meetingDescription) {
        recordingData.meetingDescription = input.meetingDescription;
      }
      if (input.probingQuestions) {
        recordingData.probingQuestions = JSON.stringify(input.probingQuestions);
      }
      if (input.meetingChecklist) {
        recordingData.meetingChecklist = JSON.stringify(input.meetingChecklist);
      }

      const recording = createRecording(recordingData);

      logger.info(
        { recordingId: recording.id, sessionId: input.sessionId },
        'Recording started'
      );

      return toApiRecording(recording)!;
    }),

  stop: protectedProcedure
    .input(StopRecordingInputSchema)
    .output(RecordingSchema.nullable())
    .mutation(async ({ input }) => {
      logger.info({ sessionId: input.sessionId }, 'Stopping recording');

      const recording = updateRecordingBySessionId(input.sessionId, {
        status: 'processing',
      });

      if (!recording) {
        logger.warn({ sessionId: input.sessionId }, 'Recording not found');
        return null;
      }

      logger.info(
        { recordingId: recording.id, sessionId: input.sessionId },
        'Recording stopped, status set to processing'
      );

      return toApiRecording(recording);
    }),

  markFailed: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .output(RecordingSchema.nullable())
    .mutation(async ({ input }) => {
      logger.info({ sessionId: input.sessionId }, 'markFailed called; preserving processing state unless VideoDB reports failed');

      const recording = updateRecordingBySessionId(input.sessionId, {
        status: 'processing',
      });

      if (!recording) {
        logger.warn({ sessionId: input.sessionId }, 'Recording not found');
        return null;
      }

      logger.info(
        { recordingId: recording.id, sessionId: input.sessionId },
        'Recording status kept as processing'
      );

      return toApiRecording(recording);
    }),

  cleanupStale: protectedProcedure
    .input(z.object({
      maxAgeMinutes: z.number().default(60),
      excludeSessionId: z.string().optional(),
    }))
    .output(z.object({ cleaned: z.number(), recovered: z.number() }))
    .mutation(async ({ input, ctx }) => {
      logger.info({ maxAgeMinutes: input.maxAgeMinutes, excludeSessionId: input.excludeSessionId }, 'Cleaning up stale recordings');

      const recordings = getAllRecordings();
      const now = Date.now();
      const maxAgeMs = input.maxAgeMinutes * 60 * 1000;
      let cleaned = 0;
      let recovered = 0;

      const apiKey = ctx.user?.apiKey;
      const runtimeConfig = loadRuntimeConfig();
      const apiUrl = runtimeConfig.apiUrl;

      // Try to recover processing recordings from VideoDB
      if (apiKey) {
        const processingRecordings = recordings.filter(
          r => r.status === 'processing' && !r.videoId && r.sessionId !== input.excludeSessionId
        );

        for (const recording of processingRecordings) {
          const result = await checkAndRecoverSession(
            recording.sessionId,
            apiKey,
            apiUrl,
            true // trigger insights
          );

          if (result.exported && result.success) {
            recovered++;
            logger.info(
              { recordingId: recording.id, sessionId: recording.sessionId, videoId: result.videoId },
              'Recording recovered'
            );
          }
        }
      }

      const updatedRecordings = getAllRecordings();
      for (const recording of updatedRecordings) {
        if (recording.sessionId === input.excludeSessionId) {
          continue;
        }

        if (recording.status === 'recording' && !recording.videoId) {
          // A session in 'recording' status with no active process is a crash
          // remnant.  Mark it 'failed' immediately — no age gate needed since
          // the tRPC server only runs while the app is open, and any 'recording'
          // row that isn't the excluded (active) session has no live recorder.
          updateRecordingBySessionId(recording.sessionId, { status: 'failed' });
          logger.info(
            { recordingId: recording.id, sessionId: recording.sessionId },
            'Stuck recording session marked as failed'
          );
          cleaned++;
        }
      }

      logger.info({ cleaned, recovered }, 'Stale recordings cleanup complete');
      return { cleaned, recovered };
    }),

  downloadVideo: protectedProcedure
    .input(z.object({ recordingId: z.number() }))
    .output(z.object({ downloadUrl: z.string(), name: z.string() }))
    .mutation(async ({ input, ctx }) => {
      logger.debug({ recordingId: input.recordingId }, 'Getting video download URL');

      const recording = getRecordingById(input.recordingId);
      if (!recording || !recording.videoId) {
        throw new Error('Recording or video not found');
      }

      const apiKey = ctx.user?.apiKey;
      if (!apiKey) {
        throw new Error('API key not found');
      }

      try {
        const runtimeConfig = loadRuntimeConfig();
        const collectionId = ctx.user?.collectionId || undefined;
        const service = createVideoDBService(apiKey, runtimeConfig.apiUrl, collectionId);
        const result = await service.downloadVideo(recording.videoId, recording.meetingName || undefined);
        logger.info({ recordingId: input.recordingId, result }, 'Video download URL obtained');
        return result;
      } catch (error) {
        logger.error({ recordingId: input.recordingId, error }, 'Failed to get video download URL');
        throw error;
      }
    }),

  // Populate collectionId for recordings that don't have it
  populateCollectionId: protectedProcedure
    .input(z.object({ recordingId: z.number() }))
    .output(z.object({ collectionId: z.string().nullable() }))
    .mutation(async ({ input, ctx }) => {
      const recording = getRecordingById(input.recordingId);
      if (!recording || !recording.videoId) {
        return { collectionId: null };
      }

      // Already has collectionId
      if ((recording as any).collectionId) {
        return { collectionId: (recording as any).collectionId };
      }

      const apiKey = ctx.user?.apiKey;
      if (!apiKey) {
        return { collectionId: null };
      }

      try {
        const runtimeConfig = loadRuntimeConfig();
        const service = createVideoDBService(apiKey, runtimeConfig.apiUrl);
        const video = await service.getVideo(recording.videoId);
        const collectionId = video.collectionId || null;

        if (collectionId) {
          updateRecordingBySessionId(recording.sessionId, { collectionId });
          logger.info({ recordingId: input.recordingId, collectionId }, 'Populated collectionId for recording');
        }

        return { collectionId };
      } catch (error) {
        logger.error({ error, recordingId: input.recordingId }, 'Failed to fetch collectionId');
        return { collectionId: null };
      }
    }),

  // Update post-meeting checklist completion status
  updateChecklistCompletion: protectedProcedure
    .input(z.object({
      recordingId: z.number(),
      completedIndices: z.array(z.number()),
    }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input }) => {
      logger.debug({ recordingId: input.recordingId, completedIndices: input.completedIndices }, 'Updating checklist completion');

      const recording = getRecordingById(input.recordingId);
      if (!recording) {
        throw new Error('Recording not found');
      }

      updateRecordingBySessionId(recording.sessionId, {
        postMeetingChecklistCompleted: JSON.stringify(input.completedIndices),
      });

      return { success: true };
    }),
});
