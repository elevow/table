// redactHandRecord's module pulls in the database and chat; neither loads under jsdom
jest.mock('pg', () => ({ Pool: jest.fn() }));
jest.mock('../../database/pool', () => ({ getPool: jest.fn() }));
jest.mock('../../utils/post-hand-result', () => ({ postHandResultToChat: jest.fn() }));

import { cardText, formatPokerStarsHand, formatPokerStarsHands, pokerStarsHandNumber } from '../pokerstars-export';
import { redactHandRecord } from '../../server/hand-records';
import type { HandRecord } from '../../../types/hand-record';
import type { Card } from '../../../types/poker';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

const holdem: HandRecord = {
  id: '0000000a-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  roomId: 'room-1',
  handNumber: 4,
  variant: 'texas-holdem',
  kind: 'normal',
  smallBlind: 5,
  bigBlind: 10,
  startedAt: null,
  endedAt: '2026-10-23T16:05:09.000Z',
  board: [c('2', 'clubs'), c('7', 'spades'), c('9', 'diamonds'), c('J', 'clubs'), c('10', 'hearts')],
  players: [
    { id: 'a', name: 'Ann', seat: 1, startStack: 100, endStack: 140, net: 40, won: 80, folded: false, revealed: true, cards: { hole: [c('A', 'hearts'), c('K', 'diamonds')] } },
    { id: 'b', name: 'Bob', seat: 2, startStack: 100, endStack: 60, net: -40, won: 0, folded: false, revealed: false, cards: { hole: [c('Q', 'spades'), c('Q', 'hearts')] } },
    { id: 'c', name: 'Cy', seat: 3, startStack: 200, endStack: 200, net: 0, won: 0, folded: true, revealed: false, cards: { hole: [c('3', 'spades'), c('4', 'spades')] } },
  ],
  actions: [
    { playerId: 'a', action: 'small-blind', amount: 5, put: 5, stage: 'preflop' },
    { playerId: 'b', action: 'big-blind', amount: 10, put: 10, stage: 'preflop' },
    { playerId: 'c', action: 'fold', put: 0, stage: 'preflop' },
    { playerId: 'a', action: 'raise', amount: 30, put: 25, stage: 'preflop' },
    { playerId: 'b', action: 'call', amount: 30, put: 20, stage: 'preflop' },
    { playerId: 'a', action: 'bet', amount: 10, put: 10, stage: 'flop' },
    { playerId: 'b', action: 'call', amount: 10, put: 10, stage: 'flop' },
    { playerId: 'a', action: 'check', put: 0, stage: 'turn' },
    { playerId: 'b', action: 'check', put: 0, stage: 'turn' },
    { playerId: 'a', action: 'check', put: 0, stage: 'river' },
    { playerId: 'b', action: 'check', put: 0, stage: 'river' },
  ],
  winners: [{ playerId: 'a', amount: 80 }],
  pot: 80,
  bettingMode: 'no-limit',
  buttonSeat: 3,
};

describe('cardText', () => {
  it('writes tens as T and suits as one letter', () => {
    expect(cardText(c('10', 'spades'))).toBe('Ts');
    expect(cardText(c('A', 'hearts'))).toBe('Ah');
    expect(cardText(c('2', 'clubs'))).toBe('2c');
  });
});

describe('pokerStarsHandNumber', () => {
  it('derives a unique number from the hand id', () => {
    expect(pokerStarsHandNumber(holdem)).toBe(String(parseInt('0000000abbbb', 16)));
  });
  it('falls back to the table hand number for odd ids', () => {
    expect(pokerStarsHandNumber({ id: 'x', handNumber: 7 })).toBe('7');
  });
});

