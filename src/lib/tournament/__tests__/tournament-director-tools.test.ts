import { TournamentManager } from '../tournament-manager';
import { MemoryTournamentStore } from '../tournament-store';
import { amountsPaid, bountyPool, forfeitedBounties } from '../tournament-money';
import { buildTournamentView } from '../tournament-view';
import { sendTournamentError } from '../api-errors';
import { createDefaultFreezeoutConfig, createRebuyAddOnConfig } from '../tournament-utils';
import type { TournamentConfig } from '../../../types/tournament';
import type { TournamentState } from '../../../types/tournament-management';

const knockout = (): TournamentConfig => ({ ...createDefaultFreezeoutConfig(), buyIn: 10, entryFee: 1, bounty: { amount: 2, type: 'progressive' } });

async function setup(config: TournamentConfig = knockout(), players = ['a', 'b', 'c'], start = true) {
  let now = 1_000_000;
  const mgr = new TournamentManager(new MemoryTournamentStore(), Math.random, () => now);
  const { id } = await mgr.create({ name: 'Tools', config });
  for (const userId of players) await mgr.register({ tournamentId: id, userId });
  if (start) await mgr.start(id);
  return { mgr, id, advance: (ms: number) => (now += ms), read: async () => (await mgr.get(id))! };
}

const strip = ({ lastElimination: _undo, updatedAt: _at, ...rest }: TournamentState) => rest;
const outstanding = (t: TournamentState) => Object.values(t.bounties || {}).reduce((a, b) => a + b, 0);
const won = (t: TournamentState) => Object.values(t.bountyWinnings || {}).reduce((a, b) => a + b, 0);

describe('undoing an elimination', () => {
  test('restores the player, their seat, place and the bounty exactly', async () => {
    const { mgr, id, read } = await setup();
    const before = await read();
    await mgr.eliminate({ tournamentId: id, userId: 'c', eliminatedBy: 'a' });
    const after = await mgr.undoElimination(id);
    expect(strip(after)).toEqual(strip(before));
    expect(after.lastElimination).toBeUndefined();
  });

  test('reopens a tournament the elimination had ended', async () => {
    const { mgr, id } = await setup(knockout(), ['a', 'b']);
    expect((await mgr.eliminate({ tournamentId: id, userId: 'b', eliminatedBy: 'a' })).status).toBe('completed');
    const t = await mgr.undoElimination(id);
    expect(t.status).toBe('running');
    expect(t.bounties).toEqual({ a: 2, b: 2 });
    expect(t.bountyWinnings ?? {}).toEqual({});
  });

  test('only the latest elimination, and only before anything else changes', async () => {
    const { mgr, id } = await setup(createRebuyAddOnConfig(), ['a', 'b', 'c', 'd']);
    await expect(mgr.undoElimination(id)).rejects.toThrow('Only the most recent elimination');
    await mgr.eliminate({ tournamentId: id, userId: 'd' });
    await mgr.rebuy({ tournamentId: id, userId: 'a' });
    await expect(mgr.undoElimination(id)).rejects.toThrow('Only the most recent elimination');

    await mgr.eliminate({ tournamentId: id, userId: 'c' });
    await mgr.undoElimination(id);
    await expect(mgr.undoElimination(id)).rejects.toThrow('Only the most recent elimination');
  });

  test('a refused elimination leaves nothing to undo', async () => {
    const { mgr, id } = await setup();
    await expect(mgr.eliminate({ tournamentId: id, userId: 'c' })).rejects.toThrow('Say who knocked');
    await expect(mgr.undoElimination(id)).rejects.toThrow('Only the most recent elimination');
  });

  test('the view offers undo to the director only', async () => {
    const { mgr, id, read } = await setup();
    await mgr.eliminate({ tournamentId: id, userId: 'c', eliminatedBy: 'a' });
    const t = await read();
    expect(buildTournamentView(t, Date.now(), null, { c: 'Cara' }, { canManage: true }).undo).toEqual({ userId: 'c', name: 'Cara' });
    expect(buildTournamentView(t, Date.now(), null, {}, { canManage: false }).undo).toBeNull();
  });
});

