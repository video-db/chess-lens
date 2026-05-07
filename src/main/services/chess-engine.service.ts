import { logger } from '../lib/logger';
import { loadRuntimeConfig } from '../lib/config';

const log = logger.child({ module: 'chess-engine-service' });
const DEFAULT_CHESS_ENGINE_API_URL = 'https://chess-api.com/v1';
/**
 * Hard timeout for each individual chess engine HTTP call.
 * chess-api.com typically responds in 500ms–3s depending on position complexity.
 * 8s gives ample headroom without blocking the pipeline indefinitely.
 */
const CHESS_ENGINE_TIMEOUT_MS = 8000;

export interface ChessEngineAnalyzeOptions {
  variants?: number;
  depth?: number;
  maxThinkingTime?: number;
  searchmoves?: string;
}

export interface ChessEngineMoveLine {
  move?: string;
  san?: string;
  lan?: string;
  eval?: number;
  centipawns?: string;
  mate?: number | null;
  continuationArr?: string[];
  /** Source square in algebraic notation, e.g. "b7". Returned directly by chess-api.com. */
  from?: string;
  /** Destination square in algebraic notation, e.g. "b8". Returned directly by chess-api.com. */
  to?: string;
}

export interface ChessEngineResponse extends ChessEngineMoveLine {
  fen?: string;
  text?: string;
  depth?: number;
  winChance?: number;
  taskId?: string;
  time?: number;
  type?: string;
  debug?: string;
  variants?: ChessEngineMoveLine[];
  moves?: ChessEngineMoveLine[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class ChessEngineService {
  private static instance: ChessEngineService | null = null;

  static getInstance(): ChessEngineService {
    if (!ChessEngineService.instance) {
      ChessEngineService.instance = new ChessEngineService();
    }
    return ChessEngineService.instance;
  }

  static resetInstance(): void {
    ChessEngineService.instance = null;
  }

  private getEndpoint(): string | null {
    return DEFAULT_CHESS_ENGINE_API_URL;
  }

  /**
   * Single API call — returns one best move result.
   */
  async analyzeByFen(fen: string, options?: ChessEngineAnalyzeOptions): Promise<ChessEngineResponse | null> {
    const endpoint = this.getEndpoint();
    if (!endpoint) return null;

    const payload = {
      fen,
      variants: clamp(options?.variants ?? 5, 1, 5),
      depth: clamp(options?.depth ?? 12, 1, 18),
      maxThinkingTime: clamp(options?.maxThinkingTime ?? 50, 1, 100),
      searchmoves: options?.searchmoves || '',
    };

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(CHESS_ENGINE_TIMEOUT_MS),
      });

      if (!response.ok) {
        log.warn({ status: response.status }, 'Chess engine HTTP error');
        return null;
      }

      const data = (await response.json()) as ChessEngineResponse;

      if ((data as unknown as Record<string, unknown>).type === 'error') {
        const errData = data as unknown as { error?: string; text?: string };
        log.warn({ fenError: errData.error, text: errData.text }, 'Chess engine rejected FEN — treating as no analysis');
        return null;
      }

      return data;
    } catch (error) {
      const isAbort =
        error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
      if (isAbort) {
        log.warn({ timeoutMs: CHESS_ENGINE_TIMEOUT_MS }, 'Chess engine request timed out');
      } else {
        log.warn({ error }, 'Chess engine request failed');
      }
      return null;
    }
  }

  /**
   * Fetch the best move for a position.
   * chess-api.com returns only a single best move per call regardless of the
   * `variants` parameter — additional lines are derived from `continuationArr`.
   * Returns a single-element array for API compatibility with summarize().
   */
  async getTopLines(fen: string, _count: number, baseOptions?: ChessEngineAnalyzeOptions): Promise<ChessEngineResponse[]> {
    const opts = {
      depth: clamp(baseOptions?.depth ?? 12, 1, 18),
      maxThinkingTime: clamp(baseOptions?.maxThinkingTime ?? 50, 1, 100),
    };
    const result = await this.analyzeByFen(fen, opts);
    return result ? [result] : [];
  }

  /**
   * Build the engine summary string shown in the overlay.
   * chess-api.com returns only one best move — we use the continuationArr
   * (engine's principal variation) to populate additional lines.
   * Falls back to parsing the raw UCI `debug` string when continuationArr is empty.
   * Line 1 = best move + eval.
   * Lines 2–3 = next moves from the continuation (opponent reply, engine reply).
   */
  summarize(best: ChessEngineResponse, _topLines: ChessEngineResponse[]): string {
    const parts: string[] = [];

    if (best.san) parts.push(`Best move SAN: ${best.san}`);
    if (best.lan) parts.push(`Best move LAN: ${best.lan}`);

    if (best.mate != null) {
      parts.push(`Mate: ${best.mate}`);
    } else if (typeof best.eval === 'number') {
      parts.push(`Eval: ${best.eval}`);
    }

    // Resolve the continuation moves.
    // Primary: continuationArr (already UCI LAN).
    // Fallback: parse PV from the debug string — e.g.
    //   "info depth 10 ... pv e7e5 g1f3 b8c6 ..."
    //   The PV includes the best move itself as the first token, so skip it.
    let continuation: string[] = Array.isArray(best.continuationArr) ? best.continuationArr : [];

    if (continuation.length === 0 && best.debug) {
      const pvMatch = best.debug.match(/\bpv\s+(\S.*)/);
      if (pvMatch) {
        // PV starts with the best move (same as best.lan) — skip it.
        const pvMoves = pvMatch[1].trim().split(/\s+/);
        continuation = pvMoves.slice(1); // drop the first (best move itself)
      }
    }

    // Build top-lines.
    const lineStrs: string[] = [];

    const evalStr =
      best.mate != null
        ? `mate ${best.mate}`
        : typeof best.eval === 'number'
          ? `eval ${best.eval}`
          : best.centipawns
            ? `cp ${best.centipawns}`
            : null;

    const bestLabel = best.san || best.lan || best.move;
    if (bestLabel) {
      lineStrs.push(`1. ${bestLabel}${evalStr ? ` (${evalStr})` : ''}`);
    }

    // Lines 2–3 from the continuation (opponent reply, engine reply).
    continuation.slice(0, 2).forEach((lan, i) => {
      lineStrs.push(`${i + 2}. ${lan}`);
    });

    if (lineStrs.length > 0) {
      parts.push(`Top lines: ${lineStrs.join(' | ')}`);
    }

    return parts.join(' | ');
  }
}

export function getChessEngineService(): ChessEngineService {
  return ChessEngineService.getInstance();
}

export function resetChessEngineService(): void {
  ChessEngineService.resetInstance();
}
