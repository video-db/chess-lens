import { eq, desc, and } from 'drizzle-orm';
import * as schema from './schema';
import { getDatabase, getSqliteDatabase } from './connection';

export * from './connection';
export * from './mcp';

export function getUserByAccessToken(accessToken: string) {
  const database = getDatabase();
  return database
    .select()
    .from(schema.users)
    .where(eq(schema.users.accessToken, accessToken))
    .get();
}

export function createUser(data: schema.NewUser) {
  const database = getDatabase();
  return database.insert(schema.users).values(data).returning().get();
}

export function updateUser(id: number, data: Partial<schema.User>) {
  const database = getDatabase();
  return database
    .update(schema.users)
    .set(data)
    .where(eq(schema.users.id, id))
    .returning()
    .get();
}

export function getRecordingById(id: number) {
  const database = getDatabase();
  return database
    .select()
    .from(schema.recordings)
    .where(eq(schema.recordings.id, id))
    .get();
}

export function getRecordingBySessionId(sessionId: string) {
  const database = getDatabase();
  return database
    .select()
    .from(schema.recordings)
    .where(eq(schema.recordings.sessionId, sessionId))
    .get();
}

export function getAllRecordings() {
  const database = getDatabase();
  return database
    .select()
    .from(schema.recordings)
    .orderBy(schema.recordings.createdAt)
    .all();
}

export function createRecording(data: schema.NewRecording) {
  const database = getDatabase();
  return database.insert(schema.recordings).values(data).returning().get();
}

export function updateRecording(id: number, data: Partial<schema.Recording>) {
  const database = getDatabase();
  return database
    .update(schema.recordings)
    .set(data)
    .where(eq(schema.recordings.id, id))
    .returning()
    .get();
}

export function updateRecordingBySessionId(
  sessionId: string,
  data: Partial<schema.Recording>
) {
  const database = getDatabase();
  return database
    .update(schema.recordings)
    .set(data)
    .where(eq(schema.recordings.sessionId, sessionId))
    .returning()
    .get();
}

// â”€â”€â”€ Coaching Tips â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface CoachingTip {
  sayThis: string;
  askThis: string;
  timestamp: number;
  /** Win chance for White (0â€“100) from chess-api.com AFTER this move was played. */
  winChance?: number;
  /** Win chance for White (0â€“100) from chess-api.com BEFORE this move was played. */
  winChanceBefore?: number;
  /** Engine eval (in pawns) of the current position â€” used for winning-buffer suppression. */
  engineEval?: number;
  /** Centipawn loss for the move that triggered this tip (always â‰¥ 0). */
  centipawnLoss?: number;
  /** Which side made the move that triggered this tip ('w' = White, 'b' = Black). */
  turn?: 'w' | 'b';
}

/**
 * Persist the current list of coaching tips for a recording.
 * Overwrites any previously saved tips (called once at session end).
 */
export function saveCoachingTips(recordingId: number, tips: CoachingTip[]): void {
  const sqlite = getSqliteDatabase();
  if (!sqlite) return;
  sqlite
    .prepare('UPDATE recordings SET coaching_tips = ? WHERE id = ?')
    .run(JSON.stringify(tips), recordingId);
}

/**
 * Retrieve all coaching tips saved for a recording.
 * Returns an empty array if none were saved.
 */
export function getCoachingTipsByRecording(recordingId: number): CoachingTip[] {
  const sqlite = getSqliteDatabase();
  if (!sqlite) return [];
  const row = sqlite
    .prepare('SELECT coaching_tips FROM recordings WHERE id = ?')
    .get(recordingId) as { coaching_tips: string | null } | undefined;
  if (!row?.coaching_tips) return [];
  try {
    return JSON.parse(row.coaching_tips) as CoachingTip[];
  } catch {
    return [];
  }
}


export function createTranscriptSegment(data: schema.NewTranscriptSegment) {
  const database = getDatabase();
  return database.insert(schema.transcriptSegments).values(data).returning().get();
}

