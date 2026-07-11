import type { ProbingQuestion } from '../../../shared/types/meeting-setup.types';
import type { SupportedGameId } from '../../../shared/config/game-coaching';

export interface MeetingContext {
  name?: string;
  description?: string;
  gameId?: SupportedGameId;
  coachPersonalityId?: string;
  questions?: ProbingQuestion[];
  checklist?: string[];
}

export interface TranscriptChunk {
  text: string;
  source: 'mic' | 'system_audio';
  timestamp: number;
}

export interface PositionEntry {
  fen: string;
  board: string;
  frameCount: number;
  status: 'provisional' | 'confirmed' | 'reverted';
  san?: string;
}

export interface VisualIndexChunk {
  text: string;
  timestamp: number;
}

export interface ChessContextData {
  fen: string;
  engineSummary: string;
  engineSan?: string;
  engineLan?: string;
  engineFrom?: string;
  engineTo?: string;
  engineEval?: number;
  engineMate?: number | null;
  winChance?: number;
  winChanceBefore?: number;
  centipawnLoss?: number;
  playedMoveSan?: string;
  playedMoveUci?: string;
  board?: string;
  turn?: 'w' | 'b';
  terminalState?: 'checkmate' | 'stalemate';
}
