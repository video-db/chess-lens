import { extractFenFromBoardMappingWindow as extractFenFromBoardMappingWindowTexts } from '../vision/chess-fen-extractor';

export interface LiveAssistVisualChunk {
  text: string;
}

export interface LiveAssistFenCandidate {
  fen: string;
  source: string;
}

interface SelectLatestFenOptions {
  visuals: LiveAssistVisualChunk[];
  getFenCandidates: (text: string) => LiveAssistFenCandidate[];
  sanitizeText: (text: string) => string;
  debug: (data: Record<string, unknown>, message: string) => void;
}

export function selectLatestFenFromVisuals({
  visuals,
  getFenCandidates,
  sanitizeText,
  debug,
}: SelectLatestFenOptions): string | null {
  // Preference order:
  // 1. RTStream math-validated raw XML from indexVisuals().
  // 2. Screenshot path: validated, voted, confidence-gated fallback.
  // 3. Any tagged_raw_board item, for RTStream-like payloads without a source tag.
  // 4. Any valid FEN source.
  // 5. Board-mapping window assembly from partial rows.

  for (let i = visuals.length - 1; i >= 0; i--) {
    const text = visuals[i]!.text;
    if (!text.includes('<source>') || !text.includes('rtstream')) continue;

    const preferred = getFenCandidates(text).find((candidate) => candidate.source === 'tagged_raw_board');
    if (preferred) {
      debug({ source: 'rtstream_raw_board', fen: preferred.fen }, '[LiveAssist] Selected latest chess FEN (RTStream path)');
      return preferred.fen;
    }
  }

  for (let i = visuals.length - 1; i >= 0; i--) {
    const text = visuals[i]!.text;
    if (!text.includes('<source>') || !text.includes('screenshot')) continue;

    const preferred = getFenCandidates(text).find((candidate) => candidate.source === 'tagged_raw_board');
    if (preferred) {
      debug({ source: 'screenshot_raw_board', fen: preferred.fen }, '[LiveAssist] Selected latest chess FEN (screenshot fallback path)');
      return preferred.fen;
    }
  }

  for (let i = visuals.length - 1; i >= 0; i--) {
    const preferred = getFenCandidates(visuals[i]!.text).find((candidate) => candidate.source === 'tagged_raw_board');
    if (preferred) {
      debug({ source: preferred.source, fen: preferred.fen }, '[LiveAssist] Selected latest chess FEN (tagged_raw_board fallback)');
      return preferred.fen;
    }
  }

  for (let i = visuals.length - 1; i >= 0; i--) {
    const candidates = getFenCandidates(visuals[i]!.text);
    if (candidates.length > 0) {
      debug({ source: candidates[0]!.source, fen: candidates[0]!.fen }, '[LiveAssist] Selected latest chess FEN (any source fallback)');
      return candidates[0]!.fen;
    }
  }

  const windowFen = extractFenFromBoardMappingWindowTexts(
    visuals.map((visual) => visual.text),
    { sanitizeText },
  );

  if (windowFen) {
    debug({ source: 'board_mapping_window', fen: windowFen }, '[LiveAssist] Selected latest chess FEN');
    return windowFen;
  }

  debug(
    { visualCount: visuals.length, sample: visuals.slice(-2).map((visual) => visual.text.substring(0, 160)) },
    '[LiveAssist] No valid chess FEN extracted from current window',
  );
  return null;
}