export function getTranscriptSegmentsByRecording(recordingId: number) {
  const database = getDatabase();
  return database
    .select()
    .from(schema.transcriptSegments)
    .where(eq(schema.transcriptSegments.recordingId, recordingId))
    .orderBy(schema.transcriptSegments.startTime)
    .all();
}

export function getTranscriptSegmentsBySession(sessionId: string) {
  const database = getDatabase();
  return database
    .select()
    .from(schema.transcriptSegments)
    .where(eq(schema.transcriptSegments.sessionId, sessionId))
    .orderBy(schema.transcriptSegments.startTime)
    .all();
}

export function getRecentTranscriptSegments(sessionId: string, limit: number = 50) {
  const database = getDatabase();
  return database
    .select()
    .from(schema.transcriptSegments)
    .where(and(
      eq(schema.transcriptSegments.sessionId, sessionId),
      eq(schema.transcriptSegments.isFinal, true)
    ))
    .orderBy(desc(schema.transcriptSegments.startTime))
    .limit(limit)
    .all()
    .reverse();
}

export function updateTranscriptSegment(id: string, data: Partial<schema.TranscriptSegment>) {
  const database = getDatabase();
  return database
    .update(schema.transcriptSegments)
    .set(data)
    .where(eq(schema.transcriptSegments.id, id))
    .returning()
    .get();
}

export function deleteTranscriptSegmentsBySession(sessionId: string) {
  const database = getDatabase();
  return database
    .delete(schema.transcriptSegments)
    .where(eq(schema.transcriptSegments.sessionId, sessionId))
    .run();
}

// Visual Index Items

export function createVisualIndexItem(data: schema.NewVisualIndexItem) {
  const database = getDatabase();
  return database.insert(schema.visualIndexItems).values(data).returning().get();
}

export function getVisualIndexItemsByRecording(recordingId: number) {
  const database = getDatabase();
  return database
    .select()
    .from(schema.visualIndexItems)
    .where(eq(schema.visualIndexItems.recordingId, recordingId))
    .orderBy(schema.visualIndexItems.startTime)
    .all();
}

export function getVisualIndexItemsBySession(sessionId: string) {
  const database = getDatabase();
  return database
    .select()
    .from(schema.visualIndexItems)
    .where(eq(schema.visualIndexItems.sessionId, sessionId))
    .orderBy(schema.visualIndexItems.startTime)
    .all();
}

export function deleteVisualIndexItemsBySession(sessionId: string) {
  const database = getDatabase();
  return database
    .delete(schema.visualIndexItems)
    .where(eq(schema.visualIndexItems.sessionId, sessionId))
    .run();
}

export function createBookmark(data: schema.NewBookmark) {
  const database = getDatabase();
  return database.insert(schema.bookmarks).values(data).returning().get();
}

export function getBookmarksByRecording(recordingId: number) {
  const database = getDatabase();
  return database
    .select()
    .from(schema.bookmarks)
    .where(eq(schema.bookmarks.recordingId, recordingId))
    .orderBy(schema.bookmarks.timestamp)
    .all();
}

export function deleteBookmark(id: string) {
  const database = getDatabase();
  return database.delete(schema.bookmarks).where(eq(schema.bookmarks.id, id)).run();
}


export function getCueCardsByType(objectionType: string) {
  const database = getDatabase();
  return database
    .select()
    .from(schema.cueCards)
    .where(eq(schema.cueCards.objectionType, objectionType as any))
    .all();
}

export function getAllCueCards() {
  const database = getDatabase();
  return database.select().from(schema.cueCards).all();
}

export function createCueCard(data: schema.NewCueCard) {
  const database = getDatabase();
  return database.insert(schema.cueCards).values(data).returning().get();
}

export function updateCueCard(id: string, data: Partial<schema.CueCard>) {
  const database = getDatabase();
  return database
    .update(schema.cueCards)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(eq(schema.cueCards.id, id))
    .returning()
    .get();
}


