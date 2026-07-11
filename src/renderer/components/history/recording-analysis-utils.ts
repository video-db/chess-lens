import {
  classifyStoredMove,
  KEY_MOMENT_QUALITIES,
  type MoveQuality,
} from '../../../shared/lib/moveClassification';

export interface AnalysisTipBase {
  winChance?: number;
  winChanceBefore?: number;
  turn?: 'w' | 'b';
  centipawnLoss?: number;
  engineEval?: number;
}

export interface KeyMomentTip extends AnalysisTipBase {
  id: string;
  startTime: number;
  tip: string;
}

export type ClassifiedTip<T extends AnalysisTipBase> = T & {
  originalIndex: number;
  quality: MoveQuality;
};

const KEY_MOMENT_IMPACT_RANK: Record<MoveQuality, number> = {
  blunder: 0,
  mistake: 1,
  brilliant: 2,
  great: 3,
  inaccuracy: 4,
  best: 5,
  excellent: 6,
  good: 7,
  book: 8,
};

export const MAX_KEY_MOMENTS = 7;

export function classifyAnalysisTips<T extends AnalysisTipBase>(tips: T[]): Array<ClassifiedTip<T>> {
  return tips.map((tip, originalIndex) => ({
    ...tip,
    originalIndex,
    quality: classifyStoredMove({
      winChance: tip.winChance,
      winChanceBefore: tip.winChanceBefore,
      engineEval: tip.engineEval,
      centipawnLoss: tip.centipawnLoss,
      turn: tip.turn,
    }) as MoveQuality,
  }));
}

export function rankKeyMoments<T extends ClassifiedTip<AnalysisTipBase>>(tips: T[]): T[] {
  const keyMoments = tips.filter((tip) => KEY_MOMENT_QUALITIES.has(tip.quality));

  return keyMoments.length > MAX_KEY_MOMENTS
    ? keyMoments
        .slice()
        .sort((a, b) => {
          const rankDiff = KEY_MOMENT_IMPACT_RANK[a.quality] - KEY_MOMENT_IMPACT_RANK[b.quality];
          return rankDiff !== 0 ? rankDiff : (b.centipawnLoss ?? 0) - (a.centipawnLoss ?? 0);
        })
        .slice(0, MAX_KEY_MOMENTS)
        .sort((a, b) => a.originalIndex - b.originalIndex)
    : keyMoments;
}

export function computeKeyMomentIndices(tips: AnalysisTipBase[]): Set<number> {
  return new Set(rankKeyMoments(classifyAnalysisTips(tips)).map((tip) => tip.originalIndex));
}

export function getDisplayKeyMomentTips<T extends KeyMomentTip>(tips: T[]): Array<ClassifiedTip<T>> {
  const classified = classifyAnalysisTips(tips);
  const cappedKeyMoments = rankKeyMoments(classified);

  return cappedKeyMoments.length > 0
    ? cappedKeyMoments
    : classified
        .filter((tip) => tip.centipawnLoss !== undefined)
        .sort((a, b) => (b.centipawnLoss ?? 0) - (a.centipawnLoss ?? 0))
        .slice(0, 5);
}

export function formatTipTimestamp(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function getMoveNumber(originalIndex: number): number {
  return Math.floor(originalIndex / 2) + 1;
}

export function getMoveLabel(tipText: string): string {
  const moveMatch = tipText.match(/\b([NBRQK]?[a-h]?[1-8]?x?[a-h][1-8](?:=[NBRQ])?[+#]?)\b/);
  return moveMatch ? moveMatch[1]! : '-';
}
