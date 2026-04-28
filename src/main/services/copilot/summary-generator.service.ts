/**
 * Summary Generator Service
 *
 * Generates post-meeting summaries using three specialized prompts:
 * 1. Short Overview - A narrative paragraph summary (3-5 sentences)
 * 2. Key Points - Structured JSON with topics and attributed points
 * 3. Post-Meeting Checklist - Action items and follow-ups from the conversation
 */

import { logger } from '../../lib/logger';
import { getLLMService } from '../llm.service';
import { getTranscriptSegmentsByRecording, getVisualIndexItemsByRecording } from '../../db';
import { getGameCoachingProfile, getGameIndexingPrompt, type SupportedGameId } from '../../../shared/config/game-coaching';

const log = logger.child({ module: 'summary-generator' });

// Types

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

// System Prompts

function buildGameSummarySystemPrompt(gameId: SupportedGameId, section: 'overview' | 'keyPoints' | 'checklist'): string {
  const profile = getGameCoachingProfile(gameId);
  const gameName = profile.name;

  if (section === 'overview') {
    return `You are a ${gameName} post-game analyst. This is a gameplay session, not a meeting.
Summarize what happened in the session using gameplay language only.

Rules:
- Write 3-5 short sentences.
- Focus on rounds, fights, mistakes, advantages, clutch moments, positioning, and decision-making.
- Do not mention meetings, discussions, colleagues, agenda, or action items.
- Be concrete and game-specific.
- Use past tense.

Return only the summary paragraph.`;
  }

  if (section === 'keyPoints') {
    return `You are a ${gameName} post-game analyst. This is a gameplay session, not a meeting.
Return the key gameplay takeaways as JSON.

Rules:
- Group by gameplay themes such as Aim, Positioning, Decision-making, Movement, and Game sense.
- Each point should describe a concrete in-game moment or repeated pattern.
- Do not mention meetings, discussions, attendees, or agenda items.
- Use short topic names and concrete points.

Output format:
{
  "key_points": [
    {
      "topic": "Topic Name",
      "points": ["Concrete gameplay point."]
    }
  ]
}`;
  }

  return `You are a ${gameName} post-game analyst. This is a gameplay session, not a meeting.
Extract the next-match goals, drills, and corrections from the session.

Rules:
- Return 3-10 concise items.
- Make each item a gameplay correction or training goal.
- Do not mention meetings, discussions, coworkers, or follow-up calls.
- Prefer drills and behavior changes over vague advice.

Output format:
{
  "checklist": [
    "Actionable gameplay goal"
  ]
}`;
}

// Summary Generator Service

export class SummaryGeneratorService {
  constructor() {}

  /**
   * Generate short overview, key points, and post-meeting checklist from full transcript
   */
  async generate(
    recordingId: number,
    context: MeetingContext
  ): Promise<PostMeetingSummary> {
    // Fetch full transcript from database
    const dbSegments = getTranscriptSegmentsByRecording(recordingId);

    if (!dbSegments || dbSegments.length === 0) {
      log.warn({ recordingId }, 'No transcript segments found for recording');
      return this.visualFallbackResults(recordingId, context);
    }

    log.info({ recordingId, segmentCount: dbSegments.length }, 'Generating post-meeting summaries');

    const transcript = this.formatTranscript(dbSegments);
    const userPrompt = this.buildUserPrompt(transcript, context);
    const gameId: SupportedGameId = context.gameId || 'chess';

    // Generate all summaries in parallel using chess coaching prompts
    const [shortOverview, keyPoints, postMeetingChecklist] = await Promise.all([
      this.generateGameOverview(userPrompt, gameId),
      this.generateGameKeyPoints(userPrompt, gameId),
      this.generateGameChecklist(userPrompt, gameId),
    ]);

    return {
      shortOverview,
      keyPoints,
      postMeetingChecklist,
      generatedAt: Date.now(),
    };
  }

  private async generateGameOverview(userPrompt: string, gameId: SupportedGameId): Promise<string> {
    const llm = getLLMService();

    try {
      const response = await llm.complete(userPrompt, buildGameSummarySystemPrompt(gameId, 'overview'));

      if (response.success && response.content) {
        return response.content.trim();
      }
    } catch (error) {
      log.error({ error, gameId }, 'Game overview generation failed');
    }

    return 'Unable to generate gameplay summary.';
  }

