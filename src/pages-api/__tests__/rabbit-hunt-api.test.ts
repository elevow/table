import type { NextApiRequest, NextApiResponse } from 'next';
import requestHandler from '../../../pages/api/rabbit-hunt/request';
import listHandler from '../../../pages/api/rabbit-hunt/list';
import cooldownHandler from '../../../pages/api/rabbit-hunt/cooldown';
import previewHandler from '../../../pages/api/rabbit-hunt/preview';

jest.mock('pg', () => ({ Pool: jest.fn().mockImplementation(() => ({})) }));
jest.mock('../../../src/lib/api/rate-limit', () => ({ rateLimit: jest.fn().mockReturnValue({ allowed: true, remaining: 1, resetAt: Date.now() + 60000 }) }));

// Signed in as u1
jest.mock('../../../src/lib/auth/auth-utils', () => ({
  getAuthenticatedUserId: jest.fn().mockResolvedValue('u1'),
  requirePlayer: jest.fn(async (_req: unknown, res: any, claimed?: unknown) => {
    if (claimed != null && claimed !== '' && claimed !== 'u1') {
      res.status(403).json({ error: 'playerId does not match the authenticated user' });
      return null;
    }
    return 'u1';
  }),
}));

const mockService: any = {
  requestReveal: jest.fn(),
  listReveals: jest.fn(),
  getCooldown: jest.fn(),
  preview: jest.fn(),
};

jest.mock('../../../src/lib/services/rabbit-hunt-service', () => ({
  RabbitHuntService: jest.fn().mockImplementation(() => mockService),
}));

function resHelper() {
  const res: Partial<NextApiResponse> & { status: jest.Mock; json: jest.Mock } = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as any;
  return res;
}

function reqHelper(method: string, body?: any, query?: any): Partial<NextApiRequest> {
  return { method, body, query, headers: {}, socket: { remoteAddress: '127.0.0.1' } as any } as any;
}

describe('Rabbit Hunt API (US-024)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POST /api/rabbit-hunt/request returns created record', async () => {
    mockService.requestReveal.mockResolvedValue({ id: 'rh1' });
    const req = reqHelper('POST', { handId: 'h1', userId: 'u1', street: 'river', revealedCards: ['Ah'], remainingDeck: ['2d'] });
    const res = resHelper();
    await requestHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: 'rh1' });
  });

  it('POST /api/rabbit-hunt/request refuses to record for another user', async () => {
    const req = reqHelper('POST', { handId: 'h1', userId: 'someone-else', street: 'river', revealedCards: ['Ah'], remainingDeck: ['2d'] });
    const res = resHelper();
    await requestHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockService.requestReveal).not.toHaveBeenCalled();
  });

  it('GET /api/rabbit-hunt/list returns items', async () => {
    mockService.listReveals.mockResolvedValue([{ id: 'rh1' }]);
    const req = reqHelper('GET', undefined, { handId: 'h1', limit: '10' });
    const res = resHelper();
    await listHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ items: [{ id: 'rh1' }] });
  });

  it('GET /api/rabbit-hunt/cooldown returns cooldown state', async () => {
    mockService.getCooldown.mockResolvedValue({ userId: 'u1' });
    const req = reqHelper('GET', undefined, { userId: 'u1' });
    const res = resHelper();
    await cooldownHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ cooldown: { userId: 'u1' } });
  });

  it('GET /api/rabbit-hunt/preview returns preview payload', async () => {
    mockService.preview.mockResolvedValue({ street: 'flop', revealedCards: ['Ah','Kd','Qs'], remainingDeck: ['2d'] });
  const req = reqHelper('GET', undefined, { roomId: 'room1', street: 'flop', knownCards: 'As,Ks', communityCards: '', userId: 'u1' });
    const res = resHelper();
    await previewHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ street: 'flop', revealedCards: ['Ah','Kd','Qs'], remainingDeck: ['2d'] });
  });

  it('GET /api/rabbit-hunt/preview uses the session user, not a claimed header or query userId', async () => {
    mockService.preview.mockResolvedValue({ street: 'flop', revealedCards: [], remainingDeck: [] });
    const req = reqHelper('GET', undefined, { roomId: 'room1', street: 'flop', userId: 'victim' });
    (req.headers as any)['x-user-id'] = 'victim';
    const res = resHelper();
    await previewHandler(req as any, res as any);
    expect(mockService.preview).toHaveBeenCalledWith(expect.objectContaining({ callerUserId: 'u1' }));
  });
});
