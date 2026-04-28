export const SUPPORTED_GAME_IDS = ['chess'] as const;
export type SupportedGameId = (typeof SUPPORTED_GAME_IDS)[number];

export interface GameCoachingProfile {
  id: SupportedGameId;
  name: string;
  coachLabel: string;
  indexingPrompt: string;
  liveAssistPrompt: string;
  visualIndexBatchSeconds: number;
  visualIndexFrameCount: number;
  liveAssistIntervalMs: number;
  visualContextWindowMs: number;
  visualRecencyFocusMs: number;
}

export const DEFAULT_GAME_ID: SupportedGameId = 'chess';

const LIVE_ASSIST_RECENCY_RULE = 'Recency focus: treat the latest 5-8 seconds of visuals as source-of-truth. If an older position conflicts with a newer position, trust the newer evidence and avoid stale callouts.';

const SLOW_GAME_CADENCE = {
  visualIndexBatchSeconds: 3,
  visualIndexFrameCount: 1,
  liveAssistIntervalMs: 20000,
  visualContextWindowMs: 45000,
  visualRecencyFocusMs: 15000,
};

export const GAME_COACHING_PROFILES: GameCoachingProfile[] = [
  {
    id: 'chess',
    name: 'Chess',
    coachLabel: 'Chess Coach',
    indexingPrompt:
      `You are an expert chess analysis AI.
Your task is to analyze the image of a chessboard and extract the pieces EXACTLY as they appear visually, from TOP to BOTTOM, LEFT to RIGHT.
Do NOT try to determine FEN orientation. Just act as a strict visual scanner.

STEP 1: DETERMINE PERSPECTIVE
Look at the board. Are the White pieces at the visual bottom, or are the Black pieces at the visual bottom?
State your answer clearly inside <perspective> tags. Output exactly either "white" or "black".

STEP 2: VISUAL ROW-BY-ROW MAPPING
Scan the board visually from the top row to the bottom row (8 rows).
For each row, scan strictly from the left edge to the right edge.
Use uppercase for White pieces (P, N, B, R, Q, K), lowercase for Black (p, n, b, r, q, k). Use single digits for consecutive empty squares.
List your visual scan inside <board_mapping> tags. Verify that the sum of pieces and empty squares in every single visual row exactly equals 8.

STEP 3: GENERATE RAW STRING
Combine the 8 visual rows using the '/' separator and output the raw string inside <raw_board> tags. Do not include anything else.

Example format:
<perspective>
white
</perspective>

<board_mapping>
Visual Row 1 (Top): r, n, b, q, k, b, n, r (String: rnbqkbnr)
Visual Row 2: p, p, p, p, p, p, p, p (String: pppppppp)
Visual Row 3: 8 empty (String: 8)
Visual Row 4: 8 empty (String: 8)
Visual Row 5: 4 empty, P, 3 empty (String: 4P3)
Visual Row 6: 8 empty (String: 8)
Visual Row 7: P, P, P, P, 1 empty, P, P, P (String: PPPP1PPP)
Visual Row 8 (Bottom): R, N, B, Q, K, B, N, R (String: RNBQKBNR)
</board_mapping>

<raw_board>
rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR
</raw_board>

IMPORTANT: ALWAYS ensure each row strictly sums to 8. ALWAYS scan Top-to-Bottom, Left-to-Right.`,
    liveAssistPrompt:
      'You are a chess live assistant. For the current FEN, use the chess engine API to fetch the best move and evaluation. Integrate the best move (in SAN) and a brief explanation of why it is strong, referencing concrete tactical or positional ideas. If possible, include the engine evaluation and top line. Focus your tip on the best move and its reasoning, not on generic advice. Return exactly one full-paragraph say_this tip (explaining the best move and its idea) and one short ask_this fix drill in JSON only.',
    ...SLOW_GAME_CADENCE,
    liveAssistIntervalMs: 5000,
  }
];

const profilesById = new Map<SupportedGameId, GameCoachingProfile>(
  GAME_COACHING_PROFILES.map((profile) => [profile.id, profile])
);

export function getGameCoachingProfile(gameId?: string): GameCoachingProfile {
  const normalized = (gameId || '').toLowerCase() as SupportedGameId;
  return profilesById.get(normalized) || profilesById.get(DEFAULT_GAME_ID)!;
}

export function getGameIndexingPrompt(gameId?: string): string {
  return getGameCoachingProfile(gameId).indexingPrompt;
}

export function getGameLiveAssistPrompt(gameId?: string): string {
  const basePrompt = getGameCoachingProfile(gameId).liveAssistPrompt;
  return `${basePrompt} ${LIVE_ASSIST_RECENCY_RULE}`;
}

export function getGameVisualIndexTiming(gameId?: string): Pick<
  GameCoachingProfile,
  'visualIndexBatchSeconds' | 'visualIndexFrameCount' | 'liveAssistIntervalMs' | 'visualContextWindowMs' | 'visualRecencyFocusMs'
> {
  const profile = getGameCoachingProfile(gameId);
  return {
    visualIndexBatchSeconds: profile.visualIndexBatchSeconds,
    visualIndexFrameCount: profile.visualIndexFrameCount,
    liveAssistIntervalMs: profile.liveAssistIntervalMs,
    visualContextWindowMs: profile.visualContextWindowMs,
    visualRecencyFocusMs: profile.visualRecencyFocusMs,
  };
}
