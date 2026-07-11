import { describe, expect, it } from 'vitest';
import { emptyEngineState, engineStateFromContext } from '../../../../../src/main/services/live-assist/engine/live-assist-engine-state';

describe('live assist engine state', () => {
  it('copies engine fields from a chess context-shaped object', () => {
    expect(engineStateFromContext({
      engineSan: 'Nf3',
      engineLan: 'g1f3',
      engineFrom: 'g1',
      engineTo: 'f3',
      engineEval: 0.34,
      engineMate: null,
    })).toEqual({
      engineSan: 'Nf3',
      engineLan: 'g1f3',
      engineFrom: 'g1',
      engineTo: 'f3',
      engineEval: 0.34,
      engineMate: null,
    });
  });

  it('returns an explicit empty state', () => {
    expect(emptyEngineState()).toEqual({
      engineSan: undefined,
      engineLan: undefined,
      engineFrom: undefined,
      engineTo: undefined,
      engineEval: undefined,
      engineMate: undefined,
    });
  });
});

