import type { NextApiRequest, NextApiResponse } from 'next';
import requestHandler from '../../../pages/api/rabbit-hunt/request';
import listHandler from '../../../pages/api/rabbit-hunt/list';
import cooldownHandler from '../../../pages/api/rabbit-hunt/cooldown';

jest.mock('pg', () => ({ Pool: jest.fn().mockImplementation(() => ({})) }));
jest.mock('../../../src/lib/api/rate-limit', () => ({ rateLimit: jest.fn().mockReturnValue({ allowed: true, remaining: 1, resetAt: Date.now() + 60000 }) }));

const mockService: any = {
  requestReveal: jest.fn(),
  listReveals: jest.fn(),
  getCooldown: jest.fn(),
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
});
