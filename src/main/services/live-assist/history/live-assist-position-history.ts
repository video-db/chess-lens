import { fenDiffToSan } from '../../../lib/chess/chess-notation';
import {
  OPENING_HISTORY_MAX_PLIES,
  OSCILLATION_REPEAT_LIMIT,
  POSITION_STABILITY_FRAMES,
} from '../live-assist.constants';
import type { PositionEntry } from '../live-assist.types';

export interface PositionHistoryState {
  positionBuffer: PositionEntry[];
  committedPositionHistory: PositionEntry[];
}

export interface PositionHistoryLogger {
  debug: (data: Record<string, unknown>, message: string) => void;
  warn: (data: Record<string, unknown>, message: string) => void;
}

export function recordPositionForHistory(
  state: PositionHistoryState,
  fen: string,
  san: string | undefined,
  log: PositionHistoryLogger,
): void {
  if (state.committedPositionHistory.length >= OPENING_HISTORY_MAX_PLIES) return;

  const board = fen.split(' ')[0] ?? '';
  const committedIdx = state.committedPositionHistory.findIndex((entry) => entry.board === board);
  if (committedIdx !== -1) {
    if (state.positionBuffer.length > 0) {
      log.debug(
        { board: board.slice(0, 24), committedIdx, dropped: state.positionBuffer.length },
        '[PositionHistory] Revert to committed position - dropping provisional buffer',
      );
      state.positionBuffer = [];
    }
    return;
  }

  const head = state.positionBuffer[state.positionBuffer.length - 1];
  if (head && head.board === board && head.status === 'provisional') {
    head.frameCount += 1;
    if (san && !head.san) head.san = san;

    if (head.frameCount >= POSITION_STABILITY_FRAMES) {
      head.status = 'confirmed';
      state.committedPositionHistory.push({ ...head });
      log.debug(
        { board: board.slice(0, 24), san: head.san, histLen: state.committedPositionHistory.length },
        '[PositionHistory] Position committed after stability window',
      );
      state.positionBuffer = [];
    }
    return;
  }

  const provisionalRepeatCount = state.positionBuffer.filter((entry) => entry.board === board).length;
  if (provisionalRepeatCount >= OSCILLATION_REPEAT_LIMIT) {
    log.debug(
      { board: board.slice(0, 24), repeatCount: provisionalRepeatCount, bufLen: state.positionBuffer.length },
      '[PositionHistory] Oscillation detected - discarding provisional buffer',
    );
    state.positionBuffer = [];
    return;
  }

  const lastCommitted = state.committedPositionHistory[state.committedPositionHistory.length - 1];
  let resolvedSan = san;

  if (lastCommitted) {
    if (!resolvedSan) {
      resolvedSan = tryInferSan(lastCommitted.fen, fen, log) ?? undefined;
    }

    if (!resolvedSan && state.positionBuffer.length > 0) {
      const provisional = state.positionBuffer[state.positionBuffer.length - 1];
      if (provisional && provisional.status === 'provisional') {
        const san1 = tryInferSan(lastCommitted.fen, provisional.fen, log);
        const san2 = tryInferSan(provisional.fen, fen, log);
        if (san1 && san2) {
          provisional.status = 'confirmed';
          provisional.san = san1;
          state.committedPositionHistory.push({ ...provisional });
          state.positionBuffer = [];
          resolvedSan = san2;
          log.debug(
            { san1, san2, histLen: state.committedPositionHistory.length },
            '[PositionHistory] Gap-filled two-ply transition',
          );
        } else {
          log.debug(
            { board: provisional.board.slice(0, 24) },
            '[PositionHistory] Provisional entry discarded (gap-fill failed)',
          );
          state.positionBuffer = [];
        }
      }
    }
  }

  state.positionBuffer.push({
    fen,
    board,
    frameCount: 1,
    status: 'provisional',
    san: resolvedSan,
  });
}

function tryInferSan(
  fromFen: string,
  toFen: string,
  log: PositionHistoryLogger,
): string | null {
  try {
    const fromBoard = fromFen.split(' ')[0] ?? '';
    const toBoard = toFen.split(' ')[0] ?? '';
    if (fromBoard === toBoard) return null;

    const fromTurnField = fromFen.split(' ')[1] as 'w' | 'b' | undefined;
    const turns: ('w' | 'b')[] = fromTurnField
      ? [fromTurnField, fromTurnField === 'w' ? 'b' : 'w']
      : ['w', 'b'];

    for (const turn of turns) {
      const candidate = `${fromBoard} ${turn} - - 0 1`;
      const result = fenDiffToSan(candidate, toFen, turn);
      if (result) return result;
    }
  } catch (err) {
    log.warn({ err }, '[LiveAssist] tryInferSan: unexpected error');
  }
  return null;
}
