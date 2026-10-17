import { test, expect } from '@playwright/test';
import {
  GameState,
  TestPlayer,
  Decision,
  loginAll,
  logoutAll,
  seatPlayers,
  setUpTable,
  clearTable,
  byId,
  chipsInPlay,
  toCall,
  checkOrCall,
  playHand,
  allVisibleCards,
  configuredCredentials,
} from '../helpers/players';

/**
 * Multi-player integration tests against the real API and database, using up to six
 * test accounts (TEST_USER1_* … TEST_USER6_*). Each test creates its own table named
 * "E2E multiplayer …" and stands everyone up when it finishes.
 *
 * Run against any deployment (Vercel preview or production) with PLAYWRIGHT_BASE_URL=https://…
 * (no local server is started), or against `npm run dev` by leaving it unset.
 */

const BUY_IN = 1000;
const SB = 5;
const BB = 10;

test.describe('Multi-player tables', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  let all: TestPlayer[] = [];
  let tableId: string | undefined;
  let seated: TestPlayer[] = [];

  test.beforeAll(async () => {
    test.skip(configuredCredentials().length < 6, 'Needs TEST_USER1_* … TEST_USER6_* credentials');
    all = await loginAll();
  });

  test.afterEach(async () => {
    await clearTable(tableId, seated);
    tableId = undefined;
    seated = [];
  });

  test.afterAll(async () => {
    await logoutAll(all);
  });

  async function table(players: TestPlayer[], opts: Parameters<typeof setUpTable>[1] = {}) {
    seated = players;
    const result = await setUpTable(players, { buyIn: BUY_IN, smallBlind: SB, bigBlind: BB, ...opts });
    tableId = result.tableId;
    return result;
  }

  test('six players check a hand down through every street to showdown', async () => {
    const { tableId: id, state: opening } = await table(all);

    expect(opening.stage).toBe('preflop');
    expect(opening.players).toHaveLength(6);
    expect(chipsInPlay(opening)).toBe(6 * BUY_IN);
    expect(opening.pot).toBe(SB + BB);
    expect(opening.players.filter(p => p.currentBet === SB)).toHaveLength(1);
    expect(opening.players.filter(p => p.currentBet === BB)).toHaveLength(1);

    const boardByStage: Record<string, number> = {};
    const { final, stagesSeen } = await playHand(id, all, {
      expectedChips: 6 * BUY_IN,
      decide: s => {
        boardByStage[s.stage] = s.communityCards.length;
        return checkOrCall(s);
      },
    });

    expect(stagesSeen).toEqual(['preflop', 'flop', 'turn', 'river', 'showdown']);
    expect(boardByStage).toEqual({ preflop: 0, flop: 3, turn: 4, river: 5 });
    expect(final.communityCards).toHaveLength(5);
    expect(final.pot).toBe(0);
    expect(chipsInPlay(final)).toBe(6 * BUY_IN);

    // Everyone limped for the big blind, so the pot was 60 and was paid out
    const winners = final.players.filter(p => p.stack > BUY_IN - BB);
    expect(winners.length).toBeGreaterThanOrEqual(1);

    // At showdown every hand is face up and no card was dealt twice
    const cards = allVisibleCards(final);
    expect(cards).toHaveLength(6 * 2 + 5);
    expect(new Set(cards).size).toBe(cards.length);
  });

  test('hole cards are private to each player and hidden from a spectator', async () => {
    const players = all.slice(0, 5);
    const spectator = all[5];
    const { tableId: id } = await table(players);

    for (const viewer of players) {
      const view = await viewer.state(id);
      for (const p of view.players) {
        if (p.id === viewer.id) {
          expect(p.holeCards, `${viewer.username} sees own cards`).toHaveLength(2);
        } else {
          expect(p.holeCards ?? [], `${viewer.username} must not see ${p.name}'s cards`).toHaveLength(0);
        }
      }
    }

    const spectatorView = await spectator.state(id);
    expect(spectatorView.players.every(p => !p.holeCards || p.holeCards.length === 0)).toBe(true);

    // A player who is not at the table can't act or restart it
    const before = spectatorView.turnSeq;
    const actRes = await spectator.act(id, 'check');
    expect(actRes.status()).toBeGreaterThanOrEqual(400);
    const startRes = await spectator.start(id);
    expect(startRes.status()).toBeGreaterThanOrEqual(400);
    expect((await players[0].state(id)).turnSeq).toBe(before);
  });

  test('only the active player can act, and nobody can act as someone else', async () => {
    const { tableId: id, state } = await table(all);
    const active = byId(all, state.activePlayer);
    const others = all.filter(p => p.id !== active.id);

    // Every other player is turned away while it is not their turn
    for (const p of others) {
      const res = await p.act(id, 'call', { expectedTurnSeq: state.turnSeq ?? 0 });
      expect(res.status(), `${p.username} acted out of turn`).toBe(400);
      expect((await res.json()).error).toMatch(/not player's turn/i);
    }

    // Claiming to be the active player is refused before the engine sees it
    const impostor = others[0];
    const spoof = await impostor.act(id, 'fold', { playerId: active.id, expectedTurnSeq: state.turnSeq ?? 0 });
    expect(spoof.status()).toBe(403);

    // None of that changed the table, and the real active player can still act
    const after = await active.state(id);
    expect(after.turnSeq).toBe(state.turnSeq);
    expect(after.activePlayer).toBe(active.id);
    expect(after.players.every(p => !p.isFolded)).toBe(true);
    const ok = await active.act(id, 'call', { expectedTurnSeq: state.turnSeq ?? 0 });
    expect(ok.status()).toBe(200);
  });

  test('an action sent on an old state is refused, and a double submit applies once', async () => {
    const { tableId: id, state } = await table(all);
    const seq = state.turnSeq ?? 0;
    const first = byId(all, state.activePlayer);

    const stale = await first.act(id, 'call', { expectedTurnSeq: seq - 1 });
    expect(stale.status()).toBe(409);

    // The same click sent twice at once: exactly one may land
    const [a, b] = await Promise.all([
      first.act(id, 'call', { expectedTurnSeq: seq }),
      first.act(id, 'call', { expectedTurnSeq: seq }),
    ]);
    const statuses = [a.status(), b.status()].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1], 'duplicate submit was applied twice').toBeGreaterThanOrEqual(400);

    const after = await first.state(id);
    expect(after.turnSeq).toBe(seq + 1);
    expect(after.activePlayer).not.toBe(first.id);
    expect(after.players.find(p => p.id === first.id)!.currentBet).toBe(BB);
    expect(chipsInPlay(after)).toBe(6 * BUY_IN);
  });

  test('when everyone folds to the big blind, the big blind wins the blinds', async () => {
    const { tableId: id, state } = await table(all);
    const sbId = state.players.find(p => p.currentBet === SB)!.id;
    const bbId = state.players.find(p => p.currentBet === BB)!.id;

    const { final, stagesSeen } = await playHand(id, all, {
      expectedChips: 6 * BUY_IN,
      decide: () => ({ action: 'fold' }),
    });

    expect(stagesSeen).toEqual(['preflop', 'showdown']);
    expect(final.communityCards).toHaveLength(0);
    for (const p of final.players) {
      const expected = p.id === bbId ? BUY_IN + SB : p.id === sbId ? BUY_IN - SB : BUY_IN;
      expect(p.stack, `${p.name}'s stack`).toBe(expected);
    }
    expect(final.players.filter(p => !p.isFolded).map(p => p.id)).toEqual([bbId]);
  });

  test('a raise, a re-raise and callers: bets and the pot add up', async () => {
    const { tableId: id } = await table(all);
    let raises = 0;

    const decide = (s: GameState): Decision => {
      // The first two players to act raise (to 30, then to 90); everyone after calls
      if (s.stage === 'preflop' && raises < 2) {
        raises++;
        return { action: 'raise', amount: raises === 1 ? 3 * BB : 9 * BB };
      }
      return checkOrCall(s);
    };

    const preflopEnd: { state?: GameState } = {};
    const { final, stagesSeen } = await playHand(id, all, {
      expectedChips: 6 * BUY_IN,
      decide: s => {
        if (s.stage === 'flop' && !preflopEnd.state) preflopEnd.state = s;
        return decide(s);
      },
    });

    expect(raises).toBe(2);
    // Six players each put 90 in before the flop
    expect(preflopEnd.state!.pot).toBe(6 * 9 * BB);
    expect(preflopEnd.state!.players.every(p => p.stack === BUY_IN - 9 * BB)).toBe(true);
    expect(stagesSeen[stagesSeen.length - 1]).toBe('showdown');
    expect(chipsInPlay(final)).toBe(6 * BUY_IN);
  });

  test('all-in and a call run the board out to showdown', async () => {
    const { tableId: id, state } = await table(all);
    const shover = state.activePlayer;
    let caller: string | undefined;

    const { final } = await playHand(id, all, {
      expectedChips: 6 * BUY_IN,
      decide: s => {
        if (s.activePlayer === shover) return { action: 'raise', amount: BUY_IN };
        if (!caller) {
          caller = s.activePlayer;
          return { action: 'call' };
        }
        return { action: 'fold' };
      },
    });

    expect(final.stage).toBe('showdown');
    expect(final.communityCards).toHaveLength(5);
    const shoverFinal = final.players.find(p => p.id === shover)!;
    const callerFinal = final.players.find(p => p.id === caller)!;
    // The two all-in players share the 2000 they put in plus the folded blinds
    expect(shoverFinal.stack + callerFinal.stack).toBe(2 * BUY_IN + SB + BB);
    expect(chipsInPlay(final)).toBe(6 * BUY_IN);

    // A player who folded can see both all-in hands
    const folder = all.find(p => p.id !== shover && p.id !== caller)!;
    const view = await folder.state(id);
    expect(view.players.find(p => p.id === shover)!.holeCards).toHaveLength(2);
    expect(view.players.find(p => p.id === caller)!.holeCards).toHaveLength(2);
  });

  test('five hands in a row: the button moves and no chips appear or vanish', async () => {
    const { tableId: id, state: opening } = await table(all);
    const buttons = [opening.dealerPosition];

    // Deterministic mix of folds, bets, raises and calls
    let seed = 12345;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const mixed = (s: GameState): Decision => {
      const me = s.players.find(p => p.id === s.activePlayer)!;
      const owe = toCall(s);
      const r = rand();
      if (owe > 0 && r < 0.2) return { action: 'fold' };
      if (r > 0.85) {
        const target = (s.currentBet || 0) + Math.max(s.minRaise || BB, BB);
        if (target < me.stack + me.currentBet) {
          return s.currentBet > 0 ? { action: 'raise', amount: target } : { action: 'bet', amount: target };
        }
      }
      return checkOrCall(s);
    };

    for (let hand = 1; hand <= 5; hand++) {
      const { final } = await playHand(id, all, { expectedChips: 6 * BUY_IN, decide: mixed });
      expect(final.stage).toBe('showdown');
      if (hand === 5) break;

      // Any seated player can deal the next hand, but not while one is running
      const next = await all[hand % all.length].nextHand(id);
      expect(next.status(), `next hand ${hand + 1}`).toBe(200);
      const fresh = await all[0].state(id);
      expect(fresh.stage).toBe('preflop');
      expect(chipsInPlay(fresh)).toBe(6 * BUY_IN);
      buttons.push(fresh.dealerPosition);
      expect(fresh.dealerPosition, `button stayed put going into hand ${hand + 1}`).not.toBe(buttons[buttons.length - 2]);

      const early = await all[0].nextHand(id);
      expect(early.status(), 'next hand while a hand is running').toBe(409);
    }
  });

  test('Omaha with four players: four hole cards each, played to showdown', async () => {
    const players = all.slice(0, 4);
    const { tableId: id, state } = await table(players, { variant: 'omaha', bettingMode: 'pot-limit' });

    expect(state.variant).toBe('omaha');
    for (const viewer of players) {
      const me = (await viewer.state(id)).players.find(p => p.id === viewer.id)!;
      expect(me.holeCards).toHaveLength(4);
    }

    const { final, stagesSeen } = await playHand(id, players, { expectedChips: 4 * BUY_IN });
    expect(stagesSeen).toEqual(['preflop', 'flop', 'turn', 'river', 'showdown']);
    const cards = allVisibleCards(final);
    expect(cards).toHaveLength(4 * 4 + 5);
    expect(new Set(cards).size).toBe(cards.length);
  });

  test('seven-card stud with six players: bring-in, up cards public, down cards private', async () => {
    const { tableId: id, state } = await table(all, { variant: 'seven-card-stud' });

    expect(state.stage).toBe('third');
    expect(state.studState?.bringIn?.amount).toBe(SB);
    // The bring-in has already acted, so someone else is first
    expect(state.activePlayer).not.toBe(state.studState?.bringIn?.player);

    for (const viewer of all) {
      const view = await viewer.state(id);
      for (const [pid, cards] of Object.entries(view.studState!.playerCards)) {
        expect(cards.upCards, 'one up card on third street').toHaveLength(1);
        expect(cards.downCards, pid === viewer.id ? 'own down cards' : 'others\' down cards hidden').toHaveLength(pid === viewer.id ? 2 : 0);
      }
    }

    const { final, stagesSeen } = await playHand(id, all, { expectedChips: 6 * BUY_IN });
    expect(stagesSeen).toEqual(['third', 'fourth', 'fifth', 'sixth', 'seventh', 'showdown']);
    for (const cards of Object.values(final.studState!.playerCards)) {
      expect(cards.downCards).toHaveLength(3);
      expect(cards.upCards).toHaveLength(4);
    }
    const dealt = allVisibleCards(final);
    expect(dealt).toHaveLength(6 * 7);
    expect(new Set(dealt).size).toBe(dealt.length);
  });
});

