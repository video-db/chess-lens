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
    return `You are a ${gameName} post-game coach delivering a thorough post-game analysis. Write a rich, specific overview of how this game unfolded based on the coaching tips and engine suggestions recorded during play.

Rules:
- Write 4-6 sentences that tell the story of the game: how the opening was handled, where the critical turning points occurred, and how the position evolved into the endgame or decisive moment.
- Name specific moves, pieces, or squares when the coaching data supports it (e.g. "the knight on f5 created persistent pressure", "the early queenside pawn break defined the middlegame").
- Identify at least one strength and one weakness from the session — be direct and honest.
- Reference concrete chess concepts: piece activity, pawn structure, king safety, tactical threats, positional advantages, initiative, development, endgame technique.
- Do NOT mention FEN strings, board coordinates, XML tags, or raw notation unless it forms part of a natural chess sentence (e.g. "played ...Nc6").
- Do not mention meetings, discussions, colleagues, or agenda items.
- Use past tense. Write as an authoritative coach, not as a neutral summariser.

Return only the summary paragraph.`;
  }

  if (section === 'keyPoints') {
    return `You are a ${gameName} post-game coach delivering a detailed breakdown of the key moments and patterns from this game. Analyse the coaching tips and engine suggestions and return 3-5 high-value takeaways grouped by chess theme as JSON.

Rules:
- Always return at least 3 topics. If the game was short, dig deeper into the engine evaluations and infer patterns from the moves and positions mentioned.
- Each topic must contain 2-3 specific, concrete points — not generic advice. Bad: "Improve piece activity." Good: "The bishop remained passive on c8 for most of the middlegame while the opponent's knights dominated the centre."
- Every point should be directly traceable to something that actually happened in this game — a specific move, tactical idea, structural decision, or turning point.
- Group by chess themes such as: Opening Choices, Tactical Opportunities, Piece Activity, Pawn Structure, King Safety, Critical Moments, Endgame Technique, Decision-Making Under Pressure.
- Do NOT return an empty array. Always produce at least 3 topics.
- Do NOT echo FEN strings, board mappings, XML, or raw coordinates.
- Do not mention meetings, attendees, or agenda items.

IMPORTANT: Always return valid JSON matching EXACTLY this format with snake_case key "key_points":
{
  "key_points": [
    {
      "topic": "Topic Name",
      "points": ["Specific chess observation directly from this game.", "A second concrete point about this theme."]
    }
  ]
}`;
  }

  return `You are a ${gameName} post-game coach building a targeted training plan based on what you observed in this game. Use the coaching tips and engine suggestions to identify the most important things to work on before the next game.

Rules:
- Return 4-8 items. Every item must be directly motivated by a specific pattern, mistake, or missed opportunity from this game — do not pad with generic advice.
- Each item must be a concrete, actionable training goal. Bad: "Improve your opening." Good: "Study the Bc4 attacking ideas against the Sicilian Dragon — twice you missed the Ng5 thrust that the engine recommended."
- Mix correction-focused items (fixing what went wrong) with reinforcement items (drilling what worked well).
- Prefer specific drills, study topics, or positions to revisit: openings to prepare, tactical patterns to practise, endgame techniques to study.
- Do NOT include FEN strings, board mappings, or XML fragments.
- Do not mention meetings, discussions, or follow-up calls.
- Order items by priority — the most critical training gap first.

Output format:
{
  "checklist": [
    "Actionable chess training goal tied to this game"
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

    log.info({ recordingId, savedTipCount: savedTips.length }, 'Coaching tips loaded from DB for summary generation');

    if (savedTips.length === 0) {
      log.warn({ recordingId }, 'No coaching tips found in DB — returning generic fallback');
      return this.emptyChessFallback(gameName);
    }

    log.info({ recordingId, tipCount: savedTips.length }, 'Generating summary from saved coaching tips');

    // Format as a readable game log for the LLM.
    // Only include tips that have actual coaching text (stage-2 LLM tips).
    // Stage-1 engine-only tips (empty sayThis/askThis) are stored for accuracy tracking only.
    const tipsWithText = savedTips.filter((tip) => tip.sayThis && tip.askThis);

    log.info({ recordingId, totalTips: savedTips.length, tipsWithText: tipsWithText.length }, 'Tips with LLM text filtered');

    if (tipsWithText.length === 0) {
      log.warn({ recordingId, totalTips: savedTips.length }, 'No LLM coaching tips found — returning generic fallback');
      return this.emptyChessFallback(gameName);
    }

    const gameLog = tipsWithText
      .map((tip, i) => `[Move ${i + 1}] Coach: ${tip.sayThis}\n  Drill: ${tip.askThis}`)
      .join('\n\n');

    const userPrompt = this.buildChessUserPrompt(gameLog, context, gameName);

    const [shortOverview, keyPoints, postMeetingChecklist] = await Promise.all([
      this.generateGameOverview(userPrompt, gameId),
      this.generateGameKeyPoints(userPrompt, gameId),
      this.generateGameChecklist(userPrompt, gameId),
    ]);

    // If keyPoints came back empty, do a targeted retry with emphasis on producing output
    let finalKeyPoints = keyPoints;
    if (finalKeyPoints.length === 0) {
      log.warn({ recordingId }, 'keyPoints empty after first attempt — retrying with overview context');
      finalKeyPoints = await this.generateGameKeyPoints(
        `${userPrompt}\n\nNote: The overview of this game is: ${shortOverview}\nYou MUST return at least 2 key_points topics based on this overview.`,
        gameId
      );
    }

    return { shortOverview, keyPoints: finalKeyPoints, postMeetingChecklist, generatedAt: Date.now() };
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
    log.info({ label, promptLength: fullPrompt.length, responseType }, 'Calling VideoDB generateCoachingText');
    const result = await videodb.generateCoachingText(fullPrompt, 'pro', responseType, 90000);
    if (!result) {
      log.warn({ label }, 'VideoDB generateText returned empty result');
      return null;
    }
    log.info({ label, resultLength: result.length }, 'VideoDB generateCoachingText succeeded');
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
      log.info({ rawContent: cleaned.slice(0, 500) }, 'parseKeyPointsResponse raw content');

      // Strip any markdown code fences (```json ... ``` or ``` ... ```)
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

      // Extract the first JSON object/array from the string in case there's surrounding text
      const jsonMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (jsonMatch) cleaned = jsonMatch[1];

      const parsed = JSON.parse(cleaned);
      log.info({ parsedType: typeof parsed, isArray: Array.isArray(parsed), keys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : [] }, 'parseKeyPointsResponse parsed structure');

      // Support multiple possible keys the LLM might use
      const keyPoints =
        parsed.key_points ||
        parsed.keyPoints ||
        parsed.insights ||
        parsed.patterns ||
        parsed.takeaways ||
        (Array.isArray(parsed) ? parsed : null);

      if (Array.isArray(keyPoints)) {
        log.info({ keyPointCount: keyPoints.length }, 'parseKeyPointsResponse extracted key points');
        return keyPoints.map((kp: { topic: string; points: string[] }) => ({
          topic: kp.topic || 'Chess Analysis',
          points: Array.isArray(kp.points) ? kp.points : [],
        }));
      }
      log.warn({ parsedKeys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : [] }, 'parseKeyPointsResponse: no recognizable key points array');
    } catch (error) {
      log.warn({ error, content: content.slice(0, 300) }, 'Failed to parse key points JSON');
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
