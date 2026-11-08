import {
  hammerTiers,
  handAchievements,
  historyAchievements,
  isDejaVu,
  isSevenDeuceOffsuit,
  savingRivers,
} from '../achievement-checks';
import type { PastHand } from '../achievement-checks';

const c = (rank: string, suit: string): any => ({ rank, suit });
const s = (rank: string) => c(rank, 'spades');
const h = (rank: string) => c(rank, 'hearts');
const d = (rank: string) => c(rank, 'diamonds');
const k = (rank: string) => c(rank, 'clubs');

const player = (overrides: Record<string, unknown> = {}): any => ({
  id: 'a', name: 'A', seat: 1, startStack: 1000, endStack: 1100, net: 100, won: 200, folded: false,
  cards: { hole: [h('A'), d('A')] }, revealed: true, ...overrides,
});
const loser = (hole: any[], overrides: Record<string, unknown> = {}) =>
  player({ id: 'b', name: 'B', net: -100, won: 0, endStack: 900, cards: { hole }, ...overrides });

const record = (overrides: Record<string, unknown> = {}): any => ({
  id: 'hand-9', roomId: 'room-1', handNumber: 9, variant: 'texas-holdem', kind: 'normal', smallBlind: 5, bigBlind: 10,
  startedAt: '2026-01-01T03:00:00.000Z', endedAt: '2026-01-01T03:01:00.000Z',
  board: [s('K'), k('7'), d('7'), h('3'), s('9')],
  players: [player(), loser([h('Q'), d('Q')])],
  actions: [], winners: [{ playerId: 'a', amount: 200 }], pot: 200, ...overrides,
});

/** Achievements player `id` earns from the record. */
const earnedBy = (rec: any, id = 'a', extras = {}) => handAchievements(rec, rec.players.find((p: any) => p.id === id), extras);

