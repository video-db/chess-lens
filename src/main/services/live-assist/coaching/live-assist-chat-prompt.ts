import { getChessPersonality } from '../../../../shared/config/game-coaching';

export interface LiveAssistChatPromptInput {
  question: string;
  tipContext?: string;
  fullFen: string | null;
  perspective: 'white' | 'black';
  gameGoals?: string | null;
  recentTips: string[];
  coachPersonalityId: string;
}

export interface LiveAssistChatPrompt {
  userPrompt: string;
  systemPrompt: string;
  hasFen: boolean;
  hasTipContext: boolean;
  recentTipCount: number;
}

export function buildLiveAssistChatPrompt({
  question,
  tipContext,
  fullFen,
  perspective,
  gameGoals,
  recentTips,
  coachPersonalityId,
}: LiveAssistChatPromptInput): LiveAssistChatPrompt {
  const fenLine = fullFen
    ? `Current position (FEN): ${fullFen}`
    : '';
  const perspLine = `Player is: ${perspective === 'black' ? 'Black' : 'White'}`;
  const gameGoalsLine = gameGoals?.trim()
    ? `Player's game goals: ${gameGoals.trim()}`
    : '';
  const recentTipsLine = recentTips.length > 0
    ? `Recent coaching tips shown to player:\n${recentTips.map((tip, index) => `${index + 1}. ${tip}`).join('\n')}`
    : '';
  const tipLine = tipContext?.trim()
    ? `The player is asking about this specific tip/analysis:\n"${tipContext.trim()}"`
    : '';

  const contextBlock = [fenLine, perspLine, gameGoalsLine, recentTipsLine, tipLine]
    .filter(Boolean)
    .join('\n');

  const personality = getChessPersonality(coachPersonalityId);
  const formatRule = 'Be concise, concrete, and chess-specific. Reference the actual position and recent moves when relevant. Keep answers under 120 words. Respond in plain text (not JSON).';
  const systemPrompt = personality.id !== 'default'
    ? `${personality.promptStyle}\n\n${formatRule}`
    : `You are a strong chess coach answering a player's question during a live game. ${formatRule}`;
  const userPrompt = contextBlock
    ? `${contextBlock}\n\nPlayer's question: ${question}`
    : `Player's question: ${question}`;

  return {
    userPrompt,
    systemPrompt,
    hasFen: !!fullFen,
    hasTipContext: !!tipContext?.trim(),
    recentTipCount: recentTips.length,
  };
}
