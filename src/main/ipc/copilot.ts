/**
 * Meeting Co-Pilot IPC Handlers
 *
 * Handles IPC communication between main and renderer processes
 * for the Meeting Co-Pilot features.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { createChildLogger } from '../lib/logger';
import {
  getMeetingCopilot,
  type CopilotConfig,
  type ConversationMetrics,
  type Nudge,
  type CallSummary,
} from '../services/copilot';

const logger = createChildLogger('copilot-ipc');

let mainWindow: BrowserWindow | null = null;

/**
 * Set the main window reference for sending events
 */
export function setCopilotMainWindow(window: BrowserWindow): void {
  mainWindow = window;
}

/**
 * Send event to renderer
 */
function sendToRenderer(channel: string, data: any): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

/**
 * Setup Meeting Co-Pilot IPC handlers
 */
export function setupCopilotHandlers(): void {
  logger.info('Setting up Meeting Co-Pilot IPC handlers');

  const copilot = getMeetingCopilot();

  // Forward events to renderer
  copilot.on('transcript-segment', (segment) => {
    sendToRenderer('copilot:transcript', segment);
  });

  copilot.on('metrics-update', (data: { metrics: ConversationMetrics; health: number }) => {
    sendToRenderer('copilot:metrics', data);
  });

  copilot.on('nudge', (data: { nudge: Nudge }) => {
    sendToRenderer('copilot:nudge', data);
  });

  copilot.on('call-ended', (data: {
    summary: CallSummary;
    metrics: ConversationMetrics;
    duration: number;
  }) => {
    sendToRenderer('copilot:call-ended', data);
  });

  copilot.on('error', (data: { error: string; context?: string }) => {
    sendToRenderer('copilot:error', data);
  });

  // IPC Handlers

  /**
   * Initialize the copilot with API key
   */
  ipcMain.handle('copilot:initialize', async (_event, apiKey: string) => {
    try {
      copilot.initialize(apiKey);
      return { success: true };
    } catch (error) {
      logger.error({ error }, 'Failed to initialize copilot');
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Start call tracking
   */
  ipcMain.handle('copilot:start-call', async (_event, recordingId: number, sessionId: string) => {
    try {
      await copilot.startCall(recordingId, sessionId);
      return { success: true };
    } catch (error) {
      logger.error({ error }, 'Failed to start call');
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * End call and get summary
   */
  ipcMain.handle('copilot:end-call', async () => {
    try {
      const summary = await copilot.endCall();
      return { success: true, summary };
    } catch (error) {
      logger.error({ error }, 'Failed to end call');
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Process transcript segment
   */
  ipcMain.handle('copilot:transcript', async (_event, channel: 'me' | 'them', data: {
    text: string;
    is_final: boolean;
    start: number;
    end: number;
  }) => {
    try {
      await copilot.onTranscriptReceived(channel, data);
      return { success: true };
    } catch (error) {
      logger.error({ error }, 'Failed to process transcript');
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Update copilot configuration
   */
  ipcMain.handle('copilot:update-config', async (_event, config: Partial<CopilotConfig>) => {
    try {
      copilot.updateConfig(config);
      return { success: true };
    } catch (error) {
      logger.error({ error }, 'Failed to update config');
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Get current call state
   */
  ipcMain.handle('copilot:get-state', async () => {
    try {
      const state = copilot.getCallState();
      const metrics = copilot.getCurrentMetrics();

      return {
        success: true,
        data: {
          state,
          metrics,
          isActive: copilot.isCallActive(),
        },
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get state');
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Dismiss a nudge
   */
  ipcMain.handle('copilot:dismiss-nudge', async (_event, nudgeId: string) => {
    try {
      copilot.dismissNudge(nudgeId);
      return { success: true };
    } catch (error) {
      logger.error({ error }, 'Failed to dismiss nudge');
      return { success: false, error: (error as Error).message };
    }
  });

  logger.info('Meeting Co-Pilot IPC handlers registered');
}

/**
 * Remove Meeting Co-Pilot IPC handlers
 */
export function removeCopilotHandlers(): void {
  ipcMain.removeHandler('copilot:initialize');
  ipcMain.removeHandler('copilot:start-call');
  ipcMain.removeHandler('copilot:end-call');
  ipcMain.removeHandler('copilot:transcript');
  ipcMain.removeHandler('copilot:update-config');
  ipcMain.removeHandler('copilot:get-state');
  ipcMain.removeHandler('copilot:dismiss-nudge');

  logger.info('Meeting Co-Pilot IPC handlers removed');
}