export function createCueCardTrigger(data: schema.NewCueCardTrigger) {
  const database = getDatabase();
  return database.insert(schema.cueCardTriggers).values(data).returning().get();
}

export function getCueCardTriggersByRecording(recordingId: number) {
  const database = getDatabase();
  return database
    .select()
    .from(schema.cueCardTriggers)
    .where(eq(schema.cueCardTriggers.recordingId, recordingId))
    .orderBy(schema.cueCardTriggers.timestamp)
    .all();
}

export function updateCueCardTrigger(id: string, data: Partial<schema.CueCardTrigger>) {
  const database = getDatabase();
  return database
    .update(schema.cueCardTriggers)
    .set(data)
    .where(eq(schema.cueCardTriggers.id, id))
    .returning()
    .get();
}

// Smart Card aliases (new naming convention)
export const getSmartCardsByType = getCueCardsByType;
export const getAllSmartCards = getAllCueCards;
export const createSmartCard = createCueCard;
export const updateSmartCard = updateCueCard;
export const createSmartCardTrigger = createCueCardTrigger;
export const getSmartCardTriggersByRecording = getCueCardTriggersByRecording;
export const updateSmartCardTrigger = updateCueCardTrigger;


export function getPlaybookById(id: string) {
  const database = getDatabase();
  return database
    .select()
    .from(schema.playbooks)
    .where(eq(schema.playbooks.id, id))
    .get();
}

export function getAllPlaybooks() {
  const database = getDatabase();
  return database.select().from(schema.playbooks).all();
}

export function getDefaultPlaybook() {
  const database = getDatabase();
  return database
    .select()
    .from(schema.playbooks)
    .where(eq(schema.playbooks.isDefault, true))
    .get();
}

export function createPlaybook(data: schema.NewPlaybook) {
  const database = getDatabase();
  return database.insert(schema.playbooks).values(data).returning().get();
}


export function createPlaybookSession(data: schema.NewPlaybookSession) {
  const database = getDatabase();
  return database.insert(schema.playbookSessions).values(data).returning().get();
}

export function getPlaybookSessionByRecording(recordingId: number) {
  const database = getDatabase();
  return database
    .select()
    .from(schema.playbookSessions)
    .where(eq(schema.playbookSessions.recordingId, recordingId))
    .get();
}

export function updatePlaybookSession(id: string, data: Partial<schema.PlaybookSession>) {
  const database = getDatabase();
  return database
    .update(schema.playbookSessions)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(eq(schema.playbookSessions.id, id))
    .returning()
    .get();
}


export function createCallMetricsSnapshot(data: schema.NewCallMetricsHistory) {
  const database = getDatabase();
  return database.insert(schema.callMetricsHistory).values(data).returning().get();
}

export function getCallMetricsHistory(recordingId: number) {
  const database = getDatabase();
  return database
    .select()
    .from(schema.callMetricsHistory)
    .where(eq(schema.callMetricsHistory.recordingId, recordingId))
    .orderBy(schema.callMetricsHistory.timestamp)
    .all();
}


export function createNudge(data: schema.NewNudgeHistory) {
  const database = getDatabase();
  return database.insert(schema.nudgesHistory).values(data).returning().get();
}

export function getNudgesByRecording(recordingId: number) {
  const database = getDatabase();
  return database
    .select()
    .from(schema.nudgesHistory)
    .where(eq(schema.nudgesHistory.recordingId, recordingId))
    .orderBy(schema.nudgesHistory.timestamp)
    .all();
}

export function dismissNudge(id: string) {
  const database = getDatabase();
  return database
    .update(schema.nudgesHistory)
    .set({ dismissed: true })
    .where(eq(schema.nudgesHistory.id, id))
    .returning()
    .get();
}


export function getSetting(key: string) {
  const database = getDatabase();
  return database
    .select()
    .from(schema.copilotSettings)
    .where(eq(schema.copilotSettings.key, key))
    .get();
}

