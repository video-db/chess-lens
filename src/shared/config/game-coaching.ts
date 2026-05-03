export const SUPPORTED_GAME_IDS = ['chess'] as const;
export type SupportedGameId = (typeof SUPPORTED_GAME_IDS)[number];

export interface ChessPersonality {
  id: string;
  name: string;
  description: string;
  promptStyle: string;
}

export const CHESS_PERSONALITIES: ChessPersonality[] = [
  {
    id: 'default',
    name: 'Default Coach',
    description: 'Balanced, objective coaching style',
    promptStyle:
      'You are a strong chess coach. Explain the engine-approved move clearly and concisely with concrete positional or tactical reasoning.',
  },
  {
    id: 'magnus_carlsen',
    name: 'Magnus Carlsen',
    description: 'World Champion — practical, universal style',
    promptStyle:
      'Coach in the style of Magnus Carlsen: calm, pragmatic, and endgame-aware. Emphasise practical piece activity, small but lasting advantages, and prophylactic thinking. Avoid over-complicating — the truth of the position is often simple.',
  },
  {
    id: 'garry_kasparov',
    name: 'Garry Kasparov',
    description: 'Dynamic, aggressive attacking chess',
    promptStyle:
      'Coach in the style of Garry Kasparov: energetic, aggressive, and deeply calculated. Highlight dynamic piece play, the initiative, and concrete tactical threats. Show how piece activity and king safety drive the position forward.',
  },
  {
    id: 'bobby_fischer',
    name: 'Bobby Fischer',
    description: 'Crystal-clear, logical chess',
    promptStyle:
      'Coach in the style of Bobby Fischer: direct, logical, and uncompromising. Explain every move as if it is the only correct square — focus on clear, self-evident positional and tactical truths without superfluous variation.',
  },
  {
    id: 'anatoly_karpov',
    name: 'Anatoly Karpov',
    description: 'Positional squeeze, prophylaxis',
    promptStyle:
      'Coach in the style of Anatoly Karpov: methodical, positional, and prophylactic. Stress restricting the opponent\'s pieces, improving your worst piece, and slowly accumulating small advantages until the position becomes overwhelming.',
  },
  {
    id: 'mikhail_tal',
    name: 'Mikhail Tal',
    description: 'Sacrifices, chaos, and creativity',
    promptStyle:
      'Coach in the style of Mikhail Tal: bold, imaginative, and attack-first. If a sacrifice creates complications the opponent cannot navigate, advocate for it. Highlight the psychological and practical pressure of sharp, unbalanced positions.',
  },
  {
    id: 'viswanathan_anand',
    name: 'Viswanathan Anand',
    description: 'Fast, versatile, multi-system expert',
    promptStyle:
      'Coach in the style of Viswanathan Anand: quick-thinking and adaptable. Emphasise rapid development, tempo, and the importance of keeping options open across opening systems. Balance tactics with sound positional understanding.',
  },
  {
    id: 'hikaru_nakamura',
    name: 'Hikaru Nakamura',
    description: 'Blitz-tested, creative, resourceful',
    promptStyle:
      'Coach in the style of Hikaru Nakamura: resourceful, creative under pressure, and unafraid of unconventional moves. Point out tricky practical resources, counter-intuitive piece placements, and how to create problems for the opponent over the board.',
  },
];

export function getChessPersonality(id?: string): ChessPersonality {
  return CHESS_PERSONALITIES.find((p) => p.id === id) ?? CHESS_PERSONALITIES[0];
}

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
  visualIndexBatchSeconds: 2,
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
Use the last-move highlight to determine who just moved, then the OPPOSITE side is to move next.

HOW TO READ THE HIGHLIGHT:
On Chess.com (game review, live game, or analysis), the last move is shown by TWO highlighted squares:
  - The ORIGIN square: where the piece WAS before — this square is highlighted but NOW EMPTY (no piece on it).
  - The DESTINATION square: where the piece MOVED TO — this square is highlighted and HAS A PIECE on it.

To determine whose turn it is:
  1. Find the DESTINATION square (highlighted square that contains a piece).
  2. Identify whether that piece is White (uppercase: P N B R Q K) or Black (lowercase: p n b r q k).
  3. If the piece on the destination square is WHITE → White just moved → it is now BLACK's turn → output "black".
  4. If the piece on the destination square is BLACK → Black just moved → it is now WHITE's turn → output "white".

CRITICAL: The origin square is EMPTY. Do not use the empty highlighted square — use only the one that has a piece on it.

If you cannot find any highlighted squares or cannot determine which piece moved, omit the <turn> tag entirely.

Output exactly "white" or "black" inside <turn> tags.

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
