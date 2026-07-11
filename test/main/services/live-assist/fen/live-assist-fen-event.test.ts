import { describe, expect, it } from 'vitest';
import { buildLiveAssistFenEvent } from '../../../../../src/main/services/live-assist/fen/live-assist-fen-event';

describe('live assist FEN event builder', () => {
  it('builds white-perspective payloads with engine and chart fields', () => {
    const event = buildLiveAssistFenEvent({
      fen: '8/8/8/8/8/8/8/8 w - - 0 1',
      board: '8/8/8/8/8/8/8/8',
      turn: 'w',
      boardOrientation: 'white',
      engine: { engineSan: 'e4', engineEval: 0.2 },
      winProbabilitySnapshot: [{ winChance: 55, turn: 'w', moveIndex: 1, moveSan: 'e4' }],
      extras: { isFlipAck: true },
    });

    expect(event.displayFen).toBe(event.fen);
    expect(event.engineSan).toBe('e4');
    expect(event.engineEval).toBe(0.2);
    expect(event.isFlipAck).toBe(true);
    expect(event.winProbabilitySnapshot).toHaveLength(1);
  });

  it('flips board display for black orientation while preserving engine FEN', () => {
    const event = buildLiveAssistFenEvent({
      fen: '8/8/8/8/4P3/8/8/8 b - - 0 1',
      board: '8/8/8/8/4P3/8/8/8',
      turn: 'b',
      boardOrientation: 'black',
    });

    expect(event.fen).toBe('8/8/8/8/4P3/8/8/8 b - - 0 1');
    expect(event.displayFen).toBe('8/8/8/3P4/8/8/8/8 b - - 0 1');
  });
});
