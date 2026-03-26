import { ipcMain } from 'electron';
import { v4 as uuid } from 'uuid';
import { createChildLogger } from '../lib/logger';
import { createVisualIndexItem } from '../db';

const logger = createChildLogger('ipc-visual-index');

export function setupVisualIndexIPC(): void {
  ipcMain.handle('visual-index:save-item', async (_event, data: {
    recordingId: number;
    sessionId: string;
    text: string;
    startTime: number;
    endTime: number;
    rtstreamId?: string;
    rtstreamName?: string;
  }) => {
    try {
      const item = createVisualIndexItem({
        id: uuid(),
        recordingId: data.recordingId,
        sessionId: data.sessionId,
        text: data.text,
        startTime: data.startTime,
        endTime: data.endTime,
        rtstreamId: data.rtstreamId,
        rtstreamName: data.rtstreamName,
      });

      logger.debug({ recordingId: data.recordingId, id: item.id }, 'Saved visual index item to DB');
      return { success: true, id: item.id };
    } catch (error) {
      const err = error as Error;
      logger.error({ error: err.message }, 'Failed to save visual index item');
      return { success: false, error: err.message };
    }
  });
}
