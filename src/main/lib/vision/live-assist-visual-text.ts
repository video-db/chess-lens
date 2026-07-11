export function isNonActionableVisualText(text: string): boolean {
  return /no actionable gameplay (?:moment|context)(?: is available| in this frame)?\.?/i.test(text.trim());
}

export function stripNonActionableVisualText(
  text: string,
  sanitizeInsightText: (text: string) => string,
): string {
  const parts = text
    .split(/\|\|\||\n+/)
    .map((part) => sanitizeInsightText(part))
    .filter(Boolean)
    .filter((part) => !isNonActionableVisualText(part));
  return parts.join(' ').trim();
}

export function isLikelyGameplayFeed(texts: string[]): boolean {
  const haystack = texts.join(' ').toLowerCase();
  const gameplaySignals = [
    'chess',
    'board',
    'pawn',
    'knight',
    'bishop',
    'rook',
    'queen',
    'king',
    'check',
    'checkmate',
    'castle',
    'en passant',
    'fianchetto',
    'opening',
    'fen',
  ];
  return gameplaySignals.some((signal) => haystack.includes(signal));
}