describe('formatPokerStarsHand (Hold\'em)', () => {
  // Bob is the viewer: he sees his own cards and Ann's, which she showed
  const text = formatPokerStarsHand(redactHandRecord(holdem, 'b'), { viewerId: 'b', tableName: 'Friday Game' });
  const lines = text.split('\n');

  it('writes the header, table and seats', () => {
    expect(lines[0]).toBe(`PokerStars Hand #${pokerStarsHandNumber(holdem)}: Hold'em No Limit ($5/$10 USD) - 2026/10/23 16:05:09 UTC [2026/10/23 12:05:09 ET]`);
    expect(lines[1]).toBe("Table 'Friday Game' 9-max Seat #3 is the button");
    expect(lines.slice(2, 5)).toEqual([
      'Seat 1: Ann ($100 in chips)',
      'Seat 2: Bob ($100 in chips)',
      'Seat 3: Cy ($200 in chips)',
    ]);
  });

  it('writes posts, hole cards and actions with amounts', () => {
    expect(lines.slice(5, 12)).toEqual([
      'Ann: posts small blind $5',
      'Bob: posts big blind $10',
      '*** HOLE CARDS ***',
      'Dealt to Bob [Qs Qh]',
      'Cy: folds',
      'Ann: raises $20 to $30',
      'Bob: calls $20',
    ]);
  });

  it('writes each street with its board', () => {
    expect(text).toContain('*** FLOP *** [2c 7s 9d]\nAnn: bets $10\nBob: calls $10');
    expect(text).toContain('*** TURN *** [2c 7s 9d] [Jc]');
    expect(text).toContain('*** RIVER *** [2c 7s 9d Jc] [Th]');
  });

  it('writes the showdown and summary', () => {
    expect(text).toContain('*** SHOW DOWN ***\nAnn: shows [Ah Kd]\nBob: shows [Qs Qh]\nAnn collected $80 from pot');
    expect(text).toContain('*** SUMMARY ***\nTotal pot $80 | Rake $0\nBoard [2c 7s 9d Jc Th]');
    expect(text).toContain('Seat 1: Ann (small blind) showed [Ah Kd] and won ($80)');
    expect(text).toContain('Seat 2: Bob (big blind) showed [Qs Qh] and lost');
    expect(text).toContain("Seat 3: Cy (button) folded before Flop (didn't bet)");
  });

  it('never prints cards the viewer could not see', () => {
    const asCy = formatPokerStarsHand(redactHandRecord(holdem, 'c'), { viewerId: 'c' });
    expect(asCy).toContain('Dealt to Cy [3s 4s]');
    expect(asCy).not.toContain('Qs');
    expect(asCy).toContain('Bob: mucks hand');
    expect(asCy).toContain('Seat 2: Bob (big blind) mucked');
    expect(asCy).toContain("Table 'room-1'");
  });
});

describe('formatPokerStarsHand with the newer game rules', () => {
  it('leaves 7-2 bounty payments out of the betting, since they are paid outside the pot', () => {
    const withBounty: HandRecord = {
      ...holdem,
      actions: [...holdem.actions, { playerId: 'b', action: 'bounty', put: 10, stage: 'showdown', toPlayerId: 'a' } as any],
    };
    const text = formatPokerStarsHand(redactHandRecord(withBounty, 'b'), { viewerId: 'b' });
    expect(text).not.toContain('posts $10');
    expect(text).toContain('Ann collected $80 from pot');
    expect(text).toContain('Total pot $80');
  });

  it('names fixed-limit and the new variants', () => {
    const limitRazz = formatPokerStarsHand({ ...holdem, variant: 'razz', bettingMode: 'fixed-limit', board: [], actions: [], winners: [] }, { viewerId: 'a' });
    expect(limitRazz.split('\n')[0]).toContain('Razz Limit');
    const plo5 = formatPokerStarsHand({ ...holdem, variant: 'omaha-5', bettingMode: 'pot-limit' }, { viewerId: 'a' });
    expect(plo5.split('\n')[0]).toContain('5 Card Omaha Pot Limit');
  });
});

