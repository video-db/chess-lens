/**
 * Summary Generator Service
 *
 * Generates post-game summaries using three specialized prompts:
 * 1. Short Overview - A narrative paragraph summary (3-5 sentences)
 * 2. Key Points - Structured JSON with topics and attributed points
 * 3. Post-Game Checklist - Training goals and corrections from the session
 *
 * For chess sessions (which have no mic transcript), the summary is generated
 * from the live coaching tips captured during the game. Raw FEN strings and
 * board-mapping XML are stripped before the data reaches the LLM.
 */

import { logger } from '../../lib/logger';
import { getVideoDBServiceFromConfig } from '../videodb.service';
import { getTranscriptSegmentsByRecording, getCoachingTipsByRecording } from '../../db';
import { getGameCoachingProfile, type SupportedGameId } from '../../../shared/config/game-coaching';

const log = logger.child({ module: 'summary-generator' });

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface KeyPoint {
  topic: string;
  points: string[];
}

export interface PostMeetingSummary {
  shortOverview: string;
  keyPoints: KeyPoint[];
  postMeetingChecklist: string[];
  generatedAt: number;
}

export interface ProbingQA {
  question: string;
  answer: string;
  customAnswer?: string;
}

export interface MeetingContext {
  meetingName?: string;
  meetingDescription?: string;
  gameId?: SupportedGameId;
  probingQuestions?: ProbingQA[];
  checklist?: string[];
}

// ─── System Prompts ─────────────────────────────────────────────────────────────

function buildGameSummarySystemPrompt(gameId: SupportedGameId, section: 'overview' | 'keyPoints' | 'checklist'): string {
  const profile = getGameCoachingProfile(gameId);
  const gameName = profile.name;

  if (section === 'overview') {
    return `You are a ${gameName} post-game coach. The data below is a log of coaching tips and engine suggestions captured during a live chess game.
Summarize what happened in the session using chess language only.

Rules:
- Write 3-5 short sentences.
- Reference specific chess concepts: piece activity, pawn structure, king safety, tactical threats, positional advantages, opening choices, endgame technique.
- Do NOT mention FEN strings, board coordinates, XML tags, or raw notation unless it forms part of a natural chess sentence (e.g. "played ...Nc6").
- Do not mention meetings, discussions, colleagues, or agenda items.
- Use past tense.

Return only the summary paragraph.`;
  }

  if (section === 'keyPoints') {
    return `You are a ${gameName} post-game coach. The data below is a log of coaching tips and engine suggestions from a live chess game.
Return the key chess takeaways as JSON.

Rules:
- Group by chess themes: Tactics, Piece Activity, Pawn Structure, King Safety, Opening/Middlegame, Endgame, Decision-Making.
- Each point should describe a concrete chess idea, mistake, or pattern observed during the game.
- Do NOT echo FEN strings, board mappings, XML, or coordinate dumps — only human-readable chess analysis.
- Do not mention meetings, attendees, or agenda items.

Output format:
{
  "key_points": [
    {
      "topic": "Topic Name",
      "points": ["Concrete chess observation."]
    }
  ]
}`;
  }

  return `You are a ${gameName} post-game coach. The data below is a log of coaching tips and engine suggestions from a live chess game.
Extract training goals and corrections for the next game.

Rules:
- Return 3-8 concise items.
- Each item should be a specific chess training goal, pattern to study, or mistake to avoid.
- Do NOT include FEN strings, board mappings, or XML fragments.
- Do not mention meetings, discussions, or follow-up calls.
- Prefer concrete drills: "Study the Bc4 attacking ideas against the Sicilian Dragon" is better than "improve your opening".

Output format:
{
  "checklist": [
    "Actionable chess training goal"
  ]
}`;
}

// ─── Summary Generator Service ─────────────────────────────────────────────────

export class SummaryGeneratorService {
  constructor() {}

