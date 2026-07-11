import type { LiveInsights } from '../../../../shared/types/live-assist.types';
import { getChessPersonality } from '../../../../shared/config/game-coaching';
import { logger } from '../../../lib/logger';
import type { ChessContextData } from '../live-assist.types';
import { GPT_54_MODEL, getLLMService } from '../../llm/llm.service';
import { CHESS_SYSTEM_PROMPT } from './live-assist-prompts';
import {
  normalizeInsights,
  parseCoachingJson,
} from './live-assist-coaching-response';
import { isSpecificChessTip } from './live-assist-insights';

const log = logger.child({ module: 'live-assist' });

interface RequestCoachingInsightsOptions {
  coachPersonalityId: string;
  userPrompt: string;
  bestMoveSan: string | null;
  chessContext: ChessContextData | null;
  sanitizeInsightText: (text: string) => string;
  startCoachingLlm: () => void;
  endCoachingLlm: () => void;
}

export async function requestCoachingInsights({
  coachPersonalityId,
  userPrompt,
  bestMoveSan,
  chessContext,
  sanitizeInsightText,
  startCoachingLlm,
  endCoachingLlm,
}: RequestCoachingInsightsOptions): Promise<{ parsed: LiveInsights | null; rawText: string | null }> {
  const personality = getChessPersonality(coachPersonalityId);
  const activeSystemPrompt = personality.id !== 'default'
    ? `${personality.promptStyle}\n\n${CHESS_SYSTEM_PROMPT}`
    : CHESS_SYSTEM_PROMPT;
  const fullPrompt = [activeSystemPrompt, userPrompt].join('\n\n');

  log.info(
    { promptTokensEstimate: Math.ceil(fullPrompt.length / 4), model: GPT_54_MODEL },
    '[LiveAssist] Requesting coaching tip via gpt-5.4 [background]',
  );

  const llm = getLLMService();
  startCoachingLlm();
  const response = await llm.complete(fullPrompt, undefined, 45000, GPT_54_MODEL);
  endCoachingLlm();
  const rawText = response.success ? response.content : null;

  if (!response.success) {
    log.warn({ error: response.error }, '[LiveAssist] Background coaching (gpt-5.4) failed - engine tip stays');
  }

  let parsed: LiveInsights | null = parseCoachingJson(rawText);

  log.debug(
    {
      hasData: !!parsed,
      rawPreview: (rawText ?? '').slice(0, 300),
      say_this: String(parsed?.say_this ?? '').slice(0, 80),
    },
    '[LiveAssist] Background coaching response received',
  );

  if (!chessContext?.terminalState) {
    parsed = await maybeRepairGenericTip({
      current: parsed,
      userPrompt,
      activeSystemPrompt,
      bestMoveSan,
      sanitizeInsightText,
    });
  }

  return { parsed, rawText };
}

async function maybeRepairGenericTip({
  current,
  userPrompt,
  activeSystemPrompt,
  bestMoveSan,
  sanitizeInsightText,
}: {
  current: LiveInsights | null;
  userPrompt: string;
  activeSystemPrompt: string;
  bestMoveSan: string | null;
  sanitizeInsightText: (text: string) => string;
}): Promise<LiveInsights | null> {
  if (!current) return current;
  const currentSay = normalizeInsights(current.say_this)
    .map(item => sanitizeInsightText(item))
    .find(Boolean) || '';

  if (isSpecificChessTip(currentSay, bestMoveSan)) return current;

  const repairPrompt = `${userPrompt}

Previous draft was too generic or too short:
${currentSay || '(empty)'}

Rewrite it in one or two sentences (20-30 words total). Name the required move and explain the immediate board effect - the specific threat, square, or piece activity - and briefly note the follow-up benefit or what it prevents. Return ONLY raw JSON.`;

  const repairResponse = await getLLMService().complete(repairPrompt, activeSystemPrompt, 15000, GPT_54_MODEL);
  if (!repairResponse.success || !repairResponse.content) return current;

  const repaired = parseCoachingJson(repairResponse.content);
  const repairedSay = normalizeInsights(repaired?.say_this)
    .map(item => sanitizeInsightText(item))
    .find(Boolean) || '';

  return isSpecificChessTip(repairedSay, bestMoveSan) ? repaired : current;
}
