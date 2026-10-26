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

describe('buildReplayFrames with antes and a 7-2 bounty', () => {
  const bountyHand: HandRecord = {
    ...hand,
    players: [
      { ...hand.players[0], endStack: 135, net: 35 },
      { ...hand.players[1], endStack: 65, net: -35 },
    ],
    actions: [
      { playerId: 'a', action: 'ante', put: 1, stage: 'preflop' },
      { playerId: 'b', action: 'ante', put: 1, stage: 'preflop' },
      ...hand.actions,
      { playerId: 'b', action: 'bounty', put: 5, stage: 'showdown', toPlayerId: 'a' },
    ],
  };
  const frames = buildReplayFrames(bountyHand);

  it('antes go into the pot', () => {
    expect(frames[2].pot).toBe(2);
    expect(frames[2].caption).toBe('Bob antes $1');
  });

  it('a bounty moves chips between players, not into the pot, with the whole board showing', () => {
    const bounty = frames[frames.length - 2];
    expect(bounty.caption).toBe('Bob pays a 7-2 bounty of $5 to Ann');
    expect(bounty.pot).toBe(frames[frames.length - 3].pot);
    expect(bounty.stacks.a - frames[frames.length - 3].stacks.a).toBe(5);
    expect(bounty.boardCount).toBe(5);
    expect(frames[frames.length - 1].caption).toBe('Ann wins $60; Ann collects a $5 7-2 bounty');
  });

  it('describes a bounty without a recipient name', () => {
    expect(describeAction({ playerId: 'b', action: 'bounty', put: 5, stage: 'showdown' }, 'Bob', n => `$${n}`)).toBe('Bob pays a 7-2 bounty of $5');
  });
});

describe('describeAction', () => {
  it('describes raises by their total and marks timed-out actions', () => {
    const money = (n: number) => `$${n}`;
    expect(describeAction({ playerId: 'a', action: 'raise', amount: 60, put: 50, stage: 'flop' }, 'Ann', money)).toBe('Ann raises to $60');
    expect(describeAction({ playerId: 'a', action: 'fold', put: 0, stage: 'flop', auto: true }, 'Ann', money)).toBe('Ann folds (timed out)');
  });
});