  /**
   * Generate short overview, key points, and post-game checklist.
   *
   * For chess sessions with no mic transcript, uses the visual index items
   * (live coaching tips + engine suggestions) as the data source after
   * stripping all FEN/XML noise.
   */
  async generate(
    recordingId: number,
    context: MeetingContext
  ): Promise<PostMeetingSummary> {
    const dbSegments = getTranscriptSegmentsByRecording(recordingId);
    const gameId: SupportedGameId = context.gameId || 'chess';

    // If there's a real spoken transcript, use it (non-chess sessions).
    if (dbSegments && dbSegments.length > 0) {
      log.info({ recordingId, segmentCount: dbSegments.length }, 'Generating summary from transcript');
      const transcript = this.formatTranscript(dbSegments);
      const userPrompt = this.buildUserPrompt(transcript, context);
      const [shortOverview, keyPoints, postMeetingChecklist] = await Promise.all([
        this.generateGameOverview(userPrompt, gameId),
        this.generateGameKeyPoints(userPrompt, gameId),
        this.generateGameChecklist(userPrompt, gameId),
      ]);
      return { shortOverview, keyPoints, postMeetingChecklist, generatedAt: Date.now() };
    }

    // Chess path: build the session log from visual index items (coaching tips).
    log.warn({ recordingId }, 'No transcript segments found for recording');
    return this.generateFromVisualData(recordingId, context, gameId);
  }

  /**
   * Generate summary from coaching tips saved during the session.
   * Falls back to a helpful empty-state message if no tips were captured.
   */
  private async generateFromVisualData(
    recordingId: number,
    context: MeetingContext,
    gameId: SupportedGameId
  ): Promise<PostMeetingSummary> {
    const gameName = getGameCoachingProfile(gameId).name;

    // Primary source: coaching tips persisted by the live assist pipeline.
    const savedTips = getCoachingTipsByRecording(recordingId);

    if (savedTips.length === 0) {
      log.warn({ recordingId }, 'No coaching tips found in DB — returning generic fallback');
      return this.emptyChessFallback(gameName);
    }

    log.info({ recordingId, tipCount: savedTips.length }, 'Generating summary from saved coaching tips');

    // Format as a readable game log for the LLM.
    // Each tip has a sayThis (coaching paragraph) and an askThis (drill).
    const gameLog = savedTips
      .map((tip, i) => `[Move ${i + 1}] Coach: ${tip.sayThis}\n  Drill: ${tip.askThis}`)
      .join('\n\n');

    const userPrompt = this.buildChessUserPrompt(gameLog, context, gameName);

    const [shortOverview, keyPoints, postMeetingChecklist] = await Promise.all([
      this.generateGameOverview(userPrompt, gameId),
      this.generateGameKeyPoints(userPrompt, gameId),
      this.generateGameChecklist(userPrompt, gameId),
    ]);

    return { shortOverview, keyPoints, postMeetingChecklist, generatedAt: Date.now() };
  }

  /**
   * Build the user prompt for the LLM using a log of chess coaching tips.
   */
  private buildChessUserPrompt(gameLog: string, context: MeetingContext, gameName: string): string {
    const title = context.meetingName || `${gameName} Session`;
    const description = context.meetingDescription?.trim();

    const probingQA = context.probingQuestions?.length
      ? context.probingQuestions.map((q, i) => {
          const answer = q.customAnswer ? `${q.answer} (${q.customAnswer})` : q.answer;
          return `Q${i + 1}: ${q.question}\nA${i + 1}: ${answer}`;
        }).join('\n\n')
      : '';

    const descriptionBlock = description ? `Game Description: ${description}\n\n` : '';
    const preContext = probingQA ? `Pre-Session Goals:\n${probingQA}\n\n` : '';

    return `${gameName} Session: ${title}
${descriptionBlock}${preContext}Live Coaching Tips (captured during the game):
${gameLog}`;
  }

  /**
   * Call VideoDB's generateText API with the 'pro' model.
   * Raises on failure so callers can log the error and return a safe default.
   */
  private async callVideoDB(
    fullPrompt: string,
    responseType: 'text' | 'json',
    label: string
  ): Promise<string | null> {
    const videodb = getVideoDBServiceFromConfig();
    if (!videodb) {
      log.warn({ label }, 'VideoDB service not available — skipping generateText call');
      return null;
    }
    const result = await videodb.generateCoachingText(fullPrompt, 'pro', responseType, 90000);
    if (!result) {
      log.warn({ label }, 'VideoDB generateText returned empty result');
      return null;
    }
    return result;
  }

  private async generateGameOverview(userPrompt: string, gameId: SupportedGameId): Promise<string> {
    const systemPrompt = buildGameSummarySystemPrompt(gameId, 'overview');
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
    try {
      const result = await this.callVideoDB(fullPrompt, 'text', 'overview');
      if (result) return result.trim();
    } catch (error) {
      log.error({ error, gameId }, 'Game overview generation failed');
    }
    return 'Unable to generate gameplay summary.';
  }

