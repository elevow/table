import { TournamentManager } from '../tournament-manager';
import { MemoryTournamentStore } from '../tournament-store';
import { bountyPool, chipsInPlay, payoutTable, prizePool } from '../tournament-money';
import { createDefaultFreezeoutConfig, createRebuyAddOnConfig } from '../tournament-utils';
import type { TournamentConfig } from '../../../types/tournament';
import type { TournamentState } from '../../../types/tournament-management';

async function started(players: string[], config: TournamentConfig, random = Math.random) {
  const mgr = new TournamentManager(new MemoryTournamentStore(), random);
  const { id } = await mgr.create({ name: 'Money', config });
  for (const userId of players) await mgr.register({ tournamentId: id, userId });
  await mgr.start(id);
  return { mgr, id, read: async () => (await mgr.get(id))! };
}

const knockout = (type: 'standard' | 'progressive', amount = 2): TournamentConfig => ({
  ...createDefaultFreezeoutConfig(),
  buyIn: 10,
  entryFee: 1,
  bounty: { amount, type },
});

const totalWon = (t: TournamentState) => Object.values(t.bountyWinnings || {}).reduce((a, b) => a + b, 0);
const outstanding = (t: TournamentState) => Object.values(t.bounties || {}).reduce((a, b) => a + b, 0);

describe('prize pool', () => {
  test('adds up buy-ins, rebuys and add-ons, less the house fees', async () => {
    // $50 buy-in; rebuys and add-ons cost $50 and $60 with a 10% fee
    const { mgr, id, read } = await started(['a', 'b', 'c'], createRebuyAddOnConfig());
    await mgr.rebuy({ tournamentId: id, userId: 'a' });
    await mgr.rebuy({ tournamentId: id, userId: 'b' });
    const t = await read();
    expect(prizePool(t)).toBe(3 * 50 + 2 * 45);
    expect(chipsInPlay(t)).toBe(3 * 20000 + 2 * 20000);
  });

  test('the entry fee and bounties stay out of the prize pool', async () => {
    const { read } = await started(['a', 'b', 'c'], knockout('standard'));
    const t = await read();
    expect(prizePool(t)).toBe(30);
    expect(bountyPool(t)).toBe(6);
  });

  test('payouts share out the whole pool to the cent', async () => {
    const { read } = await started(['a', 'b', 'c'], { ...createDefaultFreezeoutConfig(), buyIn: 3.33 });
    const payouts = payoutTable(await read()); // $9.99 at 50/30/20
    expect(payouts.map(p => p.place)).toEqual([1, 2, 3]);
    payouts.forEach((p, i) => expect(Math.abs(p.amount - 9.99 * [0.5, 0.3, 0.2][i])).toBeLessThanOrEqual(0.01));
    expect(Math.round(payouts.reduce((s, p) => s + p.amount, 0) * 100)).toBe(999);
  });
});

describe('standard knockouts', () => {
  test('the player who makes the knockout wins the whole bounty', async () => {
    const { mgr, id } = await started(['a', 'b', 'c'], knockout('standard'));
    const t = await mgr.eliminate({ tournamentId: id, userId: 'c', eliminatedBy: 'a' });
    expect(t.bountyWinnings).toEqual({ a: 2 });
    expect(t.bounties).toEqual({ a: 2, b: 2 });
    expect(t.eliminationRecords![0]).toMatchObject({ userId: 'c', eliminatedBy: 'a', bounty: 2 });
  });

  test('the winner collects their own bounty, so every bounty is paid out', async () => {
    const { mgr, id } = await started(['a', 'b', 'c'], knockout('standard'));
    await mgr.eliminate({ tournamentId: id, userId: 'c', eliminatedBy: 'a' });
    const t = await mgr.eliminate({ tournamentId: id, userId: 'b', eliminatedBy: 'a' });
    expect(t.status).toBe('completed');
    expect(t.bountyWinnings).toEqual({ a: 6 });
    expect(t.bounties).toEqual({});
  });
});

