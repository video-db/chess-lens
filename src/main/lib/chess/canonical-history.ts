import { fenDiffToSan, parseBoardOnlyFen } from './chess-notation';
import { logger } from '../logger';

const log = logger.child({ module: 'canonical-history' });

export const INITIAL_CHESS_BOARD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

const CANONICAL_LOOKBACK_DEPTH = 3;

export interface CanonicalHistoryEntry {
  board: string;
  fen?: string;
  san?: string;
  turn?: 'w' | 'b';
  suspect?: boolean;
  winChance?: number;
  moveSan?: string;
}

export interface CanonicalHistoryState {
  canonicalMoveHistory: CanonicalHistoryEntry[];
  pendingCanonicalEntry: CanonicalHistoryEntry | null;
  prevPendingCanonicalEntry: CanonicalHistoryEntry | null;
}

export interface CanonicalHistoryResult {
  history: CanonicalHistoryEntry[];
  resolvedSan?: string;
  resolvedTurn?: 'w' | 'b';
}

export function updateCanonicalHistoryState(
  state: CanonicalHistoryState,
  board: string,
  fen?: string,
): CanonicalHistoryResult {
  const committed = state.canonicalMoveHistory;
  const pending = state.pendingCanonicalEntry;
  const prevPending = state.prevPendingCanonicalEntry;

  if (pending && pending.board === board) {
    return { history: committed };
  }

  let revertIdx = -1;
  for (let i = committed.length - 1; i >= 0; i--) {
    if (committed[i].board === board) {
      revertIdx = i;
      break;
    }
  }
  if (revertIdx !== -1) {
    state.canonicalMoveHistory = committed.slice(0, revertIdx + 1);
    state.pendingCanonicalEntry = null;
    state.prevPendingCanonicalEntry = null;
    log.debug(
      { board: board.slice(0, 24), revertIdx, droppedPending: !!pending },
      '[CanonicalHistory] Reverted to earlier committed position',
    );
    return { history: state.canonicalMoveHistory };
  }

  const committedTail = committed[committed.length - 1] ?? null;

  const fromPending = pending ? tryInferSanForHistory(pending.board, board) : null;
  if (fromPending) {
    const suspectOK = !pending!.suspect || !committedTail
      || (board !== committedTail.board
        && opponentCountsOK(committedTail.board, board, fromPending.turn));
    if (suspectOK) {
      committed.push(pending!);
      log.debug(
        { committed: pending!.board.slice(0, 24), san: pending!.san, newPending: board.slice(0, 24) },
        '[CanonicalHistory] Confirmed - committed pending entry',
      );
      const newSuspect = !!pending!.turn && fromPending.turn === pending!.turn;
      state.prevPendingCanonicalEntry = null;
      state.pendingCanonicalEntry = {
        board,
        fen,
        san: fromPending.san,
        turn: fromPending.turn,
        suspect: newSuspect || undefined,
      };
      return { history: committed, resolvedSan: pending!.san, resolvedTurn: pending!.turn };
    }
    log.debug(
      { suspect: pending!.board.slice(0, 24), san: pending!.san },
      '[CanonicalHistory] Suspect pending failed committedTail check - routing to REPLACE',
    );
  }

  const fromPrevPending = (prevPending && prevPending.board !== pending?.board)
    ? tryInferSanForHistory(prevPending.board, board)
    : null;
  if (fromPrevPending) {
    committed.push(prevPending!);
    log.debug(
      {
        recovered: prevPending!.board.slice(0, 24),
        san: prevPending!.san,
        droppedHallucination: pending?.board.slice(0, 24),
        newPending: board.slice(0, 24),
      },
      '[CanonicalHistory] PrevRecover - committed prev-pending, discarded hallucination',
    );
    state.prevPendingCanonicalEntry = null;
    state.pendingCanonicalEntry = { board, fen, san: fromPrevPending.san, turn: fromPrevPending.turn };
    return { history: committed, resolvedSan: prevPending!.san, resolvedTurn: prevPending!.turn };
  }

  const fromCommittedTail = committedTail
    ? tryInferSanForHistory(committedTail.board, board)
    : null;

  let fromLookback: { san: string; turn: 'w' | 'b' } | null = null;
  let lookbackIdx = -1;
  if (!fromCommittedTail && committed.length >= 2) {
    const depth = Math.min(CANONICAL_LOOKBACK_DEPTH, committed.length - 1);
    for (let i = committed.length - 2; i >= committed.length - 1 - depth; i--) {
      const r = tryInferSanForHistory(committed[i].board, board);
      if (r) {
        fromLookback = r;
        lookbackIdx = i;
        break;
      }
    }
  }

  const fromStart = (!pending && !committedTail && board !== INITIAL_CHESS_BOARD)
    ? tryInferSanForHistory(INITIAL_CHESS_BOARD, board)
    : null;

  const connectsToCommitted = fromCommittedTail ?? fromLookback ?? fromStart;

  if (connectsToCommitted) {
    if (lookbackIdx !== -1) {
      state.canonicalMoveHistory = committed.slice(0, lookbackIdx + 1);
      log.debug(
        { lookbackIdx, prunedEntries: committed.length - lookbackIdx - 1 },
        '[CanonicalHistory] Replace+prune via lookback',
      );
    } else {
      log.debug(
        { droppedPending: pending?.board.slice(0, 24) },
        '[CanonicalHistory] Replaced hallucinated pending entry',
      );
    }
    const suspect = !!committedTail?.turn && connectsToCommitted.turn === committedTail.turn;
    state.prevPendingCanonicalEntry = pending;
    state.pendingCanonicalEntry = {
      board,
      fen,
      san: connectsToCommitted.san,
      turn: connectsToCommitted.turn,
      suspect: suspect || undefined,
    };
    return { history: state.canonicalMoveHistory };
  }

  log.debug(
    { droppedPending: pending?.board.slice(0, 24), orphan: board.slice(0, 24) },
    '[CanonicalHistory] Discard - unconnected board replaces pending without committing it',
  );
  state.prevPendingCanonicalEntry = pending;
  state.pendingCanonicalEntry = { board, fen, san: undefined, turn: undefined };
  return { history: committed };
}