describe('formatPokerStarsHand edge cases', () => {
  it('returns an uncalled bet and handles a hand won without a showdown', () => {
    const hand: HandRecord = {
      ...holdem,
      bettingMode: 'pot-limit',
      variant: 'omaha',
      buttonSeat: undefined,
      board: [],
      players: holdem.players.slice(0, 2).map(p => ({ ...p, revealed: false, folded: p.id === 'b' })),
      actions: [
        { playerId: 'a', action: 'small-blind', amount: 5, put: 5, stage: 'preflop' },
        { playerId: 'b', action: 'big-blind', amount: 10, put: 10, stage: 'preflop' },
        { playerId: 'a', action: 'raise', amount: 100, put: 95, stage: 'preflop' },
        { playerId: 'b', action: 'fold', put: 0, stage: 'preflop' },
      ],
      winners: [{ playerId: 'a', amount: 20 }],
      pot: 20,
    };
    const text = formatPokerStarsHand(redactHandRecord(hand, 'b'), { viewerId: 'b' });
    expect(text).toContain("Omaha Pot Limit ($5/$10 USD)");
    // Heads-up the small blind has the button
    expect(text).toContain('Seat #1 is the button');
    expect(text).toContain('Ann: raises $90 to $100 and is all-in');
    expect(text).toContain('Uncalled bet ($90) returned to Ann');
    expect(text).toContain("Ann: doesn't show hand");
    expect(text).not.toContain('SHOW DOWN');
    expect(text).toContain('Seat 1: Ann (button) (small blind) collected ($20)');
    expect(text).toContain('Seat 2: Bob (big blind) folded before Flop');
    expect(text).not.toContain('Ah');
  });

  it('runs out the board after an all-in and lists run-it-twice boards', () => {
    const hand: HandRecord = {
      ...holdem,
      players: holdem.players.slice(0, 2),
      actions: [
        { playerId: 'a', action: 'small-blind', amount: 5, put: 5, stage: 'preflop' },
        { playerId: 'b', action: 'big-blind', amount: 10, put: 10, stage: 'preflop' },
        { playerId: 'a', action: 'raise', amount: 100, put: 95, stage: 'preflop' },
        { playerId: 'b', action: 'call', amount: 100, put: 90, stage: 'preflop' },
      ],
      runBoards: [holdem.board, [...holdem.board.slice(0, 3), c('A', 'clubs'), c('A', 'spades')]],
      winners: [{ playerId: 'a', amount: 100 }, { playerId: 'b', amount: 100 }],
      pot: 200,
    };
    const text = formatPokerStarsHand(redactHandRecord(hand, 'a'), { viewerId: 'a' });
    expect(text).toContain('Bob: calls $90 and is all-in');
    expect(text).toContain('*** FLOP *** [2c 7s 9d]\n*** TURN ***');
    expect(text).toContain('*** RIVER *** [2c 7s 9d Jc] [Th]');
    expect(text).toContain('*** FIRST BOARD *** [2c 7s 9d Jc Th]\n*** SECOND BOARD *** [2c 7s 9d Ac As]');
    expect(text).toContain('Ann collected $100 from pot\nBob collected $100 from pot');
  });

  it('writes bomb pot antes before the flop action', () => {
    const hand: HandRecord = {
      ...holdem,
      kind: 'bomb-pot',
      players: holdem.players.slice(0, 2),
      actions: [
        { playerId: 'a', action: 'ante', put: 20, stage: 'flop' },
        { playerId: 'b', action: 'ante', put: 20, stage: 'flop' },
        { playerId: 'a', action: 'check', put: 0, stage: 'flop' },
        { playerId: 'b', action: 'bet', amount: 20, put: 20, stage: 'flop' },
        { playerId: 'a', action: 'fold', put: 0, stage: 'flop' },
      ],
      winners: [{ playerId: 'b', amount: 40 }],
      pot: 40,
    };
    const text = formatPokerStarsHand(redactHandRecord(hand, 'a'), { viewerId: 'a' });
    expect(text).toContain('Ann: posts the ante $20\nBob: posts the ante $20\n*** HOLE CARDS ***\nDealt to Ann [Ah Kd]\n*** FLOP *** [2c 7s 9d]\nAnn: checks\nBob: bets $20');
    expect(text).toContain('Uncalled bet ($20) returned to Bob');
    expect(text).toContain('Seat 1: Ann (button) folded on the Flop');
  });

  it('writes stud streets with up cards and keeps others\' down cards hidden', () => {
    const hand: HandRecord = {
      ...holdem,
      variant: 'seven-card-stud',
      board: [],
      buttonSeat: undefined,
      players: [
        { id: 'a', name: 'Ann', seat: 0, startStack: 100, endStack: 110, net: 10, won: 12, folded: false, revealed: false,
          cards: { down: [c('A', 'hearts'), c('A', 'clubs')], up: [c('K', 'spades'), c('2', 'hearts')] } },
        { id: 'b', name: 'Bob', seat: 1, startStack: 100, endStack: 98, net: -2, won: 0, folded: true, revealed: false,
          cards: { down: [c('9', 'hearts'), c('8', 'clubs')], up: [c('3', 'clubs'), c('4', 'diamonds')] } },
      ],
      actions: [
        { playerId: 'a', action: 'ante', put: 1, stage: 'third' },
        { playerId: 'b', action: 'ante', put: 1, stage: 'third' },
        { playerId: 'b', action: 'bring-in', amount: 2, put: 2, stage: 'third' },
        { playerId: 'a', action: 'bet', amount: 5, put: 5, stage: 'third' },
        { playerId: 'b', action: 'call', amount: 5, put: 3, stage: 'third' },
        { playerId: 'a', action: 'bet', amount: 5, put: 5, stage: 'fourth' },
        { playerId: 'b', action: 'fold', put: 0, stage: 'fourth' },
      ],
      winners: [{ playerId: 'a', amount: 12 }],
      pot: 12,
    };
    const text = formatPokerStarsHand(redactHandRecord(hand, 'a'), { viewerId: 'a' });
    expect(text).toContain("7 Card Stud No Limit");
    expect(text).toContain("Table 'room-1' 8-max\n");
    // Seats counted from 0 are shifted to count from 1
    expect(text).toContain('Seat 1: Ann ($100 in chips)\nSeat 2: Bob ($100 in chips)');
    expect(text).toContain('Ann: posts the ante $1\nBob: posts the ante $1\n*** 3rd STREET ***\nDealt to Ann [Ah Ac Ks]\nDealt to Bob [3c]\nBob: brings in for $2\nAnn: completes it to $5\nBob: calls $3');
    expect(text).toContain('*** 4th STREET ***\nDealt to Ann [Ah Ac Ks] [2h]\nDealt to Bob [3c] [4d]\nAnn: bets $5\nBob: folds');
    expect(text).not.toContain('9h');
    expect(text).toContain('Seat 2: Bob folded on the 4th Street');

    // The bring-in player may complete straight away instead of bringing it in
    const completed = formatPokerStarsHand(redactHandRecord({
      ...hand,
      actions: [
        { playerId: 'b', action: 'bet', amount: 4, put: 4, stage: 'third' },
        { playerId: 'a', action: 'call', amount: 4, put: 4, stage: 'third' },
      ],
    }, 'a'), { viewerId: 'a' });
    expect(completed).toContain('Bob: completes it to $4\nAnn: calls $4');
  });
});

describe('formatPokerStarsHands', () => {
  it('joins hands oldest first with blank lines', () => {
    const later = { ...holdem, id: 'ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee', endedAt: '2026-10-24T00:00:00.000Z' };
    const text = formatPokerStarsHands([later, holdem], h => ({ viewerId: 'a', tableName: h.roomId }));
    const parts = text.trimEnd().split('\n\n\n');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain(`#${pokerStarsHandNumber(holdem)}:`);
    expect(parts[1]).toContain(`#${pokerStarsHandNumber(later)}:`);
    expect(formatPokerStarsHands([], { viewerId: 'a' })).toBe('');
  });
});
