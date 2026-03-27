/**
 * Export Poller Service
 *
 * Polls VideoDB for capture session export completion.
 * Replaces the unreliable WebSocket-based approach.
 */

import { createChildLogger } from '../lib/logger';
import { updateRecordingBySessionId, getRecordingBySessionId, getTranscriptSegmentsBySession } from '../db';
import { checkSessionExport, recoverExportedRecording } from './recording-export.service';
import { triggerWorkflowWebhooks, type MeetingCompletionData } from './workflow-webhook.service';

const logger = createChildLogger('export-poller');

// Polling configuration
const POLL_INTERVAL_MS = 3000; // 3 seconds
const MAX_POLL_DURATION_MS = 30 * 60 * 1000; // 30 minutes max

// Track active pollers
interface ActivePoller {
  intervalId: NodeJS.Timeout;
  startTime: number;
  apiKey: string;
  apiUrl?: string;
  collectionId?: string;
}

const activePollers = new Map<string, ActivePoller>();

/**
 * Start polling for capture session export completion
 */
export function startExportPoller(
  sessionId: string,
  apiKey: string,
  _accessToken: string, // Kept for API compatibility, not used
  apiUrl?: string,
  collectionId?: string
): void {
  if (activePollers.has(sessionId)) {
    logger.debug({ sessionId }, 'Poller already active for session');
    return;
  }

  logger.info({ sessionId, collectionId }, 'Starting export poller');

  const startTime = Date.now();

  const pollForExport = async () => {
    const elapsed = Date.now() - startTime;

    // Check timeout
    if (elapsed > MAX_POLL_DURATION_MS) {
      logger.warn({ sessionId, elapsedMs: elapsed }, 'Polling timed out');
      stopExportPoller(sessionId);
      updateRecordingBySessionId(sessionId, { status: 'failed' });
      return;
    }

    const result = await checkSessionExport(sessionId, apiKey, apiUrl, collectionId);

    logger.debug(
      { sessionId, status: result.status, exportedVideoId: result.videoId },
      'Polled session status'
    );

    if (result.exported && result.videoId) {
      logger.info({ sessionId, exportedVideoId: result.videoId }, 'Session exported!');
      stopExportPoller(sessionId);

      const recovery = await recoverExportedRecording(
        sessionId,
        result.videoId,
        apiKey,
        apiUrl,
        true, // trigger insights
        collectionId
      );

      if (!recovery.success) {
        logger.error({ sessionId, error: recovery.error }, 'Failed to recover recording');
      } else {
        // Trigger workflow webhooks now that we have the video data
        triggerPostExportWorkflows(sessionId).catch((err) => {
          logger.error({ sessionId, error: err }, 'Failed to trigger workflow webhooks');
        });
      }
    } else if (result.status === 'failed') {
      logger.error({ sessionId }, 'Session failed on VideoDB');
      stopExportPoller(sessionId);
      updateRecordingBySessionId(sessionId, { status: 'failed' });
    } else if (result.error) {
      // Transient error, keep polling
      logger.debug({ sessionId, error: result.error }, 'Poll error, will retry');
    }
  };

  // Poll immediately, then at intervals
  pollForExport();
  const intervalId = setInterval(pollForExport, POLL_INTERVAL_MS);

  activePollers.set(sessionId, { intervalId, startTime, apiKey, apiUrl, collectionId });
}

/**
 * Stop the export poller for a session
 */
export function stopExportPoller(sessionId: string): void {
  const poller = activePollers.get(sessionId);
  if (poller) {
    clearInterval(poller.intervalId);
    activePollers.delete(sessionId);
    logger.debug({ sessionId }, 'Stopped poller');
  }
}

/**
 * Stop all active pollers (for app shutdown)
 */
export function stopAllExportPollers(): void {
  for (const [sessionId] of activePollers) {
    stopExportPoller(sessionId);
  }
  logger.info({ count: activePollers.size }, 'All pollers stopped');
}

/**
 * Check if a poller is active for a session
 */
export function isPollerActive(sessionId: string): boolean {
  return activePollers.has(sessionId);
}

/**
 * Get count of active pollers
 */
export function getActivePollerCount(): number {
  return activePollers.size;
}

/**
 * Trigger workflow webhooks after export completes
 * This is called AFTER the recording has been updated with videoId/playerUrl
 */
async function triggerPostExportWorkflows(sessionId: string): Promise<void> {
  const recording = getRecordingBySessionId(sessionId);
  if (!recording) {
    logger.warn({ sessionId }, 'Recording not found for workflow webhooks');
    return;
  }

  // Check we have the video data
  if (!recording.videoId || !recording.playerUrl) {
    logger.warn({ sessionId }, 'Recording missing video data for workflow webhooks');
    return;
  }

  // Get transcript segments
  const segments = getTranscriptSegmentsBySession(sessionId);
  const transcript = segments.map((seg) => ({
    speaker: seg.channel as 'me' | 'them',
    text: seg.text,
    timestamp: seg.startTime,
  }));

  // Parse stored summary data
  let summary: string | undefined;
  let topics: string[] | undefined;
  let actionItems: string[] | undefined;
  let checklist: Array<{ text: string; completed: boolean }> | undefined;

  if ((recording as any).shortOverview) {
    summary = (recording as any).shortOverview;
  }

  if ((recording as any).keyPoints) {
    try {
      const keyPoints = JSON.parse((recording as any).keyPoints);
      if (Array.isArray(keyPoints)) {
        topics = keyPoints.map((kp: any) => kp.topic);
        actionItems = keyPoints.flatMap((kp: any) => kp.points || []);
      }
    } catch {
      // ignore parse errors
    }
  }

  if ((recording as any).postMeetingChecklist) {
    try {
      const items = JSON.parse((recording as any).postMeetingChecklist);
      if (Array.isArray(items)) {
        checklist = items.map((item: string) => ({ text: item, completed: false }));
      }
    } catch {
      // ignore parse errors
    }
  }

  const meetingData: MeetingCompletionData = {
    recordingId: recording.id,
    title: (recording as any).meetingName || 'Meeting Recording',
    description: (recording as any).meetingDescription,
    startedAt: recording.createdAt,
    endedAt: new Date().toISOString(),
    durationSeconds: recording.duration || 0,
    exportedVideoId: recording.videoId,
    playerUrl: recording.playerUrl,
    streamId: recording.streamUrl || undefined,
    summary,
    topics,
    actionItems,
    checklist,
    transcript,
  };

  logger.info(
    { sessionId, recordingId: recording.id, hasPlayerUrl: !!recording.playerUrl },
    'Triggering workflow webhooks after export'
  );

  await triggerWorkflowWebhooks(meetingData);
}
