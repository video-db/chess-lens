import { buildDisplayFen } from '../../../lib/chess/live-assist-chess-helpers';
import type { LiveAssistEngineState } from '../engine/live-assist-engine-state';
import type { WinProbabilityPoint } from '../engine/live-assist-win-probability';

export interface LiveAssistFenEvent {
  fen: string;
  displayFen: string;
  board: string | null;
  turn: 'w' | 'b' | null;
  boardOrientation?: 'white' | 'black';
  engineSan?: string;
  engineLan?: string;
  engineFrom?: string;
  engineTo?: string;
  engineEval?: number;
  engineMate?: number | null;
  playedMoveSan?: string;
  playedTurn?: 'w' | 'b';
  moveHistorySnapshot?: Array<{ no: number; white?: string; black?: string }>;
  isFlipAck?: boolean;
  winProbabilitySnapshot?: WinProbabilityPoint[];
}

export function buildLiveAssistFenEvent({
  fen,
  board,
  turn,
  boardOrientation,
  engine,
  winProbabilitySnapshot,
  extras,
}: {
  fen: string;
  board: string | null;
  turn: 'w' | 'b' | null;
  boardOrientation: 'white' | 'black';
  engine?: LiveAssistEngineState;
  winProbabilitySnapshot?: WinProbabilityPoint[];
  extras?: Partial<Omit<LiveAssistFenEvent, 'fen' | 'displayFen' | 'board' | 'turn' | 'boardOrientation'>>;
}): LiveAssistFenEvent {
  return {
    fen,
    displayFen: buildDisplayFen(fen, boardOrientation),
    board,
    turn,
    boardOrientation,
    engineSan: engine?.engineSan,
    engineLan: engine?.engineLan,
    engineFrom: engine?.engineFrom,
    engineTo: engine?.engineTo,
    engineEval: engine?.engineEval,
    engineMate: engine?.engineMate,
    winProbabilitySnapshot,
    ...extras,
  };
}