describe('achievement checks for one hand', () => {
  it('spots 7-2 offsuit, and a 7-2 win at showdown', () => {
    expect(isSevenDeuceOffsuit([h('7'), d('2')])).toBe(true);
    expect(isSevenDeuceOffsuit([d('2'), h('7')])).toBe(true);
    expect(isSevenDeuceOffsuit([h('7'), h('2')])).toBe(false);
    expect(isSevenDeuceOffsuit([h('7'), d('3')])).toBe(false);

    const rec = record({ players: [player({ cards: { hole: [h('7'), d('2')] } }), loser([h('Q'), d('Q')])] });
    expect(earnedBy(rec)).toContain('hammer_showdown');
    // Everyone else folded: a hammer win, but not at showdown
    const folded = record({ players: [player({ cards: { hole: [h('7'), d('2')] } }), loser([h('Q'), d('Q')], { folded: true })] });
    expect(earnedBy(folded)).not.toContain('hammer_showdown');
  });

  it("awards the dead man's hand only when the player holds an ace and an eight", () => {
    const board = [s('A'), k('8'), d('3'), h('5'), s('K')];
    expect(earnedBy(record({ board, players: [player({ cards: { hole: [h('A'), d('8')] } }), loser([h('Q'), d('J')])] })))
      .toContain('dead_mans_hand');
    const boardPairs = [s('A'), k('A'), d('8'), h('8'), s('K')];
    expect(earnedBy(record({ board: boardPairs, players: [player({ cards: { hole: [h('Q'), d('4')] } }), loser([h('J'), d('3')])] })))
      .not.toContain('dead_mans_hand');
  });

  it('awards the wheel and the steel wheel', () => {
    const wheel = record({ board: [s('3'), k('4'), d('5'), h('K'), s('9')], players: [player({ cards: { hole: [h('A'), d('2')] } }), loser([h('Q'), d('Q')])] });
    expect(earnedBy(wheel)).toContain('wheel');
    expect(earnedBy(wheel)).not.toContain('steel_wheel');

    const steel = record({ board: [s('3'), s('4'), s('5'), h('K'), d('9')], players: [player({ cards: { hole: [s('A'), s('2')] } }), loser([h('Q'), d('Q')])] });
    expect(earnedBy(steel)).toContain('steel_wheel');
    expect(earnedBy(steel)).not.toContain('wheel');
  });

  it('awards a bicycle in razz and for the low half of Omaha hi-lo', () => {
    const razz = record({
      variant: 'razz', board: [],
      players: [
        player({ cards: { down: [h('A'), d('2'), s('K')], up: [k('3'), d('4'), h('5'), s('Q')] } }),
        loser([], { cards: { down: [h('6'), d('7'), s('8')], up: [k('9'), d('10'), h('J'), k('Q')] } }),
      ],
    });
    expect(earnedBy(razz)).toContain('bicycle');

    const omaha = record({
      variant: 'omaha-hi-lo', board: [s('3'), k('4'), d('5'), h('Q'), s('J')],
      players: [player({ cards: { hole: [h('A'), d('2'), s('K'), k('K')] } }), loser([h('Q'), d('Q'), k('9'), d('9')])],
    });
    expect(earnedBy(omaha, 'a', { hiLo: { high: [{ playerId: 'b' }], low: [{ playerId: 'a' }] } })).toContain('bicycle');
    expect(earnedBy(omaha, 'a', { hiLo: { high: [{ playerId: 'a' }], low: [{ playerId: 'b' }] } })).not.toContain('bicycle');
  });

  it('awards a bad beat for losing with a full house, and a cooler for losing with quads', () => {
    const fullHouse = record({
      board: [s('K'), k('K'), d('7'), h('7'), s('2')],
      players: [player({ cards: { hole: [h('K'), d('K')] } }), loser([k('7'), d('2')])],
    });
    expect(earnedBy(fullHouse, 'b')).toContain('bad_beat');
    expect(earnedBy(fullHouse, 'b')).not.toContain('cooler');

    const quads = record({
      board: [s('9'), s('10'), s('J'), h('9'), d('9')],
      players: [player({ cards: { hole: [s('Q'), s('K')] } }), loser([k('9'), d('2')])],
    });
    expect(earnedBy(quads, 'b')).toEqual(expect.arrayContaining(['bad_beat', 'cooler']));
    // Folding a full house is no bad beat
    expect(earnedBy(record({ ...fullHouse, players: [fullHouse.players[0], { ...fullHouse.players[1], folded: true }] }), 'b'))
      .not.toContain('bad_beat');
  });

  it('awards a one-outer when only one river card could win', () => {
    // Kings against aces on the turn: only the last king saves them
    const rec = record({
      board: [s('A'), d('K'), k('7'), h('2'), k('K')],
      players: [player({ cards: { hole: [s('K'), h('K')] } }), loser([h('A'), d('A')])],
    });
    expect(savingRivers(rec, rec.players[0])).toBe(1);
    expect(earnedBy(rec)).toContain('one_outer');
    // The favourite had plenty of rivers
    expect(earnedBy(record()).includes('one_outer')).toBe(false);
  });

  it('awards runner-runner for a flush that needed both the turn and the river', () => {
    const rec = record({
      board: [h('2'), k('5'), s('K'), h('3'), h('4')],
      players: [player({ cards: { hole: [h('8'), h('9')] } }), loser([d('K'), d('Q')])],
    });
    expect(earnedBy(rec)).toContain('runner_runner');
    // Already four to a flush on the flop: the turn alone would have done it
    const oneCard = record({
      board: [h('2'), h('5'), s('K'), h('3'), k('4')],
      players: [player({ cards: { hole: [h('8'), h('9')] } }), loser([d('K'), d('Q')])],
    });
    expect(earnedBy(oneCard)).not.toContain('runner_runner');
  });

  it('awards board plays to everyone splitting a pot over quads or a royal flush on the board', () => {
    const rec = record({
      board: [s('9'), h('9'), d('9'), k('9'), s('A')],
      players: [player({ cards: { hole: [k('2'), d('3')] }, won: 100 }), loser([h('4'), d('5')], { won: 100, net: 0 })],
      winners: [{ playerId: 'a', amount: 100 }, { playerId: 'b', amount: 100 }],
    });
    expect(earnedBy(rec, 'a')).toContain('board_plays');
    expect(earnedBy(rec, 'b')).toContain('board_plays');
    expect(earnedBy(record({ ...rec, winners: [{ playerId: 'a', amount: 200 }] }), 'a')).not.toContain('board_plays');
  });

  it('awards a three-way chop for equal shares between three winners', () => {
    const players = ['a', 'b', 'c'].map(id => player({ id, cards: { hole: [h('2'), d('3')] }, won: 100 }));
    const winners = [{ playerId: 'a', amount: 100 }, { playerId: 'b', amount: 100 }, { playerId: 'c', amount: 101 }];
    expect(earnedBy(record({ players, winners }))).toContain('three_way_chop');
    const uneven = [{ playerId: 'a', amount: 100 }, { playerId: 'b', amount: 40 }, { playerId: 'c', amount: 300 }];
    expect(earnedBy(record({ players, winners: uneven }))).not.toContain('three_way_chop');
  });

  it('awards a scoop for both halves of a hi-lo pot', () => {
    const rec = record({ variant: 'omaha-hi-lo', players: [player({ cards: { hole: [h('A'), d('2'), s('K'), k('K')] } }), loser([h('Q'), d('Q'), k('9'), d('9')])] });
    expect(earnedBy(rec, 'a', { hiLo: { high: [{ playerId: 'a' }], low: [{ playerId: 'a' }] } })).toContain('scoop');
    expect(earnedBy(rec, 'a', { hiLo: { high: [{ playerId: 'a' }], low: [{ playerId: 'a' }, { playerId: 'b' }] } })).not.toContain('scoop');
    // Nobody qualified for low: winning the high half isn't a scoop
    expect(earnedBy(rec, 'a', { hiLo: { high: [{ playerId: 'a' }], low: null } })).not.toContain('scoop');
  });

  it('awards double trouble for winning every run outright', () => {
    const rec = record({ runBoards: [record().board, record().board] });
    expect(earnedBy(rec, 'a', { runWinners: [['a'], ['a']] })).toContain('double_trouble');
    expect(earnedBy(rec, 'a', { runWinners: [['a'], ['b']] })).not.toContain('double_trouble');
  });

  it('awards two birds for knocking out two players in one hand', () => {
    const busted = (id: string) => loser([h('Q'), d('Q')], { id, startStack: 500, endStack: 0, net: -500 });
    expect(earnedBy(record({ players: [player({ won: 1000 }), busted('b'), busted('c')] }))).toContain('two_birds');
    expect(earnedBy(record({ players: [player({ won: 1000 }), busted('b'), loser([h('J'), d('J')], { id: 'c' })] }))).not.toContain('two_birds');
  });

  it('awards a stone cold bluff for betting the river with nothing and taking it down', () => {
    const bluff = (hole: any[], action = 'bet') => record({
      board: [s('K'), k('Q'), d('9'), h('4'), s('3')],
      players: [player({ cards: { hole } }), loser([h('A'), d('A')], { folded: true })],
      actions: [{ playerId: 'a', action, put: 50, stage: 'river' }],
    });
    expect(earnedBy(bluff([h('7'), d('2')]))).toContain('stone_cold_bluff');
    expect(earnedBy(bluff([h('K'), d('2')]))).not.toContain('stone_cold_bluff');
    expect(earnedBy(bluff([h('7'), d('2')], 'check'))).not.toContain('stone_cold_bluff');
  });

  it('awards make it rain for winning a hand you splashed', () => {
    expect(earnedBy(record(), 'a', { splashedBy: ['a'] })).toContain('make_it_rain');
    expect(earnedBy(record(), 'b', { splashedBy: ['b'] })).not.toContain('make_it_rain');
  });
});

