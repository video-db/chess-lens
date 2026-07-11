/**
 * Live Assist IPC Handlers
 *
 * Handles IPC communication for the live assist feature and MCP inference.
 * Forwards events from both services to the renderer.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { getLiveAssistService, resetLiveAssistService } from '../services/live-assist.service';
import type { MeetingContext } from '../services/live-assist.service';
import { getMCPInferenceService, resetMCPInferenceService } from '../services/mcp/mcp-inference.service';
import { getMeetingCopilot } from '../services/copilot/sales-copilot.service';
import { createChildLogger } from '../lib/logger';
import { updateWidgetLiveAssist, updateWidgetFen, sendWidgetNoBoard } from './widget';
import { getChessScreenshotService } from '../services/chess/chess-screenshot.service';
import type { LiveInsightsEvent } from '../../shared/types/live-assist.types';
import type { MCPDisplayResult } from '../../shared/types/mcp.types';

const logger = createChildLogger('ipc-live-assist');

let mainWindow: BrowserWindow | null = null;

function sendToRenderer(channel: string, data: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

export function setLiveAssistWindow(window: BrowserWindow): void {
  mainWindow = window;
}

export function setupLiveAssistHandlers(): void {
  // Start live assist (also starts MCP inference)
  ipcMain.handle('live-assist:start', async (_event, context?: MeetingContext) => {
    logger.info(
      {
        hasContext: !!context,
        gameId: context?.gameId,
        hasName: !!context?.name,
      },
      'Starting live assist and MCP inference'
    );

    // Clear any stale tips/FEN from the previous session before starting a new one.
    updateWidgetLiveAssist({ sayThis: [], askThis: [], clearExisting: true });

    // Start Live Assist service
    const liveAssistService = getLiveAssistService();
    liveAssistService.removeAllListeners('insights');
    liveAssistService.removeAllListeners('fen');
    liveAssistService.removeAllListeners('no-board');
    liveAssistService.on('insights', (event: LiveInsightsEvent) => {
      logger.info(
        {
          sayCount: event.insights.say_this.length,
          askCount: event.insights.ask_this.length,
          clearExisting: !!event.clearExisting,
          isFlipAck: !!event.isFlipAck,
          moveSan: (event as any).moveSan,
          playedMoveSan: (event as any).playedMoveSan,
          turn: (event as any).turn,
        },
        'Sending insights to renderer'
      );

      // During a user-initiated turn flip, the engine-only placeholder emit is
      // tagged isFlipAck. Skip forwarding it to both the main window and the
      // widget so the OLD coaching tip stays visible until the real new tip arrives.
      if (event.isFlipAck) {
        logger.debug('[live-assist] Suppressing isFlipAck engine-only insights emit — keeping old tip visible');
        return;
      }

      sendToRenderer('live-assist:update', event);
      // Also send to floating widget
      updateWidgetLiveAssist({
        sayThis: event.insights.say_this,
        askThis: event.insights.ask_this,
        clearExisting: event.clearExisting,
      });
      // Persist coaching tips to DB for post-game accuracy and post-game chart.
      // WP fields (winChance, winChanceBefore, engineEval, centipawnLoss, turn) are
      // included on the insights event only for confirmed canonical moves (gated by
      // isConfirmedMove in runCoachingLLM) so only real moves contribute to accuracy.
      const sayText = event.insights.say_this[0] ?? '';
      const askText = event.insights.ask_this[0] ?? '';
      const hasWpData = event.winChance !== undefined || event.winChanceBefore !== undefined || event.centipawnLoss !== undefined;
      if ((sayText && askText) || hasWpData) {
        try {
          getMeetingCopilot().addCoachingTip(sayText, askText, event.winChance, event.winChanceBefore, event.engineEval, event.centipawnLoss, event.turn);
        } catch {
          // Copilot may not be active (e.g. tests) — silently ignore
        }
      }
    });
    liveAssistService.on('fen', (data: { fen: string; displayFen: string; board: string | null; turn: 'w' | 'b' | null; boardOrientation?: 'white' | 'black'; engineSan?: string; engineLan?: string; engineFrom?: string; engineTo?: string; engineEval?: number; engineMate?: number | null; isFlipAck?: boolean }) => {
      logger.info({ fen: data.fen.slice(0, 40), displayFen: data.displayFen.slice(0, 40), turn: data.turn, isFlipAck: !!data.isFlipAck }, '[live-assist ipc] fen listener fired — forwarding to widget');
      sendToRenderer('live-assist:fen', data);
      updateWidgetFen(data);
    });
    liveAssistService.on('no-board', () => {
      // Invalidate the last confirmed FEN in the screenshot service so the
      // temporal-consistency delta gate doesn't block the first post-recovery
      // frame (which may be a very different position from before disappearance).
      getChessScreenshotService().invalidateLastConfirmed();
      sendWidgetNoBoard();
    });
    liveAssistService.start(context);

    // Start MCP Inference service
    const mcpInferenceService = getMCPInferenceService();
    mcpInferenceService.removeAllListeners('result');
    mcpInferenceService.on('result', (result: MCPDisplayResult) => {
      logger.info({ resultId: result.id }, 'Sending MCP inference result to renderer');
      sendToRenderer('mcp:result', { result });
    });
    mcpInferenceService.start();

    return { success: true };
  });

  // Stop live assist (also stops MCP inference)
  ipcMain.handle('live-assist:stop', async () => {
    logger.info('Stopping live assist and MCP inference');

    const liveAssistService = getLiveAssistService();
    liveAssistService.stop();

    const mcpInferenceService = getMCPInferenceService();
    mcpInferenceService.stop();

    return { success: true };
  });

  // Add transcript (called from global recorder events)
  ipcMain.handle('live-assist:add-transcript', async (_event, text: string, source: 'mic' | 'system_audio') => {
    // Forward to both services
    const liveAssistService = getLiveAssistService();
    liveAssistService.addTranscript(text, source);

    const mcpInferenceService = getMCPInferenceService();
    mcpInferenceService.addTranscript(text, source);

    return { success: true };
  });

  // Add visual index (called when screen analysis is received)
  ipcMain.handle('live-assist:add-visual-index', async (_event, text: string) => {
    logger.debug({ length: text.length, preview: text.substring(0, 140) }, 'Forwarding visual index to live assist');
    const liveAssistService = getLiveAssistService();
    liveAssistService.addVisualIndex(text);

    return { success: true };
  });

  // Clear live assist state
  ipcMain.handle('live-assist:clear', async () => {
    const liveAssistService = getLiveAssistService();
    liveAssistService.clear();

    const mcpInferenceService = getMCPInferenceService();
    mcpInferenceService.clear();

    return { success: true };
  });

  // Chat: answer a player's question about a tip or the current position
  ipcMain.handle('live-assist:chat', async (_event, question: string, tipContext?: string) => {
    try {
      const liveAssistService = getLiveAssistService();
      const reply = await liveAssistService.chat(question, tipContext);
      return { success: true, reply };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.warn({ error }, '[live-assist:chat] Failed');
      return { success: false, error };
    }
  });

  // Flip turn: user-initiated override of the detected side-to-move
  ipcMain.handle('live-assist:flip-turn', async () => {
    const liveAssistService = getLiveAssistService();
    liveAssistService.flipTurn();
    return { success: true };
  });
}

export function cleanupLiveAssist(): void {
  resetLiveAssistService();
  resetMCPInferenceService();
}