test.describe('Seats with several players', () => {
  test.describe.configure({ mode: 'serial' });

  let all: TestPlayer[] = [];
  let tableId: string | undefined;

  test.beforeAll(async () => {
    test.skip(configuredCredentials().length < 6, 'Needs TEST_USER1_* … TEST_USER6_* credentials');
    all = await loginAll();
  });

  test.afterEach(async () => {
    await clearTable(tableId, all);
    tableId = undefined;
  });

  test.afterAll(async () => {
    await logoutAll(all);
  });

  test('seat conflicts, seat spoofing and standing up', async () => {
    const [p1, p2, p3, p4] = all;
    tableId = await p1.createRoom({ buyIn: BUY_IN });

    expect((await p1.claimSeat(tableId, 1)).status()).toBe(200);
    expect((await p2.claimSeat(tableId, 1)).status(), 'took an occupied seat').toBe(409);
    expect((await p1.claimSeat(tableId, 2)).status(), 'one player in two seats').toBe(409);

    const spoof = await p2.post('/api/games/seats/claim', { tableId, seatNumber: 2, playerId: p1.id, playerName: p1.username });
    expect(spoof.status()).toBe(403);

    // Someone else's seat can't be vacated
    const steal = await p2.post('/api/games/seats/stand', { tableId, seatNumber: 1 });
    expect(steal.status()).toBe(403);

    // The stack comes from the room's buy-in, not from the request
    const rich = await p2.post('/api/games/seats/claim', { tableId, seatNumber: 2, playerName: p2.username, chips: 1_000_000 });
    expect(rich.status()).toBe(200);
    expect((await rich.json()).chips).toBe(BUY_IN);

    // Standing frees the seat for someone else
    expect((await p1.stand(tableId)).status()).toBe(200);
    expect((await p3.claimSeat(tableId, 1)).status()).toBe(200);

    // Unauthenticated requests are refused
    const anon = await p4.api.post('/api/games/seats/claim', { data: { tableId, seatNumber: 5, playerName: 'anon' } });
    expect(anon.status()).toBe(401);
  });

  test('two players grabbing the same empty seat at once: only one gets it', async () => {
    const [p1, p2, p3, p4] = all;
    tableId = await p1.createRoom({ buyIn: BUY_IN });

    for (const seat of [3, 4, 5]) {
      const [a, b] = await Promise.all([p1.claimSeat(tableId, seat), p2.claimSeat(tableId, seat)]);
      const ok = [a, b].filter(r => r.status() === 200);
      expect(ok, `both players got seat ${seat}`).toHaveLength(1);
      // Stand the winner up for the next round
      await (a.status() === 200 ? p1 : p2).stand(tableId);
    }

    // Four players race for four different seats: all should succeed
    const results = await Promise.all([p1, p2, p3, p4].map((p, i) => p.claimSeat(tableId!, i + 1)));
    expect(results.map(r => r.status())).toEqual([200, 200, 200, 200]);
    const stored = await (await p1.get(`/api/games/seats/state?tableId=${tableId}`)).json();
    const occupants = Object.values(stored.seats).filter(Boolean).map((s: any) => s.playerId).sort();
    expect(occupants, 'a concurrent claim overwrote another seat').toEqual([p1.id, p2.id, p3.id, p4.id].sort());
  });

  test('a game needs two seated players, and only a seated player can start it', async () => {
    const [p1, p2, p3] = all;
    tableId = await p1.createRoom({ buyIn: BUY_IN });

    await seatPlayers(tableId, [p1]);
    expect((await p1.start(tableId)).status(), 'started with one player').toBe(400);

    expect((await p2.claimSeat(tableId, 2)).status()).toBe(200);
    expect((await p3.start(tableId)).status(), 'started by someone not seated').toBe(403);

    const res = await p2.start(tableId);
    expect(res.status()).toBe(201);
    expect((await p1.start(tableId)).status(), 'restarted a live hand').toBe(409);
  });
});
