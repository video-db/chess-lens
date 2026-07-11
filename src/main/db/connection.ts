import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import * as schema from './schema';
import { initializeDatabaseSchema } from './bootstrap';
import { logger } from '../lib/logger';

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let sqlite: Database.Database | null = null;

export function getDbPath(): string {
  const userDataPath = app.getPath('userData');
  const dbDir = path.join(userDataPath, 'data');

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  return path.join(dbDir, 'chess-lens.db');
}

export function initDatabase(): ReturnType<typeof drizzle<typeof schema>> {
  if (db) return db;

  const dbPath = getDbPath();
  logger.info({ dbPath }, 'Initializing database');

  sqlite = new Database(dbPath);
  db = drizzle(sqlite, { schema });

  initializeDatabaseSchema(sqlite, db);

  logger.info('Database initialized successfully');
  return db;
}

export function getDatabase(): ReturnType<typeof drizzle<typeof schema>> {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function getSqliteDatabase(): Database.Database | null {
  return sqlite;
}

export function closeDatabase(): void {
  if (sqlite) {
    sqlite.close();
    sqlite = null;
    db = null;
    logger.info('Database connection closed');
  }
}