export function getSettingsByCategory(category: 'prompt' | 'config' | 'threshold') {
  const database = getDatabase();
  return database
    .select()
    .from(schema.copilotSettings)
    .where(eq(schema.copilotSettings.category, category))
    .all();
}

export function getAllSettings() {
  const database = getDatabase();
  return database.select().from(schema.copilotSettings).all();
}

export function upsertSetting(data: schema.NewCopilotSetting) {
  const database = getDatabase();
  const existing = database
    .select()
    .from(schema.copilotSettings)
    .where(eq(schema.copilotSettings.key, data.key))
    .get();

  if (existing) {
    return database
      .update(schema.copilotSettings)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(schema.copilotSettings.key, data.key))
      .returning()
      .get();
  }
  return database.insert(schema.copilotSettings).values(data).returning().get();
}

export function deleteSetting(key: string) {
  const database = getDatabase();
  return database.delete(schema.copilotSettings).where(eq(schema.copilotSettings.key, key)).run();
}


export function deleteCueCard(id: string) {
  const database = getDatabase();
  return database.delete(schema.cueCards).where(eq(schema.cueCards.id, id)).run();
}

export function updatePlaybook(id: string, data: Partial<schema.Playbook>) {
  const database = getDatabase();
  return database
    .update(schema.playbooks)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(eq(schema.playbooks.id, id))
    .returning()
    .get();
}

export function deletePlaybook(id: string) {
  const database = getDatabase();
  return database.delete(schema.playbooks).where(eq(schema.playbooks.id, id)).run();
}

export function setDefaultPlaybook(id: string) {
  const database = getDatabase();
  database.update(schema.playbooks).set({ isDefault: false }).run();
  return database
    .update(schema.playbooks)
    .set({ isDefault: true })
    .where(eq(schema.playbooks.id, id))
    .returning()
    .get();
}


// Calendar Preferences CRUD Operations

export function getCalendarPreferences() {
  const database = getDatabase();
  // Get the first (and only) preferences row, or return defaults
  const prefs = database
    .select()
    .from(schema.calendarPreferences)
    .get();

  if (!prefs) {
    return {
      id: 0,
      notifyMinutesBefore: 2,
      recordingBehavior: 'always_ask' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  return prefs;
}

export function upsertCalendarPreferences(data: {
  notifyMinutesBefore?: number;
  recordingBehavior?: 'always_ask' | 'default_record' | 'no_notification';
}) {
  const database = getDatabase();
  const existing = database
    .select()
    .from(schema.calendarPreferences)
    .get();

  if (existing) {
    return database
      .update(schema.calendarPreferences)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(schema.calendarPreferences.id, existing.id))
      .returning()
      .get();
  }

  return database
    .insert(schema.calendarPreferences)
    .values({
      notifyMinutesBefore: data.notifyMinutesBefore ?? 2,
      recordingBehavior: data.recordingBehavior ?? 'always_ask',
    })
    .returning()
    .get();
}

// Workflow CRUD Operations

export function getAllWorkflows() {
  const database = getDatabase();
  return database
    .select()
    .from(schema.workflows)
    .orderBy(desc(schema.workflows.createdAt))
    .all();
}

export function getWorkflowById(id: string) {
  const database = getDatabase();
  return database
    .select()
    .from(schema.workflows)
    .where(eq(schema.workflows.id, id))
    .get();
}

export function getEnabledWorkflows() {
  const database = getDatabase();
  return database
    .select()
    .from(schema.workflows)
    .where(eq(schema.workflows.enabled, true))
    .all();
}

export function createWorkflow(data: schema.NewWorkflow) {
  const database = getDatabase();
  return database.insert(schema.workflows).values(data).returning().get();
}

export function updateWorkflow(id: string, data: Partial<schema.Workflow>) {
  const database = getDatabase();
  return database
    .update(schema.workflows)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(eq(schema.workflows.id, id))
    .returning()
    .get();
}

export function deleteWorkflow(id: string) {
  const database = getDatabase();
  return database.delete(schema.workflows).where(eq(schema.workflows.id, id)).run();
}

export { schema };