  private async generateGameKeyPoints(userPrompt: string, gameId: SupportedGameId): Promise<KeyPoint[]> {
    const systemPrompt = buildGameSummarySystemPrompt(gameId, 'keyPoints');
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
    try {
      const result = await this.callVideoDB(fullPrompt, 'json', 'keyPoints');
      if (result) {
        const parsed = this.parseKeyPointsResponse(result);
        if (parsed) return parsed;
      }
    } catch (error) {
      log.error({ error, gameId }, 'Game key points generation failed');
    }
    return [];
  }

  private async generateGameChecklist(userPrompt: string, gameId: SupportedGameId): Promise<string[]> {
    const systemPrompt = buildGameSummarySystemPrompt(gameId, 'checklist');
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
    try {
      const result = await this.callVideoDB(fullPrompt, 'json', 'checklist');
      if (result) {
        const parsed = this.parseChecklistResponse(result);
        if (parsed) return parsed;
      }
    } catch (error) {
      log.error({ error, gameId }, 'Game checklist generation failed');
    }
    return [];
  }

  private parseKeyPointsResponse(content: string): KeyPoint[] | null {
    try {
      let cleaned = content.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
      const parsed = JSON.parse(cleaned);
      const keyPoints = parsed.key_points || parsed;
      if (Array.isArray(keyPoints)) {
        return keyPoints.map((kp: { topic: string; points: string[] }) => ({
          topic: kp.topic || 'Chess Analysis',
          points: Array.isArray(kp.points) ? kp.points : [],
        }));
      }
    } catch (error) {
      log.warn({ error, content: content.slice(0, 200) }, 'Failed to parse key points JSON');
    }
    return null;
  }

  private parseChecklistResponse(content: string): string[] | null {
    try {
      let cleaned = content.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
      const parsed = JSON.parse(cleaned);
      const checklist = parsed.checklist || parsed;
      if (Array.isArray(checklist)) {
        return checklist.filter((item: unknown) => typeof item === 'string' && item.trim().length > 0);
      }
    } catch (error) {
      log.warn({ error, content: content.slice(0, 200) }, 'Failed to parse checklist JSON');
    }
    return null;
  }

  private buildUserPrompt(transcript: string, context: MeetingContext): string {
    const title = context.meetingName || (context.gameId ? `${getGameCoachingProfile(context.gameId).name} Session` : 'Chess Session');
    const description = context.meetingDescription || 'Gameplay session';

    const probingQA = context.probingQuestions?.length
      ? context.probingQuestions.map((q, i) => {
          const answer = q.customAnswer ? `${q.answer} (${q.customAnswer})` : q.answer;
          return `Q${i + 1}: ${q.question}\nA${i + 1}: ${answer}`;
        }).join('\n\n')
      : 'No pre-session context provided';

    const checklist = context.checklist?.length
      ? context.checklist.map((item, i) => `${i + 1}. ${item}`).join('\n')
      : 'No checklist';

    return `Game Session Title: ${title}
Session Context: ${description}

Pre-Session Context (Q&A):
${probingQA}

Checklist:
${checklist}

Transcript:
${transcript}`;
  }

  private formatTranscript(segments: { channel: string; text: string; startTime: number }[]): string {
    return segments
      .map(s => {
        const speaker = s.channel === 'me' ? 'You' : 'Them';
        const time = this.formatTime(s.startTime);
        return `[${time}] ${speaker}: ${s.text}`;
      })
      .join('\n');
  }

  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Generic chess fallback when no coaching tips were captured at all.
   */
  private emptyChessFallback(gameName: string): PostMeetingSummary {
    return {
      shortOverview: `No coaching tips were captured during this ${gameName} session. For richer post-game analysis, ensure the overlay is active and visible during gameplay so the live coach can record position-specific suggestions.`,
      keyPoints: [
        {
          topic: 'Getting Started',
          points: [
            'Start a recording with the overlay visible on screen while playing.',
            'The coach captures engine suggestions and position analysis in real time.',
            'After the session, tips are automatically organised into key themes here.',
          ],
        },
      ],
      postMeetingChecklist: [
        'Start a new session with the overlay active to capture live coaching tips.',
        'Play at least 10–15 moves so the engine has time to analyse meaningful positions.',
      ],
      generatedAt: Date.now(),
    };
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let instance: SummaryGeneratorService | null = null;

export function getSummaryGenerator(): SummaryGeneratorService {
  if (!instance) {
    instance = new SummaryGeneratorService();
  }
  return instance!;
}

export function resetSummaryGenerator(): void {
  instance = null;
}

export default SummaryGeneratorService;
