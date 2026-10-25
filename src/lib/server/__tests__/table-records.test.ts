jest.mock('pg', () => ({ Pool: jest.fn() }));
jest.mock('../../database/pool', () => ({ getPool: jest.fn() }));
jest.mock('../../utils/post-hand-result', () => ({ postHandResultToChat: jest.fn() }));

import { PokerEngine } from '../../poker/poker-engine';
import { buildHandRecord, redactHandRecord, summarizeHand } from '../hand-records';
import { ledgerToCsv, settlementPayments, summarizeLedger, type LedgerEntry } from '../chip-ledger';
import { advanceSeatOffer, SEAT_OFFER_MS } from '../room-config';

const mk = (id: string, position: number): any => ({
  id, name: id.toUpperCase(), position, stack: 1000, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30,
});

function finishedHand() {
  const engine = new PokerEngine('room-1', [mk('a', 1), mk('b', 2), mk('c', 3)], 5, 10);
  engine.startNewHand();
  for (let i = 0; i < 40 && engine.getState().stage !== 'showdown'; i++) {
    const s = engine.getState();
    const me = s.players.find(p => p.id === s.activePlayer)!;
    engine.handleAction({ type: me.currentBet < s.currentBet ? 'call' : 'check', playerId: me.id, tableId: 'room-1', timestamp: 0 } as any);
  }
  return engine.getState();
}

describe('hand records', () => {
  it('records a finished hand with stacks, results and every dealt card', () => {
    const state = finishedHand();
    const record = buildHandRecord('room-1', state)!;
    expect(record.id).toBe(state.handId);
    expect(record.players).toHaveLength(3);
    expect(record.pot).toBe(30);
    expect(record.players.reduce((sum, p) => sum + p.net, 0)).toBe(0);
    record.players.forEach(p => expect(p.cards!.hole).toHaveLength(2));
    // Winners are shown; losers mucked
    record.players.forEach(p => expect(p.revealed).toBe(state.handWinners!.includes(p.id)));
  });

  it('returns nothing for a hand still being played', () => {
    const engine = new PokerEngine('room-1', [mk('a', 1), mk('b', 2)], 5, 10);
    engine.startNewHand();
    expect(buildHandRecord('room-1', engine.getState())).toBeNull();
  });

  it('shows each viewer their own cards and only the cards shown at the table', () => {
    const record = buildHandRecord('room-1', finishedHand())!;
    const loser = record.players.find(p => !p.revealed);
    if (!loser) return; // everyone split
    const viewer = record.players.find(p => p.id !== loser.id)!;
    const asViewer = redactHandRecord(record, viewer.id);
    expect(asViewer.players.find(p => p.id === loser.id)!.cards).toBeUndefined();
    expect(asViewer.players.find(p => p.id === viewer.id)!.cards).toBeDefined();
    expect(redactHandRecord(record, loser.id).players.find(p => p.id === loser.id)!.cards!.hole).toHaveLength(2);
  });

  it('summarizes a hand for the viewer', () => {
    const record = buildHandRecord('room-1', finishedHand())!;
    const me = record.players[0];
    const summary = summarizeHand(record, me.id);
    expect(summary.myNet).toBe(me.net);
    expect(summary.winners.every(w => w.name.length > 0)).toBe(true);
  });
});

describe('chip ledger', () => {
  const entries: LedgerEntry[] = [
    { playerId: 'a', playerName: 'Ann', kind: 'buy_in', amount: 100, createdAt: '' },
    { playerId: 'b', playerName: 'Bob', kind: 'buy_in', amount: 100, createdAt: '' },
    { playerId: 'b', playerName: 'Bob', kind: 'rebuy', amount: 100, createdAt: '' },
    { playerId: 'c', playerName: 'Cy, Jr', kind: 'buy_in', amount: 100, createdAt: '' },
    { playerId: 'c', playerName: 'Cy, Jr', kind: 'cash_out', amount: 40, createdAt: '' },
  ];
  const onTable = new Map([['a', { name: 'Ann', stack: 260 }], ['b', { name: 'Bob', stack: 100 }]]);

  it('nets what each player brought, took away and still has', () => {
    const lines = summarizeLedger(entries, onTable);
    expect(lines.map(l => [l.playerName, l.net])).toEqual([['Ann', 160], ['Cy, Jr', -60], ['Bob', -100]]);
    expect(lines.reduce((sum, l) => sum + l.net, 0)).toBe(0);
  });

  it('settles up with the fewest payments', () => {
    const payments = settlementPayments(summarizeLedger(entries, onTable));
    expect(payments).toEqual([
      { from: 'Bob', to: 'Ann', amount: 100 },
      { from: 'Cy, Jr', to: 'Ann', amount: 60 },
    ]);
  });

  it('exports CSV with names quoted when needed', () => {
    const csv = ledgerToCsv(summarizeLedger(entries, onTable));
    expect(csv.split('\n')[0]).toBe('Player,Bought in,Cashed out,On table,Net');
    expect(csv).toContain('"Cy, Jr",100,40,0,-60');
  });
});

describe('waitlist', () => {
  const waitlist = [
    { playerId: 'w1', playerName: 'W1', joinedAt: 1 },
    { playerId: 'w2', playerName: 'W2', joinedAt: 2 },
  ];

  it('offers a free seat to the first in line', () => {
    const next = advanceSeatOffer({ waitlist }, [4], 1000);
    expect(next.seatOffer).toEqual({ playerId: 'w1', seatNumber: 4, expiresAt: 1000 + SEAT_OFFER_MS });
    expect(next.changed).toBe(true);
  });

  it('drops a player who let their offer lapse and offers the seat to the next', () => {
    const next = advanceSeatOffer({ waitlist, seatOffer: { playerId: 'w1', seatNumber: 4, expiresAt: 500 } }, [4], 1000);
    expect(next.waitlist.map(w => w.playerId)).toEqual(['w2']);
    expect(next.seatOffer!.playerId).toBe('w2');
  });

  it('keeps a live offer and changes nothing without free seats', () => {
    const live = { waitlist, seatOffer: { playerId: 'w1', seatNumber: 4, expiresAt: 5000 } };
    expect(advanceSeatOffer(live, [4], 1000).changed).toBe(false);
    expect(advanceSeatOffer({ waitlist }, [], 1000)).toEqual({ waitlist, seatOffer: null, changed: false });
  });
});
