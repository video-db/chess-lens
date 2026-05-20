import pino from 'pino';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

function getLogsDir(): string {
  try {
    const userDataPath = app.getPath('userData');
    const logsDir = path.join(userDataPath, 'logs');

    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    return logsDir;
  } catch {
    // App not ready yet, fall back to OS temp dir
    return process.env.TEMP || process.env.TMP || '/tmp';
  }
}

function getLogFilePath(): string {
  const logsDir = getLogsDir();
  const date = new Date().toISOString().split('T')[0];
  return path.join(logsDir, `app-${date}.log`);
}

const isElectron = Boolean(app?.isPackaged);
const isDev = process.env.NODE_ENV === 'development' || !isElectron;

// ─── File stream (always open, dev and prod) ─────────────────────────────────
//
// Lazily opened on first write so that `app.getPath('userData')` is
// guaranteed to be available (the app is fully initialised by then).

let fileStream: fs.WriteStream | null = null;

function getFileStream(): fs.WriteStream {
  if (!fileStream) {
    const logPath = getLogFilePath();
    fileStream = fs.createWriteStream(logPath, { flags: 'a' });
    console.log(`[Logger] Writing logs to: ${logPath}`);
  }
  return fileStream;
}

// Destination object for the file — pino writes newline-delimited JSON here.
const fileDestination = {
  write(msg: string): void {
    try {
      getFileStream().write(msg);
    } catch {
      // Ignore file write errors — never crash the app over logging
    }
  },
};

// ─── Logger construction ─────────────────────────────────────────────────────
//
// In dev:   pino-pretty → terminal (colourised, readable)
//           + raw JSON  → app-YYYY-MM-DD.log  (machine-readable, analysable)
//
// In prod:  raw JSON    → both stdout and app-YYYY-MM-DD.log

let logger: pino.Logger;

if (isDev) {
  // pino.transport() creates a worker-thread pretty-printer that writes to
  // stdout.  We simultaneously write raw JSON to the log file via a sync
  // destination so the latency analyser can parse it later.
  const prettyTransport = pino.transport({
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
      objectPrintDepth: 10,
      singleLine: false,
    },
  });

  // multistream: pretty to terminal, JSON to file
  logger = pino(
    { level: 'debug', base: { pid: process.pid } },
    pino.multistream([
      { stream: prettyTransport, level: 'debug' },
      { stream: fileDestination, level: 'debug' },
    ]),
  );
} else {
  // Production: write JSON to both stdout and the log file
  const prodStream = {
    write(msg: string): void {
      process.stdout.write(msg);
      fileDestination.write(msg);
    },
  };

  logger = pino(
    { level: 'info', base: { pid: process.pid } },
    prodStream,
  );
}

export { logger };

export function createChildLogger(name: string) {
  return logger.child({ module: name });
}

/**
 * Get the path to the logs directory for the user to access
 */
export function getLogsPath(): string {
  return getLogsDir();
}

/**
 * Close the log file stream (call on app exit)
 */
export function closeLogger(): void {
  if (fileStream) {
    fileStream.end();
    fileStream = null;
  }
}
