import { createPokerEngine } from '../engine-factory';
import { Player } from '../../../types/poker';

const P = (id: string, pos: number): Player => ({
  id,
  name: id,
  position: pos,
  stack: 500,
  currentBet: 0,
  hasActed: false,
  isFolded: false,
  isAllIn: false,
  timeBank: 30000,
});

it('does not carry a hi-lo result into the next hand', () => {
  const engine = createPokerEngine({
    tableId: 'hi-lo-reset',
    players: [P('a', 0), P('b', 1), P('c', 2)],
    smallBlind: 1,
    bigBlind: 2,
    state: { variant: 'omaha-hi-lo' },
  });
  engine.startNewHand();
  const state = (engine as any).state;
  state.stage = 'showdown';
  state.lastHiLoResult = { high: [{ playerId: 'a', amount: 3 }], low: null };

  engine.startNewHand();

  expect(state.lastHiLoResult).toBeUndefined();
});
