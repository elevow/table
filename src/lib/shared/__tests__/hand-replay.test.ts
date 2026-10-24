import { buildReplayFrames, describeAction } from '../hand-replay';
import type { HandRecord } from '../../../types/hand-record';

const hand: HandRecord = {
  id: 'h1',
  roomId: 'r1',
  handNumber: 4,
  variant: 'texas-holdem',
  kind: 'normal',
  smallBlind: 5,
  bigBlind: 10,
  startedAt: null,
  endedAt: '2026-10-23T00:00:00.000Z',
  board: [
    { rank: '2', suit: 'clubs' }, { rank: '7', suit: 'spades' }, { rank: '9', suit: 'diamonds' },
    { rank: 'J', suit: 'clubs' }, { rank: '3', suit: 'hearts' },
  ],
  players: [
    { id: 'a', name: 'Ann', seat: 1, startStack: 100, endStack: 130, net: 30, won: 60, folded: false, revealed: true },
    { id: 'b', name: 'Bob', seat: 2, startStack: 100, endStack: 70, net: -30, won: 0, folded: false, revealed: false },
  ],
  actions: [
    { playerId: 'a', action: 'small-blind', amount: 5, put: 5, stage: 'preflop' },
    { playerId: 'b', action: 'big-blind', amount: 10, put: 10, stage: 'preflop' },
    { playerId: 'a', action: 'call', amount: 10, put: 5, stage: 'preflop' },
    { playerId: 'b', action: 'check', put: 0, stage: 'preflop' },
    { playerId: 'b', action: 'bet', amount: 20, put: 20, stage: 'flop' },
    { playerId: 'a', action: 'call', amount: 20, put: 20, stage: 'flop', auto: false },
  ],
  winners: [{ playerId: 'a', amount: 60 }],
  pot: 60,
};

describe('buildReplayFrames', () => {
  const frames = buildReplayFrames(hand);

  it('has the deal, one frame per action and the result', () => {
    expect(frames).toHaveLength(hand.actions.length + 2);
    expect(frames[0].caption).toBe('Hand #4 is dealt');
    expect(frames[frames.length - 1].caption).toBe('Ann wins $60');
  });

  it('moves chips from stacks to the pot as players act', () => {
    const afterFlopBet = frames[5];
    expect(afterFlopBet.pot).toBe(40);
    expect(afterFlopBet.stacks).toEqual({ a: 90, b: 70 });
    expect(afterFlopBet.boardCount).toBe(3);
    expect(afterFlopBet.caption).toBe('Bob bets $20');
  });

  it('shows the whole board and final stacks on the result', () => {
    const last = frames[frames.length - 1];
    expect(last.boardCount).toBe(5);
    expect(last.stacks).toEqual({ a: 130, b: 70 });
    expect(last.pot).toBe(0);
  });

  it('clears each street\'s actions when the next street starts', () => {
    expect(frames[5].lastAction.a).toBeUndefined();
    expect(frames[5].lastAction.b?.action).toBe('bet');
  });
});

describe('describeAction', () => {
  it('describes raises by their total and marks timed-out actions', () => {
    const money = (n: number) => `$${n}`;
    expect(describeAction({ playerId: 'a', action: 'raise', amount: 60, put: 50, stage: 'flop' }, 'Ann', money)).toBe('Ann raises to $60');
    expect(describeAction({ playerId: 'a', action: 'fold', put: 0, stage: 'flop', auto: true }, 'Ann', money)).toBe('Ann folds (timed out)');
  });
});
