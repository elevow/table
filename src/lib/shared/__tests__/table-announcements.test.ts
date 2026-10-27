import {
  buildAnnouncements,
  describeAction,
  describeCard,
  mergeAnnouncements,
  snapshotFromState,
  type AnnounceContext,
} from '../table-announcements';

const names: Record<string, string> = { me: 'Me', bob: 'Bob', amy: 'Amy' };
const ctx: AnnounceContext = {
  viewerId: 'me',
  nameOf: id => names[id] || id,
  formatAmount: n => `$${n}`,
};

const state = (over: Record<string, any> = {}) => ({
  handId: 'h1',
  stage: 'preflop',
  activePlayer: 'bob',
  turnSeq: 1,
  currentBet: 2,
  communityCards: [],
  handActions: [
    { playerId: 'amy', action: 'small-blind', put: 1, stage: 'preflop' },
    { playerId: 'bob', action: 'big-blind', put: 2, stage: 'preflop' },
  ],
  players: [
    { id: 'me', currentBet: 0, holeCards: [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'hearts' }] },
    { id: 'bob', currentBet: 2 },
    { id: 'amy', currentBet: 1 },
  ],
  ...over,
});

const run = (prev: any, next: any) =>
  buildAnnouncements(snapshotFromState(prev, 'me'), snapshotFromState(next, 'me')!, ctx);

describe('describeCard', () => {
  it('names face cards and suits', () => {
    expect(describeCard({ rank: 'A', suit: 'hearts' })).toBe('Ace of hearts');
    expect(describeCard({ rank: '10', suit: 'clubs' })).toBe('10 of clubs');
    expect(describeCard({ rank: 'Q', suit: 'spades' })).toBe('Queen of spades');
  });
});

describe('describeAction', () => {
  const fmt = (n: number) => `$${n}`;
  it('describes each action', () => {
    expect(describeAction({ playerId: 'b', action: 'fold' }, 'Bob', fmt)).toBe('Bob folds');
    expect(describeAction({ playerId: 'b', action: 'check' }, 'Bob', fmt)).toBe('Bob checks');
    expect(describeAction({ playerId: 'b', action: 'call', put: 20, amount: 40 }, 'Bob', fmt)).toBe('Bob calls $20');
    expect(describeAction({ playerId: 'b', action: 'bet', put: 30, amount: 30 }, 'Bob', fmt)).toBe('Bob bets $30');
    expect(describeAction({ playerId: 'b', action: 'raise', put: 38, amount: 40 }, 'Bob', fmt)).toBe('Bob raises to $40');
    expect(describeAction({ playerId: 'b', action: 'big-blind', put: 2 }, 'Bob', fmt)).toBe('Bob posts the big blind, $2');
    expect(describeAction({ playerId: 'b', action: 'ante', put: 1 }, 'Bob', fmt)).toBe('Bob antes $1');
    expect(describeAction({ playerId: 'b', action: 'mystery' }, 'Bob', fmt)).toBeNull();
  });

  it('says when the clock acted', () => {
    expect(describeAction({ playerId: 'b', action: 'fold', auto: true }, 'Bob', fmt)).toBe('Bob folds (out of time)');
  });
});

