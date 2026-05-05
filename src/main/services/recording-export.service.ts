/**
 * Recording Export Service
 *
 * Centralized service for handling capture session exports.
 * Used by:
 * - Export poller (real-time polling after recording stops)
 * - Session recovery (startup recovery for missed exports)
 * - Cleanup stale (on-demand recovery check)
 */

import { connect } from 'videodb';
import { createChildLogger } from '../lib/logger';
import { updateRecordingBySessionId } from '../db';

const logger = createChildLogger('recording-export');

export interface ExportCheckResult {
  exported: boolean;
  videoId?: string;
  status?: string;
  error?: string;
  retryExport?: boolean; // true when export was re-triggered after a 'failed' exportStatus
}

export interface ExportRecoveryResult {
  success: boolean;
  recordingId?: number;
  videoId?: string;
  error?: string;
}

/**
 * Poll export status for a capture session.
 *
 * Strategy (derived from observing actual API behaviour):
 *   1. refresh() is the source of truth — it returns the real exportStatus and
 *      exportedVideoId once the export pipeline completes.
 *   2. session.export() is the trigger — call it once after status === "stopped"
 *      to kick off the export pipeline. Subsequent calls are no-ops.
 *   3. Completion is detected via refresh() returning exportStatus === "exported"
 *      with a non-null exportedVideoId, NOT from the export() response.
 *   4. If refresh() returns exportStatus === "failed", stop polling immediately.
 */
export async function checkSessionExport(
  sessionId: string,
  apiKey: string,
  apiUrl?: string,
  collectionId?: string
): Promise<ExportCheckResult> {
  try {
    const conn = connect(apiUrl ? { apiKey, baseUrl: apiUrl } : { apiKey });
    const session = await conn.getCaptureSession(sessionId, collectionId);

    // refresh() gives us the authoritative server-side state.
    await session.refresh();

    const sessionStatus = session.status;
    const exportStatus = session.exportStatus;
    const exportedVideoId = session.exportedVideoId;

    logger.debug(
      { sessionId, sessionStatus, exportStatus, exportedVideoId },
      'Session status after refresh'
    );

    // Already done — export completed on a previous poll cycle.
    if (exportStatus === 'exported' && exportedVideoId) {
      return { exported: true, videoId: exportedVideoId, status: exportStatus };
    }

    // Export pipeline failed on the server side — log full state and re-trigger export once.
    if (exportStatus === 'failed') {
      logger.warn(
        {
          sessionId,
          sessionStatus,
          exportStatus,
          exportedVideoId,
        },
        'Export failed on server (exportStatus=failed) — re-triggering export'
      );
      // Attempt a fresh export trigger so the server can retry the pipeline.
      try {
        const retryRes = await session.export();
        logger.info({ sessionId, retryResponse: retryRes }, 'Re-triggered export after failure');
      } catch (retryErr) {
        const retryErrMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        logger.warn({ sessionId, error: retryErrMsg }, 'Failed to re-trigger export after failure');
      }
      return { exported: false, status: 'failed', retryExport: true };
    }

    // Upload still in progress — session not yet stopped on server, skip this cycle.
    if (sessionStatus !== 'stopped') {
      logger.debug({ sessionId, sessionStatus }, 'Session not yet stopped on server, waiting');
      return { exported: false, status: sessionStatus };
    }

    // Session stopped but export not yet started — trigger it.
    // If export is already "exporting" this is effectively a no-op on the server.
    if (!exportStatus || exportStatus === 'pending') {
      logger.info({ sessionId }, 'Triggering export for stopped session');
      try {
        const exportRes = await session.export();
        logger.debug({ sessionId, exportResponse: exportRes }, 'Export triggered');
      } catch (exportErr) {
        const exportErrMsg = exportErr instanceof Error ? exportErr.message : String(exportErr);
        logger.warn({ sessionId, error: exportErrMsg }, 'Export trigger threw an error');
      }
    }

    // Return current (non-exported) status; next poll cycle will check progress.
    return { exported: false, status: exportStatus || sessionStatus };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.debug({ sessionId, error: errorMsg }, 'Failed to check session export');
    return { exported: false, error: errorMsg };
  }
}

/**
 * Recover a recording that has exported on VideoDB
 * Updates the local database with video info
 * Note: triggerInsights param is deprecated - summaries are now generated immediately after call ends
 */
export async function recoverExportedRecording(
  sessionId: string,
  videoId: string,
  apiKey: string,
  apiUrl?: string,
  _triggerInsights: boolean = true, // deprecated, kept for API compatibility
  collectionId?: string
): Promise<ExportRecoveryResult> {
  try {
    const conn = connect(apiUrl ? { apiKey, baseUrl: apiUrl } : { apiKey });
    const collection = await conn.getCollection(collectionId);
    const video = await collection.getVideo(videoId);

    // Parse duration from video.length
    let duration: number | null = null;
    if (video.length) {
      const parsed = parseFloat(video.length);
      if (!isNaN(parsed)) {
        duration = Math.round(parsed);
      }
    }

    // Update recording in database
    const recording = updateRecordingBySessionId(sessionId, {
      videoId,
      collectionId: video.collectionId || null,
      streamUrl: video.streamUrl || null,
      playerUrl: video.playerUrl || null,
      duration,
      status: 'available',
      insightsStatus: 'pending',
    });

    if (!recording) {
      return {
        success: false,
        error: 'Recording not found in database',
      };
    }

    logger.info(
      {
        sessionId,
        recordingId: recording.id,
        videoId,
        streamUrl: video.streamUrl,
        playerUrl: video.playerUrl,
        duration,
      },
      'Recording recovered with video info'
    );

    // Note: Insights/summaries are now generated immediately after call ends
    // via the SummaryGeneratorService, so we skip VideoDB insights processing

    return {
      success: true,
      recordingId: recording.id,
      videoId,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ sessionId, videoId, error: errorMsg }, 'Failed to recover exported recording');
    return {
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Check and recover a session in one call
 * Convenience method that combines checkSessionExport + recoverExportedRecording
 */
export async function checkAndRecoverSession(
  sessionId: string,
  apiKey: string,
  apiUrl?: string,
  triggerInsights: boolean = true,
  collectionId?: string
): Promise<ExportRecoveryResult & { exported: boolean }> {
  const checkResult = await checkSessionExport(sessionId, apiKey, apiUrl, collectionId);

  if (!checkResult.exported || !checkResult.videoId) {
    return {
      exported: false,
      success: false,
      error: checkResult.error || 'Not exported yet',
    };
  }

  const recoveryResult = await recoverExportedRecording(
    sessionId,
    checkResult.videoId,
    apiKey,
    apiUrl,
    triggerInsights,
    collectionId
  );

  return {
    exported: true,
    ...recoveryResult,
  };
}
