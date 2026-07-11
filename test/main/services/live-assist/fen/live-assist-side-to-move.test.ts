import { describe, expect, it } from 'vitest';
import { resolveLiveAssistTurnContext } from '../../../../../src/main/services/live-assist/fen/live-assist-side-to-move';

describe('live assist side-to-move context', () => {
  it('marks a white-oriented player turn after black has moved', () => {
    expect(resolveLiveAssistTurnContext({
      perspective: 'white',
      justMoved: 'b',
    })).toMatchObject({
      playerColor: 'w',
      sideToMove: 'w',
      isPlayerTurn: true,
      playerColorLabel: 'White',
      opponentColorLabel: 'Black',
    });
  });

  it('marks a black-oriented opponent turn after black has moved', () => {
    expect(resolveLiveAssistTurnContext({
      perspective: 'black',
      justMoved: 'b',
    })).toMatchObject({
      playerColor: 'b',
      sideToMove: 'w',
      isPlayerTurn: false,
      playerColorLabel: 'Black',
      opponentColorLabel: 'White',
    });
  });

  it('falls back to the player color when the last mover is unknown', () => {
    expect(resolveLiveAssistTurnContext({
      perspective: 'black',
      justMoved: null,
    })).toMatchObject({
      playerColor: 'b',
      justMoved: 'b',
      sideToMove: 'w',
      sideToMoveLabel: 'White',
      justMovedLabel: 'Black',
    });
  });
});