describe('achievement checks over earlier hands', () => {
  const past = (minutesBefore: number, me: Record<string, unknown>, extra: Partial<PastHand> = {}): PastHand => {
    const ended = Date.parse('2026-01-01T03:00:00.000Z') - minutesBefore * 60_000;
    return {
      handId: `h-${minutesBefore}`,
      startedAt: new Date(ended - 60_000).toISOString(),
      endedAt: new Date(ended).toISOString(),
      bigBlind: 10,
      variant: 'texas-holdem',
      me: { startStack: 1000, endStack: 1000, net: 0, won: 0, folded: false, ...me } as any,
      ...extra,
    };
  };
  const rec = record();
  const me = rec.players[0];

  it('awards a heater for five wins in a row', () => {
    const wins = [1, 2, 3, 4].map(m => past(m, { won: 50 }));
    expect(historyAchievements(rec, me, wins)).toContain('heater');
    expect(historyAchievements(rec, me, [...wins.slice(0, 3), past(4, { won: 0 })])).not.toContain('heater');
  });

  it('awards the patient one for a win after fifty folds', () => {
    const folds = Array.from({ length: 50 }, (_, i) => past(i + 1, { folded: true }));
    expect(historyAchievements(rec, me, folds)).toContain('patient_one');
    expect(historyAchievements(rec, me, folds.slice(0, 49))).not.toContain('patient_one');
  });

  it('awards chip and a chair for doubling up from under ten big blinds without adding chips', () => {
    const climb = [past(3, { startStack: 80, endStack: 500 }), past(6, { startStack: 1000, endStack: 80 }), past(9, { startStack: 1000, endStack: 1000 })];
    const current = player({ startStack: 500, endStack: 2100 });
    expect(historyAchievements(rec, current, climb)).toContain('chip_and_a_chair');
    // Chips added after the low point
    const topUp = [past(3, { startStack: 1000, endStack: 500 }), ...climb.slice(1)];
    expect(historyAchievements(rec, current, topUp)).not.toContain('chip_and_a_chair');
  });

  it('awards aces cracked for losing with pocket aces three times in a session', () => {
    const aces = { cards: { hole: [h('A'), d('A')] }, net: -100 };
    const current = player({ net: -100, won: 0 });
    expect(historyAchievements(rec, current, [past(5, aces), past(30, aces)])).toContain('aces_cracked');
    // The second loss was in an earlier session, three hours before
    expect(historyAchievements(rec, current, [past(5, aces), past(200, aces)])).not.toContain('aces_cracked');
  });

  it('spots the same hole cards as the hand before', () => {
    const previous = [player({ cards: { hole: [d('A'), h('A')] } })];
    expect(isDejaVu(rec, me, previous)).toBe(true);
    expect(isDejaVu(rec, me, [player({ cards: { hole: [s('A'), h('A')] } })])).toBe(false);
    expect(isDejaVu(rec, me, null)).toBe(false);
  });

  it('counts hammer tiers', () => {
    expect(hammerTiers(1)).toEqual(['hammer']);
    expect(hammerTiers(7)).toEqual(['hammer', 'hammer_7']);
    expect(hammerTiers(72)).toEqual(['hammer', 'hammer_7', 'hammer_72']);
  });
});
