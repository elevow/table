import { TournamentManager, whyNoReentry } from '../tournament-manager';
import { MemoryTournamentStore } from '../tournament-store';
import { amountsPaid, bountyPool, chipsInPlay, entryCount, payoutTable, prizePool } from '../tournament-money';
import { scaledPayoutStructure, validateTournamentConfig, createDefaultFreezeoutConfig } from '../tournament-utils';
import { tournamentEvents } from '../tournament-events';
import { noticesFor } from '../tournament-notices';
import type { TournamentConfig } from '../../../types/tournament';
import type { TournamentState } from '../../../types/tournament-management';

const MIN = 60_000;

function manager(onChange?: (before: TournamentState, after: TournamentState) => void) {
  let now = 10_000_000;
  const mgr = new TournamentManager(new MemoryTournamentStore(), () => 0, () => now, onChange);
  return { mgr, advance: (ms: number) => (now += ms), now: () => now };
}

async function withPlayers(mgr: TournamentManager, config: TournamentConfig, players: string[]) {
  const { id } = await mgr.create({ name: 'T', config });
  for (const userId of players) await mgr.register({ tournamentId: id, userId });
  return id;
}

describe('scheduled start', () => {
  test('starts by itself once the start time comes, with enough players', async () => {
    const { mgr, advance, now } = manager();
    const id = await withPlayers(mgr, { ...createDefaultFreezeoutConfig(), startsAt: now() + 30 * MIN, minPlayers: 3 }, ['a', 'b', 'c']);
    expect(await mgr.startIfDue(id)).toMatchObject({ started: false, tournament: { status: 'setup' } });
    advance(30 * MIN);
    const { tournament, started } = await mgr.startIfDue(id);
    expect(started).toBe(true);
    expect(tournament).toMatchObject({ status: 'running' });
    expect(tournament!.tables[0].seats.filter(Boolean)).toHaveLength(3);
    // Only once
    expect((await mgr.startIfDue(id)).started).toBe(false);
  });

  test('is cancelled when too few players registered by the start time', async () => {
    const { mgr, advance, now } = manager();
    const id = await withPlayers(mgr, { ...createDefaultFreezeoutConfig(), startsAt: now() + MIN, minPlayers: 4 }, ['a', 'b', 'c']);
    advance(MIN);
    const { tournament, started } = await mgr.startIfDue(id);
    expect(started).toBe(false);
    expect(tournament).toMatchObject({ status: 'cancelled', cancelReason: 'Not enough players: 3 registered, 4 needed' });
  });

  test('a start time in the past is refused, and minimum players are checked', async () => {
    const { mgr, now } = manager();
    await expect(mgr.create({ name: 'T', config: { ...createDefaultFreezeoutConfig(), startsAt: now() - 2 * MIN } })).rejects.toThrow('already passed');
    expect(validateTournamentConfig({ ...createDefaultFreezeoutConfig(), minPlayers: 1 }).errors.join()).toMatch(/Minimum players/);
    expect(validateTournamentConfig({ ...createDefaultFreezeoutConfig(), minPlayers: 10, maxPlayers: 8 }).errors.join()).toMatch(/more than the maximum/);
  });

  test('without a start time the director starts it', async () => {
    const { mgr, advance } = manager();
    const id = await withPlayers(mgr, createDefaultFreezeoutConfig(), ['a', 'b']);
    advance(10 * 60 * MIN);
    expect((await mgr.startIfDue(id)).tournament!.status).toBe('setup');
  });
});

describe('payouts that scale with the field', () => {
  test.each([[10, 15, 2], [30, 15, 5], [100, 15, 15], [3, 50, 2], [1, 15, 1]])('%i entries at %i%% pays %i places', (entries, pct, places) => {
    const tiers = scaledPayoutStructure(entries, pct);
    expect(tiers).toHaveLength(places);
    expect(Math.round(tiers.reduce((s, t) => s + t.percentage, 0) * 100)).toBe(10000);
    for (let i = 1; i < tiers.length; i++) expect(tiers[i].percentage).toBeLessThan(tiers[i - 1].percentage);
  });

  test('the paid places follow the number of entries', async () => {
    const { mgr } = manager();
    const config = { ...createDefaultFreezeoutConfig(), buyIn: 10, payoutScaling: { paidPercent: 20 } };
    const id = await withPlayers(mgr, config, Array.from({ length: 20 }, (_, i) => `p${i}`));
    const t = (await mgr.get(id))!;
    const payouts = payoutTable(t);
    expect(payouts).toHaveLength(4);
    expect(payouts.reduce((s, p) => s + p.amount, 0)).toBeCloseTo(200, 2);
  });

  test('the share of the field must be sensible', () => {
    expect(validateTournamentConfig({ ...createDefaultFreezeoutConfig(), payoutScaling: { paidPercent: 0 } }).errors.join()).toMatch(/share of the field/);
  });
});

