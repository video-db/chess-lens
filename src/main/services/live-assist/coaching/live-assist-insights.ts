const CONCRETE_CHESS_SIGNAL =
  /\b(center|file|diagonal|square|bishop|knight|rook|queen|king|pawn|attack|attacks|defend|defends|pressure|fork|pin|skewer|tempo|develop|development|castle|mate|threat|weak|open|opens|capture|recapture|initiative)\b/;

export function sanitizeInsightText(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/__+/g, '')
    .replace(/`+/g, '')
    .replace(/^\s*[-*•]\s*/g, '')
    .replace(/^\s*(say|ask)\s*:\s*/i, '')
    .replace(/\s*(say|ask)\s*:\s*/gi, ' ')
    .replace(/\.{3}([NBRQK]?[a-h]?[1-8]?x?[a-h][1-8](?:=[NBRQ])?[+#]?)/g, 'Black\'s $1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getInstructionSignature(sayThis: string[], askThis: string[]): string {
  const normalize = (text: string): string => sanitizeInsightText(text).toLowerCase();
  return [...sayThis.map(normalize), '::', ...askThis.map(normalize)].join(' | ').trim();
}

export function isGenericTip(text: string): boolean {
  const low = text.toLowerCase().trim();
  if (!low) return true;
  return /^(improve aim|use cover|practice more|play better|focus up|be careful|good job|nice|keep trying)\b/.test(low)
    || /^(improve|practice|focus)\b/.test(low);
}

export function isSpecificChessTip(text: string, requiredMove?: string | null): boolean {
  const low = text.toLowerCase().trim();
  if (!low || isGenericTip(low)) return false;

  const mentionsMove = !requiredMove || low.includes(requiredMove.toLowerCase());
  return mentionsMove && CONCRETE_CHESS_SIGNAL.test(low);
}
