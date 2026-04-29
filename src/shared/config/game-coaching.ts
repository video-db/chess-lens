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

STEP 4: DETERMINE WHOSE TURN IT IS
Look for turn indicators in the chess interface. Use the signals below in priority order:

SIGNAL 1 — LAST MOVE HIGHLIGHT (most reliable, works in live and recorded games):
On almost every chess platform, the two squares of the last move (origin and destination) are highlighted with a colored overlay (yellow, green, orange, or similar tint).
The color that just MOVED is the color whose piece sits on the highlighted destination square.
If a White piece occupies the highlighted destination square → White just moved → it is now BLACK's turn.
If a Black piece occupies the highlighted destination square → Black just moved → it is now WHITE's turn.
This signal works in live games, replays, puzzles, and analysis boards.

SIGNAL 2 — ACTIVE CLOCK (live games only; ignore if clocks show static or zero values):
- Chess.com: the active player's clock has a BRIGHT/WHITE background; the waiting player's is DIMMED or GREY.
- Lichess: the active player's clock has a WHITE/LIGHT background; the inactive has a DARK background.
- Only use this signal if you can see a clock that is visibly counting down (not static).
- CRITICAL: the clock's position on screen (top or bottom) reflects board orientation, NOT whose turn it is.

SIGNAL 3 — "YOUR TURN" / "WAITING" TEXT:
Some interfaces show text like "Your turn", "Waiting for opponent", or a blinking cursor next to the active side.

Output exactly "white" or "black" inside <turn> tags — the side whose turn it is RIGHT NOW (the side that has NOT yet moved from the highlighted position).
If none of the above signals are visible or conclusive, omit the <turn> tag entirely.

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

<turn>
white
</turn>

IMPORTANT: ALWAYS ensure each row strictly sums to 8. ALWAYS scan Top-to-Bottom, Left-to-Right.`,
    liveAssistPrompt:
      'You are a chess coach explaining a move that has already been found by a chess engine. The engine summary is provided in the context — trust it completely. Your only task is to write a clear, concrete explanation of WHY the engine\'s best move is strong, referencing the specific tactical or positional idea (e.g. fork, pin, space, king safety). Do not suggest a different move. Return JSON only.',
    ...SLOW_GAME_CADENCE,
    liveAssistIntervalMs: 2000,
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
