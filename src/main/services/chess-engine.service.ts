import { logger } from '../lib/logger';
import { loadRuntimeConfig } from '../lib/config';

const log = logger.child({ module: 'chess-engine-service' });
const DEFAULT_CHESS_ENGINE_API_URL = 'https://chess-api.com/v1';

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
}

export interface ChessEngineResponse extends ChessEngineMoveLine {
  fen?: string;
  text?: string;
  depth?: number;
  winChance?: number;
  taskId?: string;
  time?: number;
  type?: string;
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
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        log.warn({ status: response.status }, 'Chess engine HTTP error');
        return null;
      }

      const data = (await response.json()) as ChessEngineResponse;
      console.log('[ChessEngineService] Received response:', data);
      return data;
    } catch (error) {
      log.warn({ error }, 'Chess engine request failed');
      return null;
    }
  }

  summarize(result: ChessEngineResponse): string {
    const lines = [
      result.text,
      result.san ? `Best move SAN: ${result.san}` : '',
      result.lan ? `Best move LAN: ${result.lan}` : '',
      typeof result.eval === 'number' ? `Eval: ${result.eval}` : '',
      result.mate != null ? `Mate: ${result.mate}` : '',
    ].filter(Boolean) as string[];

    const topLines = (result.variants || result.moves || [])
      .slice(0, 5)
      .map((v, idx) => {
        const mv = v.san || v.lan || v.move || 'unknown';
        const score = typeof v.eval === 'number' ? `eval ${v.eval}` : (v.centipawns ? `cp ${v.centipawns}` : 'eval n/a');
        return `${idx + 1}. ${mv} (${score})`;
      });

    if (topLines.length > 0) {
      lines.push(`Top lines: ${topLines.join(' | ')}`);
    }

    return lines.join('\n');
  }
  
}

export function getChessEngineService(): ChessEngineService {
  return ChessEngineService.getInstance();
}

export function resetChessEngineService(): void {
  ChessEngineService.resetInstance();
}
