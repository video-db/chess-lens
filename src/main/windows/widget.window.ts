import { BrowserWindow, screen } from 'electron';
import path from 'path';
import { createChildLogger } from '../lib/logger';
import { loadAppConfig, saveAppConfig } from '../lib/config';
import { syncWidgetState } from '../ipc/widget';

const logger = createChildLogger('widget-window');

let widgetWindow: BrowserWindow | null = null;
const isDev = process.env.NODE_ENV !== 'production' && !require('electron').app.isPackaged;

const WIDGET_WIDTH = 378;
const WIDGET_DEFAULT_HEIGHT = 680;
const WIDGET_MIN_HEIGHT = 300;
const WIDGET_MARGIN = 20;
/** Padding added on top of reported content height to avoid a hairline clip. */
const WIDGET_HEIGHT_PADDING = 24;

interface WidgetPosition {
  x: number;
  y: number;
}

function loadWidgetPosition(): WidgetPosition | null {
  const config = loadAppConfig();
  return config.widgetPosition || null;
}

function saveWidgetPosition(position: WidgetPosition): void {
  const config = loadAppConfig();
  saveAppConfig({ ...config, widgetPosition: position });
}

function getDefaultPosition(): WidgetPosition {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  return {
    x: width - WIDGET_WIDTH - WIDGET_MARGIN,
    // Anchor the bottom of the window near the bottom of the screen
    y: Math.max(0, height - WIDGET_DEFAULT_HEIGHT - WIDGET_MARGIN),
  };
}

function validatePosition(position: WidgetPosition): WidgetPosition {
  const displays = screen.getAllDisplays();
  let isValid = false;

  for (const display of displays) {
    const { x, y, width, height } = display.bounds;
    if (
      position.x >= x &&
      position.x < x + width &&
      position.y >= y &&
      position.y < y + height
    ) {
      isValid = true;
      break;
    }
  }

  return isValid ? position : getDefaultPosition();
}

export function createWidgetWindow(): BrowserWindow {
  logger.info('Creating widget window');

  if (widgetWindow && !widgetWindow.isDestroyed()) {
    logger.info('Widget window already exists, showing');
    syncWidgetState();
    widgetWindow.show();
    return widgetWindow;
  }

  const savedPosition = loadWidgetPosition();
  const position = savedPosition ? validatePosition(savedPosition) : getDefaultPosition();

  widgetWindow = new BrowserWindow({
    width: WIDGET_WIDTH,
    height: WIDGET_DEFAULT_HEIGHT,
    minWidth: WIDGET_WIDTH,
    maxWidth: WIDGET_WIDTH,
    minHeight: WIDGET_MIN_HEIGHT,
    x: position.x,
    y: position.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    focusable: true,
    fullscreenable: false,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      // __dirname is dist/main/windows, preload is at dist/preload
      preload: path.join(__dirname, '..', '..', 'preload', 'widget.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  // Critical: Visible on fullscreen apps (macOS)
  widgetWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });

  // Keep overlay above fullscreen/borderless windows where possible
  widgetWindow.setAlwaysOnTop(true, 'screen-saver', 1);

  // Exclude the overlay from screen capture (desktopCapturer, screen share, OBS, etc.)
  // so the widget is visible to the user but invisible to the FEN-extraction model.
  // macOS: sets NSWindowSharingNone. Windows: WDA_EXCLUDEFROMCAPTURE.
  widgetWindow.setContentProtection(true);

  // Load the widget HTML
  if (isDev) {
    const VITE_DEV_PORT = 51730;
    widgetWindow.loadURL(`http://localhost:${VITE_DEV_PORT}/widget.html`);
  } else {
    // __dirname is dist/main/windows, renderer is at dist/renderer
    widgetWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'widget.html'));
  }

    widgetWindow.webContents.once('did-finish-load', () => {
      syncWidgetState();
    });

  // Save position on move
  widgetWindow.on('moved', () => {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      const [x, y] = widgetWindow.getPosition();
      saveWidgetPosition({ x, y });
    }
  });

  widgetWindow.on('closed', () => {
    widgetWindow = null;
  });

  widgetWindow.once('ready-to-show', () => {
    if (!widgetWindow || widgetWindow.isDestroyed()) return;

    // Do not steal focus from the game; still force to top-most layer
    widgetWindow.showInactive();
    widgetWindow.moveTop();
    widgetWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    syncWidgetState();
  });

  return widgetWindow;
}

export function showWidgetWindow(): void {
  logger.info('showWidgetWindow called');
  if (!widgetWindow || widgetWindow.isDestroyed()) {
    createWidgetWindow();
  } else {
    // Re-assert overlay flags every time we show
    widgetWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
    });
    widgetWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    widgetWindow.showInactive();
    widgetWindow.moveTop();
    syncWidgetState();
  }
}

export function hideWidgetWindow(): void {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.hide();
  }
}

export function closeWidgetWindow(): void {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.close();
    widgetWindow = null;
  }
}

export function getWidgetWindow(): BrowserWindow | null {
  return widgetWindow && !widgetWindow.isDestroyed() ? widgetWindow : null;
}

export function sendToWidget(channel: string, data: unknown): void {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    logger.debug({ channel }, 'Sending to widget');
    widgetWindow.webContents.send(channel, data);
  } else {
    logger.warn({ channel }, 'Widget window not available, cannot send');
  }
}

/**
 * Resize the widget window height to fit its content.
 *
 * Called whenever the renderer reports a new content height via the
 * `widget:content-height` IPC channel.  The window grows or shrinks to match,
 * but is always clamped so it never extends below the bottom of the display it
 * currently lives on.
 *
 * The x/y position is never changed — the window stays exactly where the user
 * dragged it.  If the required height would push the bottom edge off-screen, the
 * window is repositioned upward just enough to stay visible.
 */
export function resizeWidgetToContent(contentHeight: number): void {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;

  const targetHeight = Math.max(
    WIDGET_MIN_HEIGHT,
    Math.ceil(contentHeight) + WIDGET_HEIGHT_PADDING
  );

  // Find the display the window currently lives on
  const [winX, winY] = widgetWindow.getPosition();
  const displays = screen.getAllDisplays();
  const currentDisplay =
    displays.find((d) => {
      const { x, y, width, height } = d.bounds;
      return winX >= x && winX < x + width && winY >= y && winY < y + height;
    }) ?? screen.getPrimaryDisplay();

  const { y: displayY, height: displayHeight } = currentDisplay.workArea;
  const maxAllowedHeight = displayHeight - WIDGET_MARGIN;
  const clampedHeight = Math.min(targetHeight, maxAllowedHeight);

  // If the bottom edge would go off-screen, shift the window up
  const bottomEdge = winY + clampedHeight;
  const screenBottom = displayY + displayHeight - WIDGET_MARGIN;
  const newY = bottomEdge > screenBottom ? Math.max(displayY, screenBottom - clampedHeight) : winY;

  if (newY !== winY) {
    widgetWindow.setPosition(winX, newY);
  }

  const [currentW, currentH] = widgetWindow.getSize();
  if (currentH !== clampedHeight) {
    widgetWindow.setSize(currentW, clampedHeight);
    logger.debug({ targetHeight, clampedHeight, winY, newY }, 'Widget resized to content');
  }
}
