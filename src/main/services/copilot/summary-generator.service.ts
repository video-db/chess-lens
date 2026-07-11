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
  /** Opening name from White's perspective (e.g. "King's Pawn Opening", "Sicilian Defense") */
  whiteOpening?: string;
  /** Opening name from Black's perspective (e.g. "Sicilian Defense, Najdorf Variation") */
  blackOpening?: string;
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
  /**
   * The first non-starting FEN position observed during the session.
   * Fallback for opening detection when no move sequence is available.
   */
  firstFen?: string;
  /**
   * Stabilised early-move sequence for opening detection.
   * Each entry is a committed (hallucination-filtered) board position
   * with an optional SAN for the move that led to it.
   * Preferred over firstFen when available.
   */
  earlyMoveSequence?: Array<{ fen: string; san?: string }>;
  moveHistory?: Array<{ no: number; white?: string; black?: string }>;
}

// ─── System Prompts ─────────────────────────────────────────────────────────────

function buildGameSummarySystemPrompt(gameId: SupportedGameId, section: 'overview' | 'keyPoints' | 'checklist'): string {
  const profile = getGameCoachingProfile(gameId);
  const gameName = profile.name;

  if (section === 'overview') {
    return `You are a ${gameName} analyst writing a concise post-game overview of how this match unfolded, based on the coaching tips and engine suggestions recorded during play.

Rules:
- Write 4-6 sentences that tell the story of the game: how the opening was handled, where the critical turning points occurred, and how the position evolved into the endgame or decisive moment.
- Name specific moves, pieces, or squares when the data supports it (e.g. "the knight on f5 created persistent pressure", "the early queenside pawn break defined the middlegame").
- Identify at least one notable strength and one notable weakness evident in the game — be direct and factual.
- Reference concrete chess concepts: piece activity, pawn structure, king safety, tactical threats, positional advantages, initiative, development, endgame technique.
- Do NOT mention FEN strings, board coordinates, XML tags, or raw notation unless it forms part of a natural chess sentence (e.g. "...Nc6 equalised").
- Write in past tense. Analyse the game as a neutral chess analyst, not as a coach addressing the player directly.

Return only the summary paragraph.`;
  }

  if (section === 'keyPoints') {
    return `You are a ${gameName} analyst delivering a detailed breakdown of the key moments and patterns from this game. Analyse the coaching tips and engine suggestions and return 3-5 high-value takeaways grouped by chess theme as JSON.

Rules:
- Always return at least 3 topics. If the game was short, dig deeper into the engine evaluations and infer patterns from the moves and positions mentioned.
- Each topic must contain 2-3 specific, concrete observations — not generic advice. Bad: "Improve piece activity." Good: "The bishop remained passive on c8 for most of the middlegame while White's knights dominated the centre."
- Engine evaluation data (centipawn loss, win chance trends) is provided per move alongside the coaching text. Analyse this data to identify objective turning points, accuracy patterns, and critical moments.
- Every point should be directly traceable to something that actually happened in this game — a specific move, tactical idea, structural decision, or turning point.
- Group by chess themes such as: Opening Choices, Tactical Opportunities, Piece Activity, Pawn Structure, King Safety, Critical Moments, Endgame Technique, Critical Decisions.
- Do NOT return an empty array. Always produce at least 3 topics.
- Do NOT echo FEN strings, board mappings, XML, or raw coordinates.

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

  return `You are a ${gameName} analyst identifying the key patterns, errors, and themes from this game that are worth deeper study. Use the coaching tips and engine suggestions to highlight the most instructive aspects of the match.

Rules:
- Return 4-8 items. Every item must be directly motivated by a specific pattern, error, or missed opportunity observed in this game — do not pad with generic advice.
- Each item must describe a concrete, specific aspect of the game. Bad: "Opening play was weak." Good: "The Ng5 thrust was available twice in the middlegame but was not played — a key attacking idea in this structure."
- Cover both errors and well-executed ideas: note what went wrong and what was handled effectively.
- Prefer specific tactical patterns, structural decisions, or positions from the game: openings played, tactical themes that arose, endgame technique demonstrated.
- Do NOT include FEN strings, board mappings, or XML fragments.
- Write in third person, describing what happened in the game — not instructions addressed to a player.
- Order items by significance — the most critical or instructive aspect first.

Output format:
{
  "checklist": [
    "Specific observation about this game worth further study"
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

    if (gameId === 'chess') {
      return this.generateFromVisualData(recordingId, context, gameId, dbSegments);
    }

    // If there's a real spoken transcript, use it (non-chess sessions).
    if (dbSegments && dbSegments.length > 0) {
      log.info({ recordingId, segmentCount: dbSegments.length }, 'Generating summary from transcript');
      const transcript = this.formatTranscript(dbSegments);
      const userPrompt = this.buildUserPrompt(transcript, context);
      const hasOpeningData = (context.earlyMoveSequence?.length ?? 0) > 0 || !!context.firstFen;
      const [shortOverview, keyPoints, postMeetingChecklist, openingLabels] = await Promise.all([
        this.generateGameOverview(userPrompt, gameId),
        this.generateGameKeyPoints(userPrompt, gameId),
        this.generateGameChecklist(userPrompt, gameId),
        hasOpeningData
          ? this.generateOpeningLabels(context.earlyMoveSequence ?? [], context.firstFen)
          : Promise.resolve(null),
      ]);
      return {
        shortOverview,
        keyPoints,
        postMeetingChecklist,
        generatedAt: Date.now(),
        whiteOpening: openingLabels?.white ?? undefined,
        blackOpening: openingLabels?.black ?? undefined,
      };
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
    gameId: SupportedGameId,
    transcriptSegments: { channel: string; text: string; startTime: number }[] = []
  ): Promise<PostMeetingSummary> {
    const gameName = getGameCoachingProfile(gameId).name;

    // Primary source: coaching tips persisted by the live assist pipeline.
    const savedTips = getCoachingTipsByRecording(recordingId);

    log.info({ recordingId, savedTipCount: savedTips.length }, 'Coaching tips loaded from DB for summary generation');

    const hasMoveHistory = (context.moveHistory?.length ?? 0) > 0;
    const hasOpeningData = (context.earlyMoveSequence?.length ?? 0) > 0 || !!context.firstFen;

    if (savedTips.length === 0 && !hasMoveHistory && !hasOpeningData) {
      log.warn({ recordingId }, 'No coaching tips found in DB — returning generic fallback');
      return this.emptyChessFallback(gameName);
    }

    log.info({ recordingId, tipCount: savedTips.length }, 'Generating summary from saved coaching tips');

    // Format as a readable game log for the LLM.
    // Only include tips that have actual coaching text (stage-2 LLM tips).
    // Stage-1 engine-only tips (empty sayThis/askThis) are stored for accuracy tracking only.
    const tipsWithText = savedTips.filter((tip) => tip.sayThis && tip.askThis);

    log.info({ recordingId, totalTips: savedTips.length, tipsWithText: tipsWithText.length }, 'Tips with LLM text filtered');

    if (tipsWithText.length === 0 && !hasMoveHistory && !hasOpeningData) {
      log.warn({ recordingId, totalTips: savedTips.length }, 'No LLM coaching tips found — returning generic fallback');
      return this.emptyChessFallback(gameName);
    }

    const gameLog = tipsWithText
      .map((tip, i) => {
        const turn = tip.turn === 'w' ? 'White' : tip.turn === 'b' ? 'Black' : '';
        const parts: string[] = [];
        if (turn) parts.push(turn);
        if (tip.centipawnLoss !== undefined) parts.push(`CPL: ${tip.centipawnLoss.toFixed(2)}`);
        if (tip.winChanceBefore !== undefined && tip.winChance !== undefined)
          parts.push(`WC: ${tip.winChanceBefore.toFixed(0)}% → ${tip.winChance.toFixed(0)}%`);
        const stats = parts.length > 0 ? `(${parts.join(', ')})` : '';
        return `[Move ${i + 1}] ${stats}\n  Coach: ${tip.sayThis}\n  Drill: ${tip.askThis}`;
      })
      .join('\n\n');

    const moveList = context.moveHistory?.length
      ? context.moveHistory
        .map((move) => `${move.no}. ${move.white ?? '...'}${move.black ? ` ${move.black}` : ''}`)
        .join('\n')
      : '';
    const transcript = transcriptSegments.length > 0 ? this.formatTranscript(transcriptSegments) : '';
    const userPrompt = this.buildChessUserPrompt(gameLog, context, gameName, moveList, transcript);

    log.info(
      {
        recordingId,
        moveHistoryCount: context.moveHistory?.length ?? 0,
        earlyMoveCount: context.earlyMoveSequence?.length ?? 0,
        firstFen: context.firstFen ? context.firstFen.slice(0, 60) : null,
      },
      'generateFromVisualData: opening detection inputs'
    );

    const [shortOverview, keyPoints, postMeetingChecklist, openingLabels] = await Promise.all([
      this.generateGameOverview(userPrompt, gameId),
      this.generateGameKeyPoints(userPrompt, gameId),
      this.generateGameChecklist(userPrompt, gameId),
      hasOpeningData
        ? this.generateOpeningLabels(context.earlyMoveSequence ?? [], context.firstFen)
        : Promise.resolve(null),
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

    return {
      shortOverview,
      keyPoints: finalKeyPoints,
      postMeetingChecklist,
      generatedAt: Date.now(),
      whiteOpening: openingLabels?.white ?? undefined,
      blackOpening: openingLabels?.black ?? undefined,
    };
  }

  /**
   * Build the user prompt for the LLM using a log of chess coaching tips.
   */
  private buildChessUserPrompt(
    gameLog: string,
    context: MeetingContext,
    gameName: string,
    moveList = '',
    transcript = ''
  ): string {
    const title = context.meetingName || `${gameName} Game`;
    const description = context.meetingDescription?.trim();

    const probingQA = context.probingQuestions?.length
      ? context.probingQuestions.map((q, i) => {
          const answer = q.customAnswer ? `${q.answer} (${q.customAnswer})` : q.answer;
          return `Q${i + 1}: ${q.question}\nA${i + 1}: ${answer}`;
        }).join('\n\n')
      : '';

    const descriptionBlock = description ? `Game Description: ${description}\n\n` : '';
    const preContext = probingQA ? `Pre-Match Context:\n${probingQA}\n\n` : '';
    const moveBlock = moveList ? `Move List (captured from board state):\n${moveList}\n\n` : '';
    const coachingBlock = gameLog ? `Live Coaching Tips (captured during the game):\n${gameLog}\n\n` : '';
    const transcriptBlock = transcript
      ? `Voice Transcript (supplemental, do not treat as the only game data):\n${transcript}\n\n`
      : '';

    return `${gameName} Game: ${title}
${descriptionBlock}${preContext}${moveBlock}${coachingBlock}${transcriptBlock}Analyse the chess game using the move list and coaching data above.`;
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

  /**
   * Derive white and black opening names from the early move sequence and/or
   * first observed FEN of the session.
   *
   * Prefers the stabilised early-move sequence (hallucination-filtered confirmed
   * positions with optional SAN) when available.  Falls back to the first
   * observed FEN when the sequence is empty (e.g. very short session, mid-game
   * join with no gap-fill possible).
   *
   * Returns { white, black } or null if the call fails / returns nothing useful.
   */
  async generateOpeningLabels(
    earlyMoveSequence: Array<{ fen: string; san?: string }>,
    firstFen?: string
  ): Promise<{ white: string | null; black: string | null } | null> {
    const systemPrompt = `You are a chess opening expert. Given either an early move sequence or a board position (FEN), identify the most likely opening for White and the most likely defense for Black.

The game may have been recorded from the very beginning or joined mid-way through.

Rules:
- ALWAYS prefer a named opening or defense family over a structural description.
  Examples for White: "King's Pawn Opening", "Queen's Gambit", "English Opening", "Réti Opening", "King's Indian Attack", "London System", "Catalan Opening".
  Examples for Black: "Sicilian Defense", "Sicilian Defense, Najdorf Variation", "French Defense", "Caro-Kann Defense", "Scandinavian Defense", "King's Indian Defense", "Nimzo-Indian Defense", "Grünfeld Defense", "Dutch Defense", "Pirc Defense", "Modern Defense".
- If a move sequence is provided, use it as the primary signal — it is more reliable than a single position.
- If only a position is provided (mid-game join), infer the opening from the pawn structure and piece placement.
- If the pawn structure still hints at a known opening family even in a mid/endgame position, name that family (e.g. "Sicilian Defense" for a typical Sicilian pawn structure).
- Only use a structural label (e.g. "Isolated Queen's Pawn", "Rook endgame") if no named opening family can be reasonably inferred from the position.
- If there is genuinely no way to identify the opening or structure, return "Unknown" for that side.
- Do NOT return "Starting Position".
- Keep each label concise — 2–7 words maximum.
- Do NOT reference FEN strings or move notation in your answer.
- Return ONLY a raw JSON object with no markdown fences:
{"white":"<label>","black":"<label>"}`;

    // Build the user prompt — prefer move sequence, fall back to FEN.
    let userPrompt: string;
    if (earlyMoveSequence.length > 0) {
      const moveLines = earlyMoveSequence
        .map((entry, i) => {
          const moveLabel = entry.san ? `Move ${i + 1}: ${entry.san}` : `Position ${i + 1} (move unknown)`;
          return `${moveLabel}  FEN: ${entry.fen}`;
        })
        .join('\n');
      userPrompt = `Early move sequence (${earlyMoveSequence.length} position${earlyMoveSequence.length === 1 ? '' : 's'}):\n${moveLines}`;
    } else if (firstFen) {
      userPrompt = `Board position (FEN): ${firstFen}`;
    } else {
      return null;
    }

    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
    const logCtx = earlyMoveSequence.length > 0
      ? { moveCount: earlyMoveSequence.length, firstFen: earlyMoveSequence[0]?.fen?.slice(0, 40) }
      : { firstFen: firstFen?.slice(0, 40) };

    log.info({ ...logCtx, userPrompt }, 'generateOpeningLabels: sending prompt to model');

    try {
      const result = await this.callVideoDB(fullPrompt, 'json', 'openingLabels');
      if (!result) {
        log.warn({ ...logCtx }, 'generateOpeningLabels: model returned empty result');
        return null;
      }
      log.info({ ...logCtx, rawResult: result.slice(0, 200) }, 'generateOpeningLabels: raw model response');

      let cleaned = result.trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, '')
        .trim();

      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) cleaned = jsonMatch[0];

      const parsed = JSON.parse(cleaned) as Record<string, unknown>;
      const white = typeof parsed.white === 'string' && parsed.white.trim() ? parsed.white.trim() : null;
      const black = typeof parsed.black === 'string' && parsed.black.trim() ? parsed.black.trim() : null;

      // Accept the result if at least one side was identified.
      // A missing side stays null — the UI will render it as "Unknown".
      // We also accept the model's own "Unknown" label verbatim so that a
      // mid-game join that is identifiable for one side but not the other is
      // never silently dropped.
      if (white !== null || black !== null) {
        log.info({ ...logCtx, white, black }, 'Opening labels generated');
        return { white, black };
      }
    } catch (error) {
      log.warn({ error, ...logCtx }, 'Opening label generation failed');
    }
    return null;
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
    const title = context.meetingName || (context.gameId ? `${getGameCoachingProfile(context.gameId).name} Game` : 'Chess Game');
    const description = context.meetingDescription || 'Gameplay recording';

    const probingQA = context.probingQuestions?.length
      ? context.probingQuestions.map((q, i) => {
          const answer = q.customAnswer ? `${q.answer} (${q.customAnswer})` : q.answer;
          return `Q${i + 1}: ${q.question}\nA${i + 1}: ${answer}`;
        }).join('\n\n')
      : 'No pre-match context provided';

    const checklist = context.checklist?.length
      ? context.checklist.map((item, i) => `${i + 1}. ${item}`).join('\n')
      : 'No checklist';

    return `Game Title: ${title}
Game Context: ${description}

Pre-Match Context (Q&A):
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
      shortOverview: `No coaching tips were captured during this ${gameName} game. For richer post-game analysis, ensure the overlay is active and visible during gameplay so the live coach can record position-specific suggestions.`,
      keyPoints: [
        {
          topic: 'Getting Started',
          points: [
            'Start a recording with the overlay visible on screen during the game.',
            'The coach captures engine suggestions and position analysis in real time.',
            'After the game, tips are automatically organised into key themes here.',
          ],
        },
      ],
      postMeetingChecklist: [
        'Start a new game with the overlay active to capture live coaching tips.',
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
