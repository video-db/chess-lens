import type Database from 'better-sqlite3';
import type { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { seedDefaultCueCards, seedDefaultPlaybooks, seedDefaultSettings } from './seeds';
import { logger } from '../lib/logger';

type AppDatabase = ReturnType<typeof drizzle<typeof schema>>;

export function initializeDatabaseSchema(sqlite: Database.Database, db: AppDatabase): void {
  sqlite.exec(`
    -- Core tables
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      api_key TEXT NOT NULL,
      access_token TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS recordings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT,
      stream_url TEXT,
      player_url TEXT,
      session_id TEXT NOT NULL,
      game_id TEXT,
      duration INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'recording' CHECK(status IN ('recording', 'processing', 'available', 'failed')),
      insights TEXT,
      insights_status TEXT NOT NULL DEFAULT 'pending' CHECK(insights_status IN ('pending', 'processing', 'ready', 'failed')),
      short_overview TEXT,
      key_points TEXT,
      playbook_snapshot TEXT,
      metrics_snapshot TEXT
    );

    -- Meeting Co-Pilot tables
    CREATE TABLE IF NOT EXISTS transcript_segments (
      id TEXT PRIMARY KEY,
      recording_id INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      channel TEXT NOT NULL CHECK(channel IN ('me', 'them')),
      text TEXT NOT NULL,
      start_time REAL NOT NULL,
      end_time REAL NOT NULL,
      is_final INTEGER NOT NULL DEFAULT 0,
      processed_by_agent INTEGER NOT NULL DEFAULT 0,
      sentiment TEXT CHECK(sentiment IN ('positive', 'neutral', 'negative')),
      triggers TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      id TEXT PRIMARY KEY,
      recording_id INTEGER NOT NULL,
      segment_id TEXT,
      timestamp REAL NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('important', 'follow_up', 'pricing', 'competitor', 'risk', 'decision', 'action_item')),
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cue_cards (
      id TEXT PRIMARY KEY,
      objection_type TEXT NOT NULL CHECK(objection_type IN ('open_question', 'decision_point', 'concern', 'risk', 'commitment', 'follow_up', 'information_request', 'pricing', 'timing', 'competitor', 'authority', 'security', 'integration', 'not_interested', 'send_info')),
      title TEXT NOT NULL,
      talk_tracks TEXT NOT NULL,
      follow_up_questions TEXT NOT NULL,
      proof_points TEXT,
      avoid_saying TEXT,
      source_doc TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cue_card_triggers (
      id TEXT PRIMARY KEY,
      recording_id INTEGER NOT NULL,
      segment_id TEXT,
      cue_card_id TEXT,
      objection_type TEXT NOT NULL,
      trigger_text TEXT NOT NULL,
      confidence REAL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'pinned', 'dismissed')),
      feedback TEXT CHECK(feedback IN ('helpful', 'wrong', 'irrelevant')),
      timestamp REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS playbooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('1on1', 'ProjectReview', 'Retrospective', 'Discovery', 'Interview', 'Brainstorm', 'Custom')),
      description TEXT,
      items TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS playbook_sessions (
      id TEXT PRIMARY KEY,
      recording_id INTEGER NOT NULL,
      playbook_id TEXT NOT NULL,
      items_coverage TEXT NOT NULL,
      completion_snapshot TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS call_metrics_history (
      id TEXT PRIMARY KEY,
      recording_id INTEGER NOT NULL,
      timestamp REAL NOT NULL,
      talk_ratio_me REAL NOT NULL,
      talk_ratio_them REAL NOT NULL,
      pace_wpm REAL,
      questions_asked INTEGER NOT NULL DEFAULT 0,
      monologue_detected INTEGER NOT NULL DEFAULT 0,
      sentiment_trend TEXT CHECK(sentiment_trend IN ('improving', 'stable', 'declining')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS nudges_history (
      id TEXT PRIMARY KEY,
      recording_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('monologue', 'sentiment', 'talk_ratio', 'next_steps', 'pricing', 'playbook', 'questions', 'pace')),
      message TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('low', 'medium', 'high')),
      timestamp REAL NOT NULL,
      dismissed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS copilot_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('prompt', 'config', 'threshold')),
      label TEXT NOT NULL,
      description TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- MCP tables
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      transport TEXT NOT NULL CHECK(transport IN ('stdio', 'http')),
      command TEXT,
      args TEXT,
      env TEXT,
      url TEXT,
      headers TEXT,
      template_id TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      auto_connect INTEGER NOT NULL DEFAULT 0,
      connection_status TEXT NOT NULL DEFAULT 'disconnected' CHECK(connection_status IN ('disconnected', 'connecting', 'connected', 'error')),
      last_error TEXT,
      last_connected_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS mcp_tool_calls (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      recording_id INTEGER,
      tool_name TEXT NOT NULL,
      tool_input TEXT,
      tool_output TEXT,
      status TEXT NOT NULL CHECK(status IN ('pending', 'success', 'error')),
      error_message TEXT,
      duration_ms INTEGER,
      trigger_type TEXT NOT NULL CHECK(trigger_type IN ('intent', 'manual', 'test')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS mcp_oauth_tokens (
      server_id TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      token_type TEXT NOT NULL DEFAULT 'Bearer',
      scope TEXT,
      expires_at TEXT,
      auth_server_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Visual index tables
    CREATE TABLE IF NOT EXISTS visual_index_items (
      id TEXT PRIMARY KEY,
      recording_id INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      text TEXT NOT NULL,
      start_time REAL NOT NULL,
      end_time REAL NOT NULL,
      rtstream_id TEXT,
      rtstream_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_users_access_token ON users(access_token);
    CREATE INDEX IF NOT EXISTS idx_recordings_session_id ON recordings(session_id);
    CREATE INDEX IF NOT EXISTS idx_transcript_segments_session ON transcript_segments(session_id);
    CREATE INDEX IF NOT EXISTS idx_transcript_segments_recording ON transcript_segments(recording_id);
    CREATE INDEX IF NOT EXISTS idx_transcript_segments_channel ON transcript_segments(channel);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_recording ON bookmarks(recording_id);
    CREATE INDEX IF NOT EXISTS idx_cue_cards_objection_type ON cue_cards(objection_type);
    CREATE INDEX IF NOT EXISTS idx_cue_card_triggers_recording ON cue_card_triggers(recording_id);
    CREATE INDEX IF NOT EXISTS idx_playbook_sessions_recording ON playbook_sessions(recording_id);
    CREATE INDEX IF NOT EXISTS idx_call_metrics_history_recording ON call_metrics_history(recording_id);
    CREATE INDEX IF NOT EXISTS idx_nudges_history_recording ON nudges_history(recording_id);
    CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_server ON mcp_tool_calls(server_id);
    CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_recording ON mcp_tool_calls(recording_id);
    CREATE INDEX IF NOT EXISTS idx_visual_index_items_session ON visual_index_items(session_id);
    CREATE INDEX IF NOT EXISTS idx_visual_index_items_recording ON visual_index_items(recording_id);

    -- Calendar preferences table
    CREATE TABLE IF NOT EXISTS calendar_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notify_minutes_before INTEGER NOT NULL DEFAULT 2,
      recording_behavior TEXT NOT NULL DEFAULT 'always_ask' CHECK(recording_behavior IN ('always_ask', 'default_record', 'no_notification')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Workflows table
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      webhook_url TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  ensureRecordingColumns(sqlite);
  ensureNudgesHistorySchema(sqlite);
  ensureMCPServerColumns(sqlite);
  ensureUserColumns(sqlite);

  seedDefaultCueCards(db);
  seedDefaultPlaybooks(db);
  seedDefaultSettings(db);
}

function ensureRecordingColumns(sqlite: Database.Database): void {
  const columns = sqlite
    .prepare("PRAGMA table_info('recordings')")
    .all()
    .map((row: any) => row.name);

  const addColumnIfMissing = (name: string, ddl: string) => {
    if (!columns.includes(name)) {
      sqlite.exec(ddl);
      logger.info({ column: name }, 'Added missing recordings column');
    }
  };

  addColumnIfMissing('short_overview', 'ALTER TABLE recordings ADD COLUMN short_overview TEXT');
  addColumnIfMissing('key_points', 'ALTER TABLE recordings ADD COLUMN key_points TEXT');
  addColumnIfMissing('playbook_snapshot', 'ALTER TABLE recordings ADD COLUMN playbook_snapshot TEXT');
  addColumnIfMissing('metrics_snapshot', 'ALTER TABLE recordings ADD COLUMN metrics_snapshot TEXT');
  addColumnIfMissing('meeting_name', 'ALTER TABLE recordings ADD COLUMN meeting_name TEXT');
  addColumnIfMissing('meeting_description', 'ALTER TABLE recordings ADD COLUMN meeting_description TEXT');
  addColumnIfMissing('game_id', 'ALTER TABLE recordings ADD COLUMN game_id TEXT');
  addColumnIfMissing('probing_questions', 'ALTER TABLE recordings ADD COLUMN probing_questions TEXT');
  addColumnIfMissing('meeting_checklist', 'ALTER TABLE recordings ADD COLUMN meeting_checklist TEXT');
  addColumnIfMissing('collection_id', 'ALTER TABLE recordings ADD COLUMN collection_id TEXT');
  addColumnIfMissing('post_meeting_checklist', 'ALTER TABLE recordings ADD COLUMN post_meeting_checklist TEXT');
  addColumnIfMissing('post_meeting_checklist_completed', 'ALTER TABLE recordings ADD COLUMN post_meeting_checklist_completed TEXT');
  addColumnIfMissing('coaching_tips', 'ALTER TABLE recordings ADD COLUMN coaching_tips TEXT');
  addColumnIfMissing('accuracy_white', 'ALTER TABLE recordings ADD COLUMN accuracy_white REAL');
  addColumnIfMissing('accuracy_black', 'ALTER TABLE recordings ADD COLUMN accuracy_black REAL');
  addColumnIfMissing('result', "ALTER TABLE recordings ADD COLUMN result TEXT CHECK(result IN ('win', 'loss', 'draw'))");
  addColumnIfMissing('move_count', 'ALTER TABLE recordings ADD COLUMN move_count INTEGER');
  addColumnIfMissing('white_opening', 'ALTER TABLE recordings ADD COLUMN white_opening TEXT');
  addColumnIfMissing('black_opening', 'ALTER TABLE recordings ADD COLUMN black_opening TEXT');
}

function ensureNudgesHistorySchema(sqlite: Database.Database): void {
  const row = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='nudges_history'")
    .get() as { sql?: string } | undefined;

  const tableSql = row?.sql || '';
  const hasQuestions = tableSql.includes("'questions'");
  const hasPace = tableSql.includes("'pace'");

  if (hasQuestions && hasPace) {
    return;
  }

  logger.warn(
    { hasQuestions, hasPace },
    'nudges_history table is missing newer enum values; rebuilding table'
  );

  sqlite.exec(`
    ALTER TABLE nudges_history RENAME TO nudges_history_old;

    CREATE TABLE nudges_history (
      id TEXT PRIMARY KEY,
      recording_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('monologue', 'sentiment', 'talk_ratio', 'next_steps', 'pricing', 'playbook', 'questions', 'pace')),
      message TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('low', 'medium', 'high')),
      timestamp REAL NOT NULL,
      dismissed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO nudges_history (id, recording_id, type, message, severity, timestamp, dismissed, created_at)
    SELECT id, recording_id, type, message, severity, timestamp, dismissed, created_at
    FROM nudges_history_old;

    DROP TABLE nudges_history_old;
  `);

  logger.info('nudges_history table rebuilt with updated enum values');
}

function ensureMCPServerColumns(sqlite: Database.Database): void {
  const columns = sqlite
    .prepare('PRAGMA table_info(mcp_servers)')
    .all() as { name: string }[];

  const columnNames = columns.map((c) => c.name);

  if (!columnNames.includes('description')) {
    sqlite.exec('ALTER TABLE mcp_servers ADD COLUMN description TEXT');
    logger.info('Added description column to mcp_servers table');
  }
}

function ensureUserColumns(sqlite: Database.Database): void {
  const columns = sqlite
    .prepare('PRAGMA table_info(users)')
    .all() as { name: string }[];

  const columnNames = columns.map((c) => c.name);

  if (!columnNames.includes('collection_id')) {
    sqlite.exec('ALTER TABLE users ADD COLUMN collection_id TEXT');
    logger.info('Added collection_id column to users table');
  }

  if (!columnNames.includes('litellm_key')) {
    sqlite.exec('ALTER TABLE users ADD COLUMN litellm_key TEXT');
    logger.info('Added litellm_key column to users table');
  }
}