describe('re-entry', () => {
  const config = (extra: Partial<TournamentConfig['reentry']> = {}): TournamentConfig => ({
    ...createDefaultFreezeoutConfig(), // late registration until level 4 / 45 minutes
    buyIn: 10,
    entryFee: 1,
    bounty: { amount: 2, type: 'standard' },
    reentry: { enabled: true, ...extra },
  });

  test('a busted player buys a new entry: back in, counted as an entry, with a starting stack and bounty', async () => {
    const { mgr } = manager();
    const id = await withPlayers(mgr, config(), ['a', 'b', 'c']);
    await mgr.start(id);
    await mgr.eliminate({ tournamentId: id, userId: 'c', eliminatedBy: 'a' });
    const t = await mgr.reenter({ tournamentId: id, userId: 'c' });
    expect(t.eliminatedPlayers).toEqual([]);
    expect(t.tables[0].seats).toContain('c');
    expect(entryCount(t)).toBe(4);
    expect(prizePool(t)).toBe(40);
    expect(chipsInPlay(t)).toBe(4 * 20000);
    expect(bountyPool(t)).toBe(8);
    expect(t.bounties!.c).toBe(2);
    expect(t.pendingChips!.c).toBe(40000); // starting stack at the start, and again for the re-entry
    expect(amountsPaid(t).c).toBe(26);
  });

  test('only busted players, only while late registration is open, within the limit', async () => {
    const { mgr, advance, now } = manager();
    const id = await withPlayers(mgr, config({ maxPerPlayer: 1 }), ['a', 'b', 'c', 'd']);
    await mgr.start(id);
    const t0 = (await mgr.get(id))!;
    expect(whyNoReentry(t0, 'a', now())).toBe('Only a player who has busted can re-enter');
    await mgr.eliminate({ tournamentId: id, userId: 'd', eliminatedBy: 'a' });
    await mgr.reenter({ tournamentId: id, userId: 'd' });
    await mgr.eliminate({ tournamentId: id, userId: 'd', eliminatedBy: 'a' });
    await expect(mgr.reenter({ tournamentId: id, userId: 'd' })).rejects.toThrow('Re-entry limit reached');

    await mgr.eliminate({ tournamentId: id, userId: 'c', eliminatedBy: 'a' });
    advance(60 * MIN); // past late registration
    await expect(mgr.reenter({ tournamentId: id, userId: 'c' })).rejects.toThrow('closed with late registration');
  });

  test('needs late registration, and is refused when not allowed', async () => {
    expect(validateTournamentConfig({ ...config(), lateRegistration: { enabled: false, endLevel: 0, endTime: 0 } }).errors.join())
      .toMatch(/Re-entry needs late registration/);
    const { mgr } = manager();
    const id = await withPlayers(mgr, createDefaultFreezeoutConfig(), ['a', 'b', 'c']);
    await mgr.start(id);
    await mgr.eliminate({ tournamentId: id, userId: 'c' });
    await expect(mgr.reenter({ tournamentId: id, userId: 'c' })).rejects.toThrow('not allowed');
  });
});

describe('events', () => {
  test('the change hook hears every saved change with what happened', async () => {
    const heard: string[][] = [];
    const { mgr } = manager((before, after) => heard.push(tournamentEvents(before, after).map(e => e.type)));
    const id = await withPlayers(mgr, { ...createDefaultFreezeoutConfig(), buyIn: 10 }, ['a', 'b', 'c', 'd']);
    await mgr.start(id);
    await mgr.eliminate({ tournamentId: id, userId: 'd' }); // 3 left, 3 paid: in the money
    await mgr.eliminate({ tournamentId: id, userId: 'c' });
    await mgr.eliminate({ tournamentId: id, userId: 'b' });
    expect(heard.slice(-4)).toEqual([['started'], ['eliminated', 'in_the_money'], ['eliminated'], ['eliminated', 'finished']]);
  });

  test('table moves and cancellations are events too', async () => {
    const events: any[] = [];
    const { mgr } = manager((before, after) => events.push(...tournamentEvents(before, after)));
    const id = await withPlayers(mgr, { ...createDefaultFreezeoutConfig(), seatsPerTable: 2 }, ['a', 'b', 'c', 'd', 'e', 'f']);
    await mgr.start(id);
    await mgr.eliminate({ tournamentId: id, userId: 'a' });
    await mgr.eliminate({ tournamentId: id, userId: 'b' }); // a table empties or breaks: someone moves
    expect(events.some(e => e.type === 'moved')).toBe(true);
    await mgr.cancel({ tournamentId: id, reason: 'Storm' });
    expect(events[events.length - 1]).toEqual({ type: 'cancelled', reason: 'Storm' });
  });

  test('a listener that throws does not break the change', async () => {
    const { mgr } = manager(() => { throw new Error('boom'); });
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const id = await withPlayers(mgr, createDefaultFreezeoutConfig(), ['a', 'b']);
    expect((await mgr.start(id)).status).toBe('running');
    spy.mockRestore();
  });
});

describe('noticesFor', () => {
  test('tells players about themselves and what matters to everyone', () => {
    const events = [
      { type: 'started' as const },
      { type: 'moved' as const, userId: 'me', table: 3, seat: 5 },
      { type: 'moved' as const, userId: 'you', table: 2, seat: 1 },
      { type: 'eliminated' as const, userId: 'me', place: 3, prize: 40 },
      { type: 'eliminated' as const, userId: 'you', place: 4, prize: 0 },
    ];
    expect(noticesFor(events, 'me', true)).toEqual([
      'The tournament has started. Go to your table.',
      "You're moving to table 3, seat 5, after this hand.",
      'You finished 3rd, winning $40.',
    ]);
  });

  test('the bubble, the end and a cancellation', () => {
    expect(noticesFor([{ type: 'in_the_money', paidPlaces: 9 }], 'me', true)).toEqual(["You're in the money! The last 9 players are all paid."]);
    expect(noticesFor([{ type: 'in_the_money', paidPlaces: 9 }], null, false)).toEqual(['The money bubble has burst.']);
    expect(noticesFor([{ type: 'finished', winnerId: 'me' }], 'me', true)).toEqual(['You won the tournament!']);
    expect(noticesFor([{ type: 'finished', winnerId: 'x' }], 'me', false)).toEqual(['The tournament is over.']);
    expect(noticesFor([{ type: 'cancelled', reason: 'Storm' }], 'me', true)).toEqual(['The tournament was cancelled: Storm']);
  });
});