describe('progressive knockouts', () => {
  test('half the bounty is cash and half goes onto the knocker\'s own bounty', async () => {
    const { mgr, id } = await started(['a', 'b', 'c'], knockout('progressive'));
    let t = await mgr.eliminate({ tournamentId: id, userId: 'c', eliminatedBy: 'a' });
    expect(t.bountyWinnings).toEqual({ a: 1 });
    expect(t.bounties).toEqual({ a: 3, b: 2 });

    // b takes a's grown bounty: $1.50 cash, $1.50 onto b's bounty; b then collects their own $3.50
    t = await mgr.eliminate({ tournamentId: id, userId: 'a', eliminatedBy: 'b' });
    expect(t.status).toBe('completed');
    expect(t.bountyWinnings).toEqual({ a: 1, b: 1.5 + 3.5 });
    expect(totalWon(t)).toBe(6);
  });

  test('odd cents are split without losing any', async () => {
    const { mgr, id } = await started(['a', 'b'], knockout('progressive', 0.05));
    const t = await mgr.eliminate({ tournamentId: id, userId: 'b', eliminatedBy: 'a' });
    expect(totalWon(t)).toBeCloseTo(0.1, 10);
  });
});

describe('knockout rules', () => {
  test('a bounty tournament needs to know who made the knockout', async () => {
    const { mgr, id } = await started(['a', 'b', 'c'], knockout('standard'));
    await expect(mgr.eliminate({ tournamentId: id, userId: 'c' })).rejects.toThrow('Say who knocked the player out');
    await expect(mgr.eliminate({ tournamentId: id, userId: 'c', eliminatedBy: 'c' })).rejects.toThrow('cannot knock themselves out');
    await mgr.eliminate({ tournamentId: id, userId: 'c', eliminatedBy: 'a' });
    await expect(mgr.eliminate({ tournamentId: id, userId: 'b', eliminatedBy: 'c' })).rejects.toThrow('must still be in the tournament');
  });

  test('without bounties, who made the knockout is optional and recorded when given', async () => {
    const { mgr, id } = await started(['a', 'b', 'c'], createDefaultFreezeoutConfig());
    const t = await mgr.eliminate({ tournamentId: id, userId: 'c', eliminatedBy: 'b' });
    expect(t.eliminationRecords![0]).toEqual(expect.objectContaining({ userId: 'c', eliminatedBy: 'b' }));
    expect(t.eliminationRecords![0]).not.toHaveProperty('bounty');
    await mgr.eliminate({ tournamentId: id, userId: 'b' });
  });

  test('a rebuy buys a fresh bounty for a returning player, and adds to the bounty of one still in', async () => {
    const config = { ...createRebuyAddOnConfig(), bounty: { amount: 5, type: 'progressive' as const } };
    const { mgr, id, read } = await started(['a', 'b', 'c'], config);
    await mgr.eliminate({ tournamentId: id, userId: 'c', eliminatedBy: 'a' }); // a: $2.50 cash, bounty 7.50
    await mgr.rebuy({ tournamentId: id, userId: 'c' });
    await mgr.rebuy({ tournamentId: id, userId: 'b' });
    const t = await read();
    expect(t.bounties).toEqual({ a: 7.5, b: 10, c: 5 });
    expect(t.bountyWinnings).toEqual({ a: 2.5 });
    expect(bountyPool(t)).toBe(5 * 5); // three entries and two rebuys
    expect(outstanding(t) + totalWon(t)).toBe(bountyPool(t));
  });

  test.each(['standard', 'progressive'] as const)('every %s bounty dollar put up is paid out by the end', async type => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const field = Array.from({ length: 20 }, (_, i) => `p${i + 1}`);
    const { mgr, id, read } = await started(field, knockout(type, 3), random);
    let t = await read();
    while (t.status !== 'completed') {
      const left = field.filter(p => !t.eliminatedPlayers.includes(p));
      const out = left[Math.floor(random() * left.length)];
      const by = left.filter(p => p !== out)[Math.floor(random() * (left.length - 1))];
      t = await mgr.eliminate({ tournamentId: id, userId: out, eliminatedBy: by });
      expect(outstanding(t) + totalWon(t)).toBeCloseTo(bountyPool(t), 6);
    }
    expect(outstanding(t)).toBe(0);
    expect(totalWon(t)).toBeCloseTo(60, 6);
  });
});
