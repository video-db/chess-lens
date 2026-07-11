import crypto from 'crypto';
import sharp from 'sharp';

const FRAME_HASH_STRIDE = 512;

/** One raw FEN extraction result stored in the vote ring buffer. */
export interface VoteEntry {
  fenBoard: string;
  perspective: 'white' | 'black';
  /** Whose turn it is as reported by the LLM <turn> tag. Null when absent. */
  reportedTurn: 'w' | 'b' | null;
  /** Algebraic square of the FROM square of the last move, e.g. "e2". */
  reportedLastMoveFrom: string | null;
  /** Algebraic square of the TO square of the last move, e.g. "e4". */
  reportedLastMoveTo: string | null;
  /** Wall-clock time when this entry was added to the buffer. */
  seenAt: number;
  /** How long the fenExtract LLM call took for this entry, in ms. */
  fenExtractMs: number;
  /** True when neither the FEN call nor the turn call needed an LLM retry. */
  noRetryNeeded: boolean;
  /** Raw LLM text response from the FEN extraction call. */
  fenRawText: string | null;
  /** Raw <raw_board> content before perspective flipping. */
  fenRawBoard: string | null;
  /** Whether the FEN extraction call needed a retry. */
  fenRetried: boolean;
  /** Whether local auto-correction was applied to the FEN. */
  fenAutoFixed: boolean;
  /** Whether the rank transposition fixer changed the FEN. */
  rankFixApplied?: boolean;
  /** FEN before rank transposition fix, if applied. */
  rankFixFrom?: string;
  /** FEN after rank transposition fix, if applied. */
  rankFixTo?: string;
  /** Whether the perspective flip gate rejected this entry. */
  perspectiveFlipRejected?: boolean;
  /** Confidence gate decision. */
  confidenceDecision?: 'fast' | 'slow' | 'rejected';
  /** Confidence gate reasons for debug. */
  confidenceReasons?: string[];
}

export interface ConfidenceResult {
  high: boolean;
  reasons: string[];
}

export function sampleHash(buf: Buffer): string {
  const hash = crypto.createHash('sha1');
  for (let i = 0; i < buf.length; i += FRAME_HASH_STRIDE) {
    hash.update(buf.subarray(i, i + 1));
  }
  return hash.digest('hex');
}

export async function sharpenImage(
  pngBuffer: Buffer,
  log: { debug: (...args: unknown[]) => void; warn: (...args: unknown[]) => void },
): Promise<Buffer> {
  try {
    const sharpened = await sharp(pngBuffer)
      .sharpen({ sigma: 1.5 })
      .png()
      .toBuffer();
    log.debug({ origBytes: pngBuffer.length, sharpBytes: sharpened.length }, '[ChessScreenshot] Unsharp mask applied');
    return sharpened;
  } catch (err) {
    log.warn({ err }, '[ChessScreenshot] Sharpening failed, using original image');
    return pngBuffer;
  }
}

export function squareDeltaFenBoards(fenA: string, fenB: string): number {
  const expand = (fen: string): string => {
    const squares: string[] = [];
    for (const rank of fen.split('/')) {
      for (const ch of rank) {
        if (/\d/.test(ch)) {
          for (let i = 0; i < parseInt(ch, 10); i++) squares.push('.');
        } else {
          squares.push(ch);
        }
      }
    }
    return squares.join('');
  };

  const a = expand(fenA);
  const b = expand(fenB);
  if (a.length !== 64 || b.length !== 64) return Infinity;

  let diff = 0;
  for (let i = 0; i < 64; i++) {
    if (a[i] !== b[i]) diff++;
  }
  return diff;
}

export function scoreFenConfidence(
  rawResult: VoteEntry,
  lastConfirmedFen: string | null,
  maxSquareDelta: number,
): ConfidenceResult {
  const reasons: string[] = [];

  if (!rawResult.noRetryNeeded) {
    reasons.push('retryNeeded(soft)');
  }

  const hasTurnSignal =
    rawResult.reportedTurn !== null ||
    (rawResult.reportedLastMoveFrom !== null && rawResult.reportedLastMoveTo !== null);
  if (!hasTurnSignal) {
    reasons.push('noTurnSignal(soft)');
  }

  const hardReasons: string[] = [];
  if (lastConfirmedFen) {
    const delta = squareDeltaFenBoards(rawResult.fenBoard, lastConfirmedFen);
    if (delta > maxSquareDelta) hardReasons.push(`largeDelta(${delta})`);
  }

  return { high: hardReasons.length === 0, reasons: [...hardReasons, ...reasons] };
}
