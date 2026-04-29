/**
 * Session Recovery Service
 *
 * Recovers recordings that were exported by VideoDB while the app was closed.
 * Called on app startup to handle missed exports.
 *
 * Also cleans up sessions stuck in 'recording' status — these can only exist
 * if the app crashed mid-session.  Since the app just started, no recording
 * can genuinely be in progress, so any 'recording' row is stale and is
 * immediately marked 'failed'.
 */

import { createChildLogger } from '../lib/logger';
import { getAllRecordings, updateRecordingBySessionId } from '../db';
import { checkAndRecoverSession } from './recording-export.service';

const logger = createChildLogger('session-recovery');

export interface RecoveryResult {
  recovered: number;
  failed: number;
  skipped: number;
  /** Sessions that were stuck in 'recording' and cleaned up to 'failed'. */
  stuckFixed: number;
}

/**
 * At startup, mark any recording that is still in 'recording' status as
 * 'failed'.  The app just launched, so there is no active capture process —
 * every 'recording' row is a crash remnant.
 *
 * Returns the number of sessions fixed.
 */
export function cleanupStuckRecordingSessions(): number {
  const allRecordings = getAllRecordings();
  const stuck = allRecordings.filter((r) => r.status === 'recording');

  if (stuck.length === 0) {
    logger.debug('No stuck recording sessions found at startup');
    return 0;
  }

  logger.warn(
    { count: stuck.length, sessionIds: stuck.map((r) => r.sessionId) },
    'Found sessions stuck in recording status (app crash?) — marking as failed'
  );

  for (const recording of stuck) {
    try {
      updateRecordingBySessionId(recording.sessionId, { status: 'failed' });
      logger.info(
        { sessionId: recording.sessionId, recordingId: recording.id },
        'Stuck recording session marked as failed'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ sessionId: recording.sessionId, error: msg }, 'Failed to mark stuck session as failed');
    }
  }

  return stuck.length;
}

/**
 * Recover any recordings stuck in 'processing' status
 */
export async function recoverPendingSessions(
  apiKey: string,
  apiUrl?: string,
  collectionId?: string
): Promise<RecoveryResult> {
  const result: RecoveryResult = {
    recovered: 0,
    failed: 0,
    skipped: 0,
    stuckFixed: cleanupStuckRecordingSessions(),
  };

  const allRecordings = getAllRecordings();
  const pendingRecordings = allRecordings.filter(
    r => r.status === 'processing' && !r.videoId
  );

  if (pendingRecordings.length === 0) {
    logger.debug('No pending recordings to recover');
    return result;
  }

  logger.info({ count: pendingRecordings.length, collectionId }, 'Found pending recordings to recover');

  for (const recording of pendingRecordings) {
    const recovery = await checkAndRecoverSession(
      recording.sessionId,
      apiKey,
      apiUrl,
      true, // trigger insights
      collectionId
    );

    if (recovery.exported && recovery.success) {
      result.recovered++;
      logger.info(
        { sessionId: recording.sessionId, videoId: recovery.videoId },
        'Recording recovered'
      );
    } else if (recovery.exported && !recovery.success) {
      result.failed++;
      logger.error(
        { sessionId: recording.sessionId, error: recovery.error },
        'Failed to recover exported recording'
      );
    } else {
      result.skipped++;
      logger.debug(
        { sessionId: recording.sessionId },
        'Recording not exported yet, skipping'
      );
    }
  }

  logger.info(result, 'Session recovery complete');
  return result;
}

// Factory function for backward compatibility
export function createSessionRecoveryService(apiKey: string, apiUrl?: string, collectionId?: string) {
  return {
    recoverPendingSessions: () => recoverPendingSessions(apiKey, apiUrl, collectionId),
  };
}
