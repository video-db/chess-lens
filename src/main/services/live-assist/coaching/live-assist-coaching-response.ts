import type { LiveInsights } from '../../../../shared/types/live-assist.types';
import type { ChessContextData } from '../live-assist.types';

export interface FinalCoachingOutput {
  finalSayThis: string[];
  finalAskThis: string[];
}

export function parseCoachingJson(text: string | null): LiveInsights | null {
  if (!text) return null;

  let payload = text.trim();
  const fenceMatch = payload.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    payload = fenceMatch[1]!.trim();
  } else {
    payload = payload.replace(/^```(?:json)?\s*/i, '').trim();
  }

  const jsonStart = payload.indexOf('{');
  const jsonEnd = payload.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    payload = payload.slice(jsonStart, jsonEnd + 1);
  }

  try {
    const raw = JSON.parse(payload) as Record<string, unknown>;
    return {
      say_this: normalizeInsights(raw.say_this ?? raw.sayThis),
      ask_this: normalizeInsights(raw.ask_this ?? raw.askThis),
    };
  } catch {
    return null;
  }
}

export function normalizeInsights(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  return typeof value === 'string' ? [value] : [];
}

export function buildFinalCoachingOutput(
  parsed: LiveInsights,
  chessContext: ChessContextData | null,
  sanitizeInsightText: (text: string) => string,
  hasSeenSay: (text: string) => boolean,
  hasSeenAsk: (text: string) => boolean,
): FinalCoachingOutput {
  const sayThisList = normalizeInsights(parsed.say_this)
    .map(item => sanitizeInsightText(item))
    .filter(Boolean)
    .filter(item => !hasSeenSay(item.toLowerCase()))
    .slice(0, 3);
  const askThisList = normalizeInsights(parsed.ask_this)
    .map(item => sanitizeInsightText(item))
    .filter(Boolean)
    .filter(item => !hasSeenAsk(item.toLowerCase()))
    .slice(0, 3);

  const finalSayThis: string[] = [];
  const finalAskThis: string[] = [];
  const paragraph = sayThisList.find(Boolean) || '';
  const PARAGRAPH_SAFETY_CHARS = 280;
  const trimmedParagraph = paragraph.length > PARAGRAPH_SAFETY_CHARS
    ? trimToSentenceBoundary(paragraph, PARAGRAPH_SAFETY_CHARS)
    : paragraph;

  if (trimmedParagraph && !looksLikeFen(trimmedParagraph)) {
    finalSayThis.push(trimmedParagraph);
  }

  const engineCompact = compactEngineSummary(chessContext?.engineSummary || '', sanitizeInsightText);
  if (engineCompact) finalSayThis.push(`Engine: ${engineCompact}`);

  const drill = askThisList.find(Boolean) || '';
  if (drill) {
    const trimmedDrill = drill.length > 160 ? drill.slice(0, 160).trim() : drill;
    finalAskThis.push(/^drill:/i.test(trimmedDrill) ? trimmedDrill : `Drill: ${trimmedDrill}`);
  }

  return { finalSayThis, finalAskThis };
}

function trimToSentenceBoundary(text: string, maxChars: number): string {
  const safe = text.slice(0, maxChars);
  const lastDot = safe.lastIndexOf('.');
  return lastDot > 0 ? safe.slice(0, lastDot + 1) : safe;
}

function looksLikeFen(text: string): boolean {
  const looksLikeFullFen = /[prnbqkPRNBQK1-8/]+\s+[wb]\s+(?:-|[KQkq]{1,4})\s+(?:-|[a-h][36])\s+\d+\s+\d+/.test(text);
  const looksLikeBoardOnly = /^[prnbqkPRNBQK1-8]+(?:\/[prnbqkPRNBQK1-8]+){7}$/.test(text);
  return looksLikeFullFen || looksLikeBoardOnly;
}

function compactEngineSummary(
  engineSummary: string,
  sanitizeInsightText: (text: string) => string,
): string {
  if (!engineSummary) return '';

  const lines = engineSummary
    .split('\n')
    .map(line => sanitizeInsightText(line))
    .filter(Boolean);
  const pick = (prefix: string) => lines.find(line => line.toLowerCase().startsWith(prefix)) || '';
  const best = pick('best move') || pick('best');
  const evalLine = pick('eval') || pick('mate');
  const top = pick('top lines') || pick('top');
  const parts = [best, evalLine, top].filter(Boolean);
  const combined = (parts.length > 0 ? parts.join(' | ') : lines.slice(0, 2).join(' | ')).trim();
  return combined.length > 220 ? combined.slice(0, 220).trim() : combined;
}
