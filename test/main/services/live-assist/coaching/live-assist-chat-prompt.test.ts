import { describe, expect, it } from 'vitest';
import { buildLiveAssistChatPrompt } from '../../../../../src/main/services/live-assist/coaching/live-assist-chat-prompt';

describe('live assist chat prompt', () => {
  it('includes position, perspective, goals, recent tips, and selected tip context', () => {
    const prompt = buildLiveAssistChatPrompt({
      question: 'What should I do?',
      tipContext: 'Play e4',
      fullFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      perspective: 'white',
      gameGoals: 'Practice openings',
      recentTips: ['Develop a knight', 'Castle early'],
      coachPersonalityId: 'default',
    });

    expect(prompt.userPrompt).toContain('Current position (FEN):');
    expect(prompt.userPrompt).toContain('Player is: White');
    expect(prompt.userPrompt).toContain("Player's game goals: Practice openings");
    expect(prompt.userPrompt).toContain('1. Develop a knight');
    expect(prompt.userPrompt).toContain('"Play e4"');
    expect(prompt.userPrompt).toContain("Player's question: What should I do?");
    expect(prompt.hasFen).toBe(true);
    expect(prompt.hasTipContext).toBe(true);
    expect(prompt.recentTipCount).toBe(2);
  });

  it('builds a minimal prompt when no optional context is available', () => {
    const prompt = buildLiveAssistChatPrompt({
      question: 'Any plan?',
      fullFen: null,
      perspective: 'black',
      recentTips: [],
      coachPersonalityId: 'default',
    });

    expect(prompt.userPrompt).toContain('Player is: Black');
    expect(prompt.userPrompt).toContain("Player's question: Any plan?");
    expect(prompt.hasFen).toBe(false);
    expect(prompt.hasTipContext).toBe(false);
    expect(prompt.recentTipCount).toBe(0);
  });
});