describe('buildAnnouncements', () => {
  it('announces nothing the first time, so joining mid-hand stays quiet', () => {
    expect(run(null, state()).messages).toEqual([]);
  });

  it('announces other players\' actions', () => {
    const prev = state();
    const next = state({
      handActions: [...prev.handActions, { playerId: 'amy', action: 'raise', amount: 6, put: 5, stage: 'preflop' }],
      activePlayer: 'bob',
      turnSeq: 2,
    });
    expect(run(prev, next).messages).toEqual(['Amy raises to $6']);
  });

  it('skips the viewer\'s own actions', () => {
    const prev = state({ activePlayer: 'me' });
    const next = state({
      activePlayer: 'bob',
      turnSeq: 2,
      handActions: [...prev.handActions, { playerId: 'me', action: 'call', put: 2, stage: 'preflop' }],
    });
    expect(run(prev, next).messages).toEqual([]);
  });

  it('announces your turn with the amount to call, once', () => {
    const prev = state();
    const next = state({
      activePlayer: 'me',
      turnSeq: 2,
      handActions: [...prev.handActions, { playerId: 'bob', action: 'raise', amount: 8, put: 6, stage: 'preflop' }],
      currentBet: 8,
    });
    expect(run(prev, next).messages).toEqual(['Bob raises to $8', 'Your turn. $8 to call']);
    // The same state arriving again (polling, a second broadcast) says nothing
    expect(run(next, { ...next }).messages).toEqual([]);
  });

  it('tells a short stack what calling all-in actually costs', () => {
    const prev = state();
    const next = state({
      activePlayer: 'me',
      turnSeq: 2,
      currentBet: 200,
      players: [
        { id: 'me', currentBet: 0, stack: 50, holeCards: [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'hearts' }] },
        { id: 'bob', currentBet: 200 },
      ],
    });
    expect(run(prev, next).messages).toContain('Your turn. $50 to call');
  });

  it('offers a check when nothing is owed', () => {
    const prev = state({ stage: 'flop', currentBet: 0, communityCards: [{ rank: '2', suit: 'clubs' }, { rank: '7', suit: 'hearts' }, { rank: 'J', suit: 'spades' }] });
    const next = { ...prev, activePlayer: 'me', turnSeq: 5 };
    expect(run(prev, next).messages).toEqual(['Your turn. You can check']);
  });

  it('reads new board cards by street', () => {
    const flop = [{ rank: 'A', suit: 'hearts' }, { rank: '7', suit: 'clubs' }, { rank: '2', suit: 'diamonds' }];
    const prev = state({ activePlayer: 'amy' });
    expect(run(prev, state({ activePlayer: 'amy', communityCards: flop })).messages)
      .toEqual(['Flop: Ace of hearts, 7 of clubs, 2 of diamonds']);
    const turn = [...flop, { rank: 'K', suit: 'spades' }];
    expect(run(state({ activePlayer: 'amy', communityCards: flop }), state({ activePlayer: 'amy', communityCards: turn })).messages)
      .toEqual(['Turn: King of spades']);
  });

  it('reads a whole all-in runout street by street', () => {
    const board = [
      { rank: 'A', suit: 'hearts' }, { rank: '7', suit: 'clubs' }, { rank: '2', suit: 'diamonds' },
      { rank: 'K', suit: 'spades' }, { rank: '9', suit: 'hearts' },
    ];
    const prev = state({ activePlayer: '' });
    const next = state({ activePlayer: '', communityCards: board, stage: 'showdown' });
    expect(run(prev, next).messages).toEqual([
      'Flop: Ace of hearts, 7 of clubs, 2 of diamonds',
      'Turn: King of spades',
      'River: 9 of hearts',
    ]);
  });

  it('announces the winners once', () => {
    const prev = state({ activePlayer: 'bob' });
    const next = state({ stage: 'showdown', activePlayer: '', handResult: { pot: 40, winnings: { bob: 30, me: 10, amy: 0 } } });
    expect(run(prev, next).messages).toEqual(['Bob wins $30', 'You win $10']);
    expect(run(next, { ...next }).messages).toEqual([]);
  });

  it('starts a new hand with your cards and the blinds', () => {
    const prev = state({ stage: 'showdown', activePlayer: '', handResult: { pot: 4, winnings: { bob: 4 } } });
    const next = state({
      handId: 'h2',
      players: [
        { id: 'me', currentBet: 2, holeCards: [{ rank: '9', suit: 'clubs' }, { rank: '9', suit: 'diamonds' }] },
        { id: 'bob', currentBet: 1 },
      ],
      handActions: [
        { playerId: 'bob', action: 'small-blind', put: 1, stage: 'preflop' },
        { playerId: 'me', action: 'big-blind', put: 2, stage: 'preflop' },
      ],
    });
    expect(run(prev, next).messages).toEqual([
      'New hand',
      'Your cards: 9 of clubs, 9 of diamonds',
      'Bob posts the small blind, $1',
    ]);
  });

  it('does not re-read your cards when a broadcast leaves them out for a moment', () => {
    const withCards = state();
    const withoutCards = state({ players: [{ id: 'me', currentBet: 0 }, { id: 'bob', currentBet: 2 }] });
    const first = buildAnnouncements(snapshotFromState(withCards, 'me'), snapshotFromState(withoutCards, 'me')!, ctx);
    expect(first.messages).toEqual([]);
    const second = buildAnnouncements(first.baseline, snapshotFromState(withCards, 'me')!, ctx);
    expect(second.messages).toEqual([]);
  });

  it('reads only the new stud card', () => {
    const stud = (down: any[], up: any[]) => state({
      players: [{ id: 'me', currentBet: 0 }, { id: 'bob', currentBet: 0 }],
      studState: { playerCards: { me: { downCards: down, upCards: up }, bob: { downCards: [], upCards: [{ rank: '3', suit: 'clubs' }] } } },
      activePlayer: 'bob',
    });
    const down = [{ rank: '2', suit: 'clubs' }, { rank: '3', suit: 'hearts' }];
    const prev = stud(down, [{ rank: '4', suit: 'spades' }]);
    const next = stud(down, [{ rank: '4', suit: 'spades' }, { rank: 'J', suit: 'diamonds' }]);
    expect(run(prev, next).messages).toEqual(['Your new card: Jack of diamonds']);
  });

  it('never mentions other players\' cards', () => {
    const prev = state({ activePlayer: 'amy' });
    const next = state({
      activePlayer: 'amy',
      players: [...prev.players.slice(0, 1), { id: 'bob', currentBet: 2, holeCards: [{ rank: 'Q', suit: 'clubs' }, { rank: 'Q', suit: 'hearts' }] }],
    });
    const text = run(prev, next).messages.join(' ');
    expect(text).not.toMatch(/Queen/);
  });

  it('treats a shrinking log as a new hand when there are no hand ids', () => {
    const prev = state({ handId: undefined, activePlayer: 'amy' });
    const next = state({ handId: undefined, activePlayer: 'amy', handActions: [{ playerId: 'amy', action: 'small-blind', put: 1, stage: 'preflop' }] });
    expect(run(prev, next).messages).toEqual(['New hand', 'Your cards: Ace of spades, King of hearts', 'Amy posts the small blind, $1']);
  });
});

describe('snapshotFromState', () => {
  it('returns null without a state', () => {
    expect(snapshotFromState(null, 'me')).toBeNull();
  });

  it('falls back to the hand number for identity', () => {
    expect(snapshotFromState({ handNumber: 4 }, 'me')!.handKey).toBe('#4');
    expect(snapshotFromState({}, 'me')!.handKey).toBeNull();
  });
});

describe('mergeAnnouncements', () => {
  it('joins messages as sentences', () => {
    expect(mergeAnnouncements(['Bob folds', 'Your turn. You can check', ' ', 'Done!'])).toBe('Bob folds. Your turn. You can check. Done!');
  });
});
