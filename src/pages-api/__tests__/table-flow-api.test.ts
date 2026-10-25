import type { NextApiRequest, NextApiResponse } from 'next';

jest.mock('../../../src/lib/poker/engine-persistence', () => ({
  getOrRestoreEngine: jest.fn(),
  persistEngineState: jest.fn().mockResolvedValue('saved'),
  StaleGameStateError: class extends Error {},
  STALE_STATE_RESPONSE: { error: 'stale', code: 'STALE_GAME_STATE' },
}));
jest.mock('../../../src/lib/realtime/publisher', () => ({
  publishGameStateUpdate: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../src/lib/realtime/sequence', () => ({ nextSeq: jest.fn(() => 1) }));
jest.mock('../../../src/lib/poker/supabase-auto-runout', () => ({
  clearSupabaseAutoRunout: jest.fn(),
  runSupabaseAutoRunoutSync: jest.fn(),
}));
jest.mock('../../../src/lib/utils/post-hand-result', () => ({ postHandResultToChat: jest.fn() }));
jest.mock('../../../src/lib/server/run-it-twice-decision', () => ({
  resolveRunItTwiceDecision: jest.fn(async (opts: any) => ({ status: 'ok', state: opts.engine.getState() })),
}));
// Signed in as whoever the request claims to be (or 'a')
jest.mock('../../../src/lib/auth/auth-utils', () => ({
  requirePlayer: jest.fn(async (_req: unknown, _res: unknown, claimed?: unknown) => (claimed ? String(claimed) : 'a')),
}));

import timeoutHandler from '../../../pages/api/games/timeout';
import sitOutHandler from '../../../pages/api/games/sit-out';
import showCardsHandler from '../../../pages/api/games/show-cards';
import { getOrRestoreEngine } from '../../../src/lib/poker/engine-persistence';
import { publishGameStateUpdate } from '../../../src/lib/realtime/publisher';
import { resolveRunItTwiceDecision } from '../../../src/lib/server/run-it-twice-decision';
import { PokerEngine } from '../../../src/lib/poker/poker-engine';

const mk = (id: string, position: number): any => ({
  id, name: id, position, stack: 1000, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30,
});

function call(handler: (req: NextApiRequest, res: NextApiResponse) => unknown, body: Record<string, unknown>) {
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  return Promise.resolve(handler({ method: 'POST', body } as any, res)).then(() => ({
    status: res.status.mock.calls[0]?.[0],
    body: res.json.mock.calls[0]?.[0],
  }));
}

let engine: PokerEngine;
let now = 5_000_000;
beforeEach(() => {
  now = 5_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  engine = new PokerEngine('t', [mk('a', 1), mk('b', 2)], 1, 2);
  engine.startNewHand();
  (getOrRestoreEngine as jest.Mock).mockResolvedValue(engine);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe('/api/games/timeout', () => {
  it('refuses before the deadline and reports the time left', async () => {
    const out = await call(timeoutHandler, { tableId: 't', playerId: 'b' });
    expect(out.status).toBe(409);
    expect(out.body.code).toBe('NOT_TIMED_OUT');
    expect(out.body.remainingMs).toBeGreaterThan(0);
  });

  it('acts for the player once their time is up and broadcasts the result', async () => {
    const stalled = engine.getState().activePlayer;
    const other = stalled === 'a' ? 'b' : 'a';
    now = engine.getState().turnDeadline!;
    const out = await call(timeoutHandler, { tableId: 't', playerId: other, expectedTurnSeq: engine.getState().turnSeq });
    expect(out.status).toBe(200);
    // Heads-up preflop the button faces the big blind, so the clock folds them
    expect(engine.getState().players.find(p => p.id === stalled)!.isFolded).toBe(true);
    const sent = (publishGameStateUpdate as jest.Mock).mock.calls[0][1];
    expect(sent.lastAction).toMatchObject({ action: 'fold', playerId: stalled, reason: 'timeout' });
  });

  it('refuses a call for a turn that has already moved on', async () => {
    now = engine.getState().turnDeadline!;
    const out = await call(timeoutHandler, { tableId: 't', playerId: 'a', expectedTurnSeq: 0 });
    expect(out.status).toBe(409);
    expect(out.body.code).toBe('STALE_GAME_STATE');
  });

  it('only lets players in the game enforce the clock', async () => {
    now = engine.getState().turnDeadline!;
    const out = await call(timeoutHandler, { tableId: 't', playerId: 'stranger' });
    expect(out.status).toBe(403);
  });

  it('runs the board once when a Run It Twice decision times out', async () => {
    engine.setRunItTwicePrompt({
      playerId: 'b', reason: 'lowest-hand', createdAt: now, boardCardsCount: 0, eligiblePlayerIds: ['a', 'b'],
    });
    now = engine.getState().turnDeadline!;
    const out = await call(timeoutHandler, { tableId: 't', playerId: 'a' });
    expect(out.status).toBe(200);
    expect(resolveRunItTwiceDecision).toHaveBeenCalledWith(expect.objectContaining({ playerId: 'b', runs: 1, reason: 'timeout' }));
  });
});

describe('/api/games/sit-out', () => {
  it('sits the caller out and back in', async () => {
    let out = await call(sitOutHandler, { tableId: 't', playerId: 'b', sittingOut: true });
    expect(out.status).toBe(200);
    expect(engine.getState().players.find(p => p.id === 'b')!.isSittingOut).toBe(true);
    expect((publishGameStateUpdate as jest.Mock).mock.calls[0][1].lastAction).toEqual({ action: 'sit_out', playerId: 'b' });

    out = await call(sitOutHandler, { tableId: 't', playerId: 'b', sittingOut: false });
    expect(out.status).toBe(200);
    expect(engine.getState().players.find(p => p.id === 'b')!.isSittingOut).toBe(false);
  });

  it('rejects a missing flag and callers not in the game', async () => {
    expect((await call(sitOutHandler, { tableId: 't', playerId: 'b' })).status).toBe(400);
    expect((await call(sitOutHandler, { tableId: 't', playerId: 'stranger', sittingOut: true })).status).toBe(403);
  });
});

describe('/api/games/show-cards', () => {
  it('refuses during the hand', async () => {
    const out = await call(showCardsHandler, { tableId: 't', playerId: 'a' });
    expect(out.status).toBe(409);
  });

  it('turns the caller cards face up for the table after the hand', async () => {
    const s = engine.getState();
    engine.handleAction({ type: 'fold', playerId: s.activePlayer, tableId: 't', timestamp: now } as any);
    const winner = engine.getState().handWinners![0];
    const out = await call(showCardsHandler, { tableId: 't', playerId: winner });
    expect(out.status).toBe(200);
    const sent = (publishGameStateUpdate as jest.Mock).mock.calls[0][1];
    expect(sent.gameState.players.find((p: any) => p.id === winner).holeCards).toHaveLength(2);
  });
});
