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
import type { CaptureSessionFull } from 'videodb';
import { createChildLogger } from '../lib/logger';
import { updateRecordingBySessionId } from '../db';

const logger = createChildLogger('recording-export');

export interface ExportCheckResult {
  exported: boolean;
  videoId?: string;
  status?: string;
  error?: string;
}

export interface ExportRecoveryResult {
  success: boolean;
  recordingId?: number;
  videoId?: string;
  error?: string;
}

/**
 * Check if a capture session has exported
 */
export async function checkSessionExport(
  sessionId: string,
  apiKey: string,
  apiUrl?: string,
  collectionId?: string
): Promise<ExportCheckResult> {
  try {
    const conn = connect(apiUrl ? { apiKey, baseUrl: apiUrl } : { apiKey });
    const session: CaptureSessionFull = await conn.getCaptureSession(sessionId, collectionId);
    await session.refresh();

    return {
      exported: !!session.exportedVideoId,
      videoId: session.exportedVideoId,
      status: session.status,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.debug({ sessionId, error: errorMsg }, 'Failed to check session export status');
    return {
      exported: false,
      error: errorMsg,
    };
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
