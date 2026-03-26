import { ipcMain, shell, Notification, BrowserWindow } from 'electron';
import { loadAppConfig, loadRuntimeConfig, clearAppConfig } from '../lib/config';
import { VideoDBService } from '../services/videodb.service';
import { getServerStatus } from '../server';
import { createChildLogger } from '../lib/logger';
import os from 'os';
import path from 'path';

const logger = createChildLogger('ipc-app');

export function setupAppHandlers(): void {
  ipcMain.handle(
    'get-settings',
    async (): Promise<{
      accessToken?: string;
      userName?: string;
      apiKey?: string;
      apiUrl?: string;
    }> => {
      const appConfig = loadAppConfig();
      const runtimeConfig = loadRuntimeConfig();

      return {
        accessToken: appConfig.accessToken,
        userName: appConfig.userName,
        apiKey: appConfig.apiKey,
        apiUrl: runtimeConfig.apiUrl,
      };
    }
  );

  ipcMain.handle('get-server-port', async (): Promise<number> => {
    const status = getServerStatus();
    return status.port || 51731; // fallback to default
  });

  ipcMain.handle('logout', async (): Promise<void> => {
    logger.info('User logging out');
    clearAppConfig();
    VideoDBService.clearCache();
  });

  ipcMain.handle('open-external-link', async (_event, url: string): Promise<void> => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      await shell.openExternal(url);
    }
  });

  ipcMain.handle('open-call-md-folder', async (_event, folderPath: string): Promise<void> => {
    // Expand ~ to home directory
    const expandedPath = folderPath.replace(/^~/, os.homedir());
    const absolutePath = path.resolve(expandedPath);

    // Security check: only allow paths under ~/.call_md
    const callMdRoot = path.join(os.homedir(), '.call_md');
    if (!absolutePath.startsWith(callMdRoot)) {
      logger.warn({ path: absolutePath }, 'Attempted to open folder outside .call_md');
      return;
    }

    try {
      await shell.openPath(absolutePath);
    } catch (error) {
      logger.error({ error, path: absolutePath }, 'Failed to open call_md folder');
    }
  });

  ipcMain.handle(
    'show-notification',
    async (_event, title: string, body: string): Promise<void> => {
      if (Notification.isSupported()) {
        const notification = new Notification({
          title,
          body,
        });
        notification.show();
      }
    }
  );

  ipcMain.handle('open-player-window', async (_event, url: string): Promise<void> => {
    const playerWindow = new BrowserWindow({
      width: 1024,
      height: 768,
      title: 'Call.md - Player',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    await playerWindow.loadURL(url);
  });
}
