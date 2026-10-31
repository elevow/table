/**
 * @jest-environment node
 */
import type { NextApiRequest, NextApiResponse } from 'next';

// Records the permission each route asks requirePlayer for, then stops the request there
const mockRequirePlayer = jest.fn(async (_req: any, res: any) => {
  res.status(403).json({ code: 'PERMISSION_DENIED' });
  return null;
});
jest.mock('../../lib/auth/auth-utils', () => ({
  requirePlayer: (...args: any[]) => mockRequirePlayer(...(args as [any, any])),
  getAuthenticatedUserId: jest.fn().mockResolvedValue(null),
}));
// Routes that also check limits read the caller's access, then check the permission themselves;
// this caller holds none, so the permission they check is the one refused
const mockRequirePlayerAccess = jest.fn(async () => ({ userId: 'u1', permissions: new Set<string>(), limits: {}, sanction: null }));
const mockDenied = jest.fn((res: any, _permission: string) => res.status(403).json({ code: 'PERMISSION_DENIED' }));
jest.mock('../../lib/auth/access-control', () => ({
  requirePlayerAccess: () => mockRequirePlayerAccess(),
  hasPermission: (access: { permissions: Set<string> }, permission: string) => access.permissions.has(permission),
  sendPermissionDenied: (res: any, permission: string) => mockDenied(res, permission),
  getLimit: () => null,
  sendLimitReached: jest.fn(),
}));
jest.mock('../../lib/api/rate-limit', () => ({ rateLimit: jest.fn().mockReturnValue({ allowed: true }) }));
jest.mock('../../lib/database/pool', () => ({ getPool: jest.fn(() => ({ query: jest.fn().mockResolvedValue({ rows: [] }) })) }));
// The routes stop at requirePlayer, so nothing is ever broadcast
jest.mock('../../lib/realtime/publisher', () => ({}));

import action from '../../../pages/api/games/action';
import chooseVariant from '../../../pages/api/games/choose-variant';
import claimSeat from '../../../pages/api/games/seats/claim';
import waitlist from '../../../pages/api/games/waitlist';
import straddle from '../../../pages/api/games/straddle';
import enableRit from '../../../pages/api/games/enable-rit';
import rebuyDecision from '../../../pages/api/games/rebuy-decision';
import showCards from '../../../pages/api/games/show-cards';
import react from '../../../pages/api/games/react';
import startGame from '../../../pages/api/games/start';
import nextHand from '../../../pages/api/games/next-hand';
import rabbitHunt from '../../../pages/api/rabbit-hunt/request';
import chatSend from '../../../pages/api/chat/send';
import chatReact from '../../../pages/api/chat/reactions/add';
import tournamentRegister from '../../../pages/api/tournaments/register';
import tournamentRebuy from '../../../pages/api/tournaments/rebuy';
import tournamentAddOn from '../../../pages/api/tournaments/add-on';
import standUp from '../../../pages/api/games/seats/stand';
import sitOut from '../../../pages/api/games/sit-out';

type Handler = (req: NextApiRequest, res: NextApiResponse) => unknown;

const cases: Array<[string, Handler, Record<string, unknown>, string | undefined]> = [
  ['betting action', action, { tableId: 't', action: 'call' }, 'game.play'],
  ['dealer\'s choice pick', chooseVariant, { tableId: 't', variant: 'omaha' }, 'game.play'],
  ['taking a seat', claimSeat, { tableId: 't', seatNumber: 1 }, 'table.join'],
  ['joining the waitlist', waitlist, { tableId: 't', join: true }, 'table.waitlist'],
  ['leaving the waitlist', waitlist, { tableId: 't', join: false }, undefined],
  ['asking to straddle', straddle, { tableId: 't', wants: true }, 'game.straddle'],
  ['cancelling a straddle', straddle, { tableId: 't', wants: false }, undefined],
  ['running it twice', enableRit, { tableId: 't', runs: 2 }, 'game.run_it_twice'],
  ['running it once', enableRit, { tableId: 't', runs: 1 }, undefined],
  ['accepting a rebuy', rebuyDecision, { tableId: 't', decision: 'yes' }, 'game.rebuy'],
  ['declining a rebuy', rebuyDecision, { tableId: 't', decision: 'no' }, undefined],
  ['showing cards', showCards, { tableId: 't' }, 'game.show_cards'],
  ['table reaction', react, { tableId: 't', reaction: 'nice' }, 'game.react'],
  // Any seated player can start and deal, but not one barred from playing
  ['starting the game', startGame, { tableId: 't' }, 'game.play'],
  ['dealing the next hand', nextHand, { tableId: 't' }, 'game.play'],
  ['rabbit hunting', rabbitHunt, { roomId: 'r' }, 'game.rabbit_hunt'],
  ['table chat', chatSend, { roomId: 'r', message: 'hi' }, 'chat.send'],
  ['private message', chatSend, { isPrivate: true, recipientId: 'u2', message: 'hi' }, 'chat.private'],
  ['chat reaction', chatReact, { messageId: 'm', emoji: 'x' }, 'chat.send'],
  ['tournament registration', tournamentRegister, { tournamentId: 'x' }, 'tournament.register'],
  ['tournament rebuy', tournamentRebuy, { tournamentId: 'x' }, 'game.rebuy'],
  ['tournament add-on', tournamentAddOn, { tournamentId: 'x' }, 'game.rebuy'],
  // Leaving a table must always work, whatever the user's permissions
  ['standing up', standUp, { tableId: 't', seatNumber: 1 }, undefined],
  ['sitting out', sitOut, { tableId: 't', sittingOut: true }, undefined],
];

describe('route permissions', () => {
  beforeEach(() => {
    mockRequirePlayer.mockClear();
    mockRequirePlayerAccess.mockClear();
    mockDenied.mockClear();
  });

  test.each(cases)('%s', async (_name, handler, body, permission) => {
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), setHeader: jest.fn() };
    const req = { method: 'POST', body, query: {}, headers: {}, cookies: {}, socket: {} } as unknown as NextApiRequest;
    await handler(req, res);
    expect(mockRequirePlayer.mock.calls.length + mockRequirePlayerAccess.mock.calls.length).toBe(1);
    const asked = mockRequirePlayer.mock.calls.length ? mockRequirePlayer.mock.calls[0][3] : mockDenied.mock.calls[0]?.[1];
    expect(asked).toBe(permission);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
