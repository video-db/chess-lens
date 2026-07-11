import type { CanonicalHistoryEntry } from '../../../lib/chess/canonical-history';

export interface WinProbabilityPoint {
  winChance: number;
  turn: 'w' | 'b';
  moveIndex: number;
  moveSan?: string;
}

export interface WinChanceStampResult {
  stamped: boolean;
  slot?: 'committed' | 'pending' | 'pending-via-lastBoard';
  entryIdx?: number;
  moveSan?: string;
}

export function buildWinProbabilitySnapshot(
  canonicalMoveHistory: CanonicalHistoryEntry[],
  pendingCanonicalEntry: CanonicalHistoryEntry | null,
): WinProbabilityPoint[] {
  const points: WinProbabilityPoint[] = [];

  for (let i = 0; i < canonicalMoveHistory.length; i += 1) {
    const entry = canonicalMoveHistory[i];
    if (typeof entry?.winChance === 'number' && entry.turn) {
      points.push({
        winChance: entry.winChance,
        turn: entry.turn,
        moveIndex: i,
        moveSan: entry.moveSan,
      });
    }
  }

  if (pendingCanonicalEntry && typeof pendingCanonicalEntry.winChance === 'number' && pendingCanonicalEntry.turn) {
    points.push({
      winChance: pendingCanonicalEntry.winChance,
      turn: pendingCanonicalEntry.turn,
      moveIndex: canonicalMoveHistory.length,
      moveSan: pendingCanonicalEntry.moveSan,
    });
  }

  return points;
}

export function stampWinChanceAtStage1(params: {
  canonicalMoveHistory: CanonicalHistoryEntry[];
  pendingCanonicalEntry: CanonicalHistoryEntry | null;
  lastChessBoard: string | null;
  board: string;
  winChance: number | undefined;
  turn: 'w' | 'b' | undefined;
  moveSan: string | undefined;
}): WinChanceStampResult {
  const {
    canonicalMoveHistory,
    pendingCanonicalEntry,
    lastChessBoard,
    board,
    winChance,
    turn,
    moveSan,
  } = params;

  if (!board || typeof winChance !== 'number' || !turn) {
    return { stamped: false };
  }

  for (let i = canonicalMoveHistory.length - 1; i >= 0; i -= 1) {
    const entry = canonicalMoveHistory[i];
    if (entry?.board !== board) continue;

    entry.winChance = winChance;
    if (moveSan) entry.moveSan = moveSan;
    return { stamped: true, slot: 'committed', entryIdx: i, moveSan: entry.moveSan };
  }

  if (pendingCanonicalEntry?.board === board) {
    pendingCanonicalEntry.winChance = winChance;
    if (moveSan) pendingCanonicalEntry.moveSan = moveSan;
    return { stamped: true, slot: 'pending', moveSan: pendingCanonicalEntry.moveSan };
  }

  if (pendingCanonicalEntry && lastChessBoard === board) {
    pendingCanonicalEntry.winChance = winChance;
    if (moveSan) pendingCanonicalEntry.moveSan = moveSan;
    return { stamped: true, slot: 'pending-via-lastBoard', moveSan: pendingCanonicalEntry.moveSan };
  }

  return { stamped: false };
}