export function tryInferSanForHistory(
  fromBoard: string,
  toBoard: string,
): { san: string; turn: 'w' | 'b' } | null {
  if (!fromBoard || !toBoard || fromBoard === toBoard) return null;

  const whiteSan = fenDiffToSan(`${fromBoard} w - - 0 1`, `${toBoard} w - - 0 1`, 'w');
  const blackSan = fenDiffToSan(`${fromBoard} b - - 0 1`, `${toBoard} b - - 0 1`, 'b');

  if (whiteSan && blackSan) return null;

  if (whiteSan && opponentCountsOK(fromBoard, toBoard, 'w')) return { san: whiteSan, turn: 'w' };
  if (blackSan && opponentCountsOK(fromBoard, toBoard, 'b')) return { san: blackSan, turn: 'b' };
  return null;
}

export function opponentCountsOK(fromBoard: string, toBoard: string, side: 'w' | 'b'): boolean {
  const from = parseBoardOnlyFen(fromBoard);
  const to = parseBoardOnlyFen(toBoard);
  const isOpp = (p: string) => side === 'w' ? p === p.toLowerCase() : p === p.toUpperCase();

  const fromCounts = new Map<string, number>();
  const toCounts = new Map<string, number>();
  for (const [, p] of from) if (isOpp(p)) fromCounts.set(p, (fromCounts.get(p) ?? 0) + 1);
  for (const [, p] of to) if (isOpp(p)) toCounts.set(p, (toCounts.get(p) ?? 0) + 1);
  for (const [p, toCount] of toCounts) {
    if (toCount > (fromCounts.get(p) ?? 0)) return false;
  }

  const fromTotal = [...fromCounts.values()].reduce((a, b) => a + b, 0);
  const toTotal = [...toCounts.values()].reduce((a, b) => a + b, 0);

  if (fromTotal - toTotal > 1) return false;

  if (fromTotal === toTotal) {
    for (const [sq, fp] of from) {
      if (!isOpp(fp)) continue;
      if (to.get(sq) !== fp) return false;
    }
  }

  return true;
}

export function getCanonicalMoveHistorySnapshot(
  history: CanonicalHistoryEntry[],
): Array<{ no: number; white?: string; black?: string }> {
  const rows: Array<{ no: number; white?: string; black?: string }> = [];
  for (const entry of history) {
    if (!entry.san) continue;
    if (entry.turn === 'w') {
      rows.push({ no: rows.length + 1, white: entry.san });
    } else if (entry.turn === 'b') {
      const last = rows[rows.length - 1];
      if (last && last.white !== undefined && last.black === undefined) {
        last.black = entry.san;
      } else {
        rows.push({ no: rows.length + 1, black: entry.san });
      }
    } else {
      const last = rows[rows.length - 1];
      if (last && last.white !== undefined && last.black === undefined) {
        last.black = entry.san;
      } else {
        rows.push({ no: rows.length + 1, white: entry.san });
      }
    }
  }
  return rows;
}