  private async generateGameKeyPoints(userPrompt: string, gameId: SupportedGameId): Promise<KeyPoint[]> {
    const llm = getLLMService();

    try {
      const response = await llm.complete(userPrompt, buildGameSummarySystemPrompt(gameId, 'keyPoints'));

      if (response.success && response.content) {
        const parsed = this.parseKeyPointsResponse(response.content);
        if (parsed) {
          return parsed;
        }
      }
    } catch (error) {
      log.error({ error, gameId }, 'Game key points generation failed');
    }

    return [];
  }

  private async generateGameChecklist(userPrompt: string, gameId: SupportedGameId): Promise<string[]> {
    const llm = getLLMService();

    try {
      const response = await llm.complete(userPrompt, buildGameSummarySystemPrompt(gameId, 'checklist'));

      if (response.success && response.content) {
        const parsed = this.parseChecklistResponse(response.content);
        if (parsed) {
          return parsed;
        }
      }
    } catch (error) {
      log.error({ error, gameId }, 'Game checklist generation failed');
    }

    return [];
  }

  /**
   * Parse key points JSON response
   */
  private parseKeyPointsResponse(content: string): KeyPoint[] | null {
    try {
      // Remove markdown fences if present
      let cleaned = content.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }

      const parsed = JSON.parse(cleaned);

      // Handle both { key_points: [...] } and direct array
      const keyPoints = parsed.key_points || parsed;

      if (Array.isArray(keyPoints)) {
        return keyPoints.map((kp: { topic: string; points: string[] }) => ({
          topic: kp.topic || 'Discussion',
          points: Array.isArray(kp.points) ? kp.points : [],
        }));
      }
    } catch (error) {
      log.warn({ error, content: content.slice(0, 200) }, 'Failed to parse key points JSON');
    }
    return null;
  }

  /**
   * Parse checklist JSON response
   */
  private parseChecklistResponse(content: string): string[] | null {
    try {
      // Remove markdown fences if present
      let cleaned = content.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }

      const parsed = JSON.parse(cleaned);

      // Handle both { checklist: [...] } and direct array
      const checklist = parsed.checklist || parsed;

      if (Array.isArray(checklist)) {
        return checklist.filter((item: unknown) => typeof item === 'string' && item.trim().length > 0);
      }
    } catch (error) {
      log.warn({ error, content: content.slice(0, 200) }, 'Failed to parse checklist JSON');
    }
    return null;
  }

  /**
   * Build the user prompt with meeting context
   */
  private buildUserPrompt(transcript: string, context: MeetingContext): string {
    const title = context.meetingName || (context.gameId ? `${getGameCoachingProfile(context.gameId).name} Session` : 'Chess Session');
    const description = context.meetingDescription || 'Gameplay session';

    // Format probing questions and answers
    const probingQA = context.probingQuestions?.length
      ? context.probingQuestions.map((q, i) => {
          const answer = q.customAnswer
            ? `${q.answer} (${q.customAnswer})`
            : q.answer;
          return `Q${i + 1}: ${q.question}\nA${i + 1}: ${answer}`;
        }).join('\n\n')
      : 'No pre-meeting context provided';

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

  /**
   * Format transcript segments for the LLM
   */
  private formatTranscript(segments: { channel: string; text: string; startTime: number }[]): string {
    return segments
      .map(s => {
        const speaker = s.channel === 'me' ? 'You' : 'Them';
        const time = this.formatTime(s.startTime);
        return `[${time}] ${speaker}: ${s.text}`;
      })
      .join('\n');
  }

  /**
   * Format time as MM:SS
   */
  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Return empty results
   */
  private visualFallbackResults(recordingId: number, context: MeetingContext): PostMeetingSummary {
    const visualItems = getVisualIndexItemsByRecording(recordingId);
    const gameName = context.gameId ? getGameCoachingProfile(context.gameId).name : 'game';

    const coachingBuckets = {
      positioning: [] as string[],
      timing: [] as string[],
      decisionMaking: [] as string[],
      awareness: [] as string[],
    };

    for (const item of visualItems || []) {
      const text = item.text.replace(/\s+/g, ' ').trim();
      const lower = text.toLowerCase();

      if (!text || /no actionable gameplay moment/i.test(lower)) continue;

      if (/angle|cover|exposed|off[- ]angle|high ground|peek|hold|position|crosshair|flank/.test(lower)) {
        coachingBuckets.positioning.push(text);
        continue;
      }

      if (/rotate|timing|utility|flash|smoke|molotov|nade|ult|ability|cooldown|tempo/.test(lower)) {
        coachingBuckets.timing.push(text);
        continue;
      }

      if (/push|commit|fight|trade|chase|take|save|reset|engage|escape|peek again/.test(lower)) {
        coachingBuckets.decisionMaking.push(text);
        continue;
      }

      coachingBuckets.awareness.push(text);
    }

    if (!visualItems || visualItems.length === 0) {
      const shortOverview = context.gameId
        ? `No transcript was captured for this ${gameName} session, but the coach can still help. For the next match, focus on cleaner positioning, earlier rotations, and tighter fight selection so the replay has more actionable moments.`
        : 'No transcript was captured for this session. Start recording with game audio/mic enabled for richer post-session analysis.';

      return {
        shortOverview,
        keyPoints: context.gameId
          ? [
              {
                topic: 'Next Match Priorities',
                points: [
                  'Hold tighter positions and use cover before taking fights.',
                  'Rotate earlier when the round state becomes unfavorable.',
                  'Take fewer low-value fights and look for cleaner trade setups.',
                ],
              },
            ]
          : [],
        postMeetingChecklist: context.gameId
          ? [
              'Review one lost round and identify the first safer position you could have taken.',
              'Practice slowing down before peeking so you can choose better fights.',
              'Track one round where an earlier rotate or reset would have improved the outcome.',
            ]
          : [],
        generatedAt: Date.now(),
      };
    }

    const uniqueTips = Array.from(
      new Set(
        visualItems
          .map((item) => item.text.replace(/\s+/g, ' ').trim())
          .filter((text) => !!text && !/no actionable gameplay moment/i.test(text))
      )
    ).slice(0, 4);

    const positioningPoints = Array.from(new Set(coachingBuckets.positioning)).slice(0, 3);
    const timingPoints = Array.from(new Set(coachingBuckets.timing)).slice(0, 3);
    const decisionPoints = Array.from(new Set(coachingBuckets.decisionMaking)).slice(0, 3);
    const awarenessPoints = Array.from(new Set(coachingBuckets.awareness)).slice(0, 3);

    const keyPoints: KeyPoint[] = [];

    if (positioningPoints.length > 0) {
      keyPoints.push({
        topic: 'Positioning & Cover',
        points: positioningPoints,
      });
    }

    if (timingPoints.length > 0) {
      keyPoints.push({
        topic: 'Timing & Utility',
        points: timingPoints,
      });
    }

    if (decisionPoints.length > 0) {
      keyPoints.push({
        topic: 'Decision-Making',
        points: decisionPoints,
      });
    }

    if (awarenessPoints.length > 0) {
      keyPoints.push({
        topic: 'Awareness & Fight Sense',
        points: awarenessPoints,
      });
    }

    if (keyPoints.length === 0 && uniqueTips.length > 0) {
      keyPoints.push({
        topic: 'Visual Gameplay Highlights',
        points: uniqueTips,
      });
    }

    const shortOverview = keyPoints.length > 0
      ? `This ${gameName} session showed a few repeatable improvement areas: tighter positioning, cleaner timing, and better fight selection. The strongest opportunities were around when to commit, when to reset, and how to turn visible advantages into safer rounds.`
      : `Visual analysis captured mostly non-actionable moments in this ${gameName} session. Keep recording active in-round gameplay so the coach can produce sharper strategy and tactics feedback.`;

    const checklist = keyPoints.length > 0
      ? [
          'Pick one round and review whether a safer position or earlier rotate would have improved the outcome.',
          'Practice one drill around the most common timing mistake from this session.',
          'Aim to convert one advantage state into a cleaner finish instead of forcing a risky fight.',
        ]
      : [];

    return {
      shortOverview,
      keyPoints,
      postMeetingChecklist: checklist,
      generatedAt: Date.now(),
    };
  }

  private emptyResults(): PostMeetingSummary {
    return {
      shortOverview: 'No transcript available to summarize.',
      keyPoints: [],
      postMeetingChecklist: [],
      generatedAt: Date.now(),
    };
  }
}

// Singleton Instance

let instance: SummaryGeneratorService | null = null;

export function getSummaryGenerator(): SummaryGeneratorService {
  if (!instance) {
    instance = new SummaryGeneratorService();
  }
  return instance;
}

export function resetSummaryGenerator(): void {
  instance = null;
}

export default SummaryGeneratorService;