describe('removing a player', () => {
  test('before the start takes the entry back', async () => {
    const { mgr, id } = await setup(knockout(), ['a', 'b'], false);
    const t = await mgr.removePlayer({ tournamentId: id, userId: 'b' });
    expect(t.registeredPlayers).toEqual(['a']);
    expect(t.bounties).toEqual({ a: 2 });
  });

  test('during play takes them out with nobody credited and their bounty forfeited', async () => {
    const { mgr, id } = await setup();
    const t = await mgr.removePlayer({ tournamentId: id, userId: 'c' });
    expect(t.eliminationRecords).toEqual([expect.objectContaining({ userId: 'c', place: 3, removed: true, forfeitedBounty: 2 })]);
    expect(t.eliminationRecords![0]).not.toHaveProperty('eliminatedBy');
    expect(t.tables.flatMap(tb => tb.seats)).not.toContain('c');
    // Every bounty dollar is still accounted for
    expect(forfeitedBounties(t)).toBe(2);
    expect(outstanding(t) + won(t) + forfeitedBounties(t)).toBe(bountyPool(t));
  });

  test('can be undone like an elimination', async () => {
    const { mgr, id } = await setup();
    await mgr.removePlayer({ tournamentId: id, userId: 'c' });
    expect((await mgr.undoElimination(id)).eliminatedPlayers).toEqual([]);
  });

  test('refuses players who are out or not registered, and finished tournaments', async () => {
    const { mgr, id } = await setup();
    await mgr.removePlayer({ tournamentId: id, userId: 'c' });
    await expect(mgr.removePlayer({ tournamentId: id, userId: 'c' })).rejects.toThrow('already out');
    await expect(mgr.removePlayer({ tournamentId: id, userId: 'zed' })).rejects.toThrow('Player not registered');
    await mgr.removePlayer({ tournamentId: id, userId: 'b' });
    await expect(mgr.removePlayer({ tournamentId: id, userId: 'a' })).rejects.toThrow('in progress');
  });
});

describe('editing', () => {
  test('changes the name and structure before the start, and bounties follow', async () => {
    const { mgr, id } = await setup(knockout(), ['a', 'b'], false);
    const config = { ...knockout(), bounty: { amount: 5, type: 'standard' as const }, startingStack: 30000 };
    const t = await mgr.edit({ tournamentId: id, name: '  Renamed  ', config });
    expect(t.name).toBe('Renamed');
    expect(t.config.startingStack).toBe(30000);
    expect(t.bounties).toEqual({ a: 5, b: 5 });

    const noBounty = await mgr.edit({ tournamentId: id, config: createDefaultFreezeoutConfig() });
    expect(noBounty.bounties).toBeUndefined();
  });

  test('refuses invalid changes, a cap below the field, and edits after the start', async () => {
    const { mgr, id } = await setup(knockout(), ['a', 'b', 'c'], false);
    await expect(mgr.edit({ tournamentId: id, name: ' ' })).rejects.toThrow('Give the tournament a name');
    await expect(mgr.edit({ tournamentId: id, config: { ...knockout(), startingStack: 0 } })).rejects.toThrow('Invalid tournament config');
    await expect(mgr.edit({ tournamentId: id, config: { ...knockout(), maxPlayers: 2 } })).rejects.toThrow('3 players have already registered');
    await mgr.start(id);
    await expect(mgr.edit({ tournamentId: id, name: 'Late' })).rejects.toThrow('only be edited before it starts');
  });
});

describe('cancelling', () => {
  test('stops the tournament, keeps the reason and lists what each player paid', async () => {
    const config = { ...createRebuyAddOnConfig(), bounty: { amount: 2, type: 'standard' as const } };
    const { mgr, id, read } = await setup(config, ['a', 'b', 'c']);
    await mgr.rebuy({ tournamentId: id, userId: 'a' });
    const t = await mgr.cancel({ tournamentId: id, reason: ' Venue closed ' });
    expect(t).toMatchObject({ status: 'cancelled', cancelReason: 'Venue closed', currentLevelStartedAt: null });
    // $50 buy-in + $2 bounty each; a's rebuy is $50 + $2
    expect(amountsPaid(t)).toEqual({ a: 104, b: 52, c: 52 });

    const view = buildTournamentView(await read(), Date.now(), 'a', { a: 'Alice', b: 'Bob', c: 'Cara' }, { canManage: true });
    expect(view.cancelled).toEqual({ at: expect.any(Number), reason: 'Venue closed' });
    expect(view.refunds.map(r => [r.name, r.paid])).toEqual([['Alice', 104], ['Bob', 52], ['Cara', 52]]);
    expect(view.you!.paid).toBe(104);
    expect(buildTournamentView(await read(), Date.now(), 'a', {}, { canManage: false }).refunds).toEqual([]);
  });

  test('closes registration and every action', async () => {
    const { mgr, id } = await setup(knockout(), ['a', 'b'], false);
    await mgr.cancel({ tournamentId: id });
    await expect(mgr.register({ tournamentId: id, userId: 'c' })).rejects.toThrow();
    await expect(mgr.start(id)).rejects.toThrow();
    await expect(mgr.cancel({ tournamentId: id })).rejects.toThrow('already finished');
  });
});

describe('sendTournamentError', () => {
  const res = () => {
    const r: any = { status: jest.fn(() => r), json: jest.fn() };
    return r;
  };

  test('a rule refusal is a 400 with its message', () => {
    const r = res();
    sendTournamentError(r, new Error('Rebuy period ended'));
    expect(r.status).toHaveBeenCalledWith(400);
    expect(r.json).toHaveBeenCalledWith({ error: 'Rebuy period ended' });
  });

  test('a database failure is a generic 500', () => {
    const r = res();
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    sendTournamentError(r, Object.assign(new Error('relation "tournaments" does not exist'), { code: '42P01' }));
    expect(r.status).toHaveBeenCalledWith(500);
    expect(r.json).toHaveBeenCalledWith({ error: 'Something went wrong. Please try again.' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
