import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '../../../pages/api/history/run-it-twice/verify';

jest.mock('pg', () => ({ Pool: jest.fn().mockImplementation(() => ({})) }));

jest.mock('../../../src/lib/api/rate-limit', () => ({
  rateLimit: jest.fn().mockReturnValue({ allowed: true, remaining: 1, resetAt: Date.now() + 60000 })
}));

const mockService: any = {
  listRunItTwiceOutcomes: jest.fn(),
};

jest.mock('../../../src/lib/services/hand-history-service', () => ({
  HandHistoryService: jest.fn().mockImplementation(() => mockService)
}));

function createRes() {
  const res: Partial<NextApiResponse> & { status: jest.Mock; json: jest.Mock } = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn()
  } as any;
  return res;
}

function createReq(method: string, query?: any): Partial<NextApiRequest> {
  return {
    method,
    query,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' } as any,
  } as any;
}

describe('RIT verify API', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns auditAvailable=false when metadata missing', async () => {
    mockService.listRunItTwiceOutcomes.mockResolvedValue([]);
    const req = createReq('GET', { handId: 'h1' });
    const res = createRes();
    await handler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.auditAvailable).toBe(false);
    expect(body.verified).toBe(false);
  });

  it('verifies provided metadata against hashChain', async () => {
    // Construct a deterministic example using rng-security
    const { generateRngSecurity } = require('../../lib/poker/rng-security');
    const { rng, seeds } = generateRngSecurity(2, 'room-x');
    mockService.listRunItTwiceOutcomes.mockResolvedValue([
      { id: 'x', handId: 'h1', boardNumber: 1, communityCards: [], winners: [], potAmount: 0 },
      { id: 'y', handId: 'h1', boardNumber: 2, communityCards: [], winners: [], potAmount: 0 },
    ]);
    const req = createReq('GET', {
      handId: 'h1',
      publicSeed: rng.verification.publicSeed,
      proof: rng.verification.proof,
      playerEntropy: rng.seedGeneration.playerEntropy,
      timestamp: rng.seedGeneration.timestamp,
      hashChain: JSON.stringify(seeds),
    });
    const res = createRes();
    await handler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.auditAvailable).toBe(true);
    expect(body.verified).toBe(true);
    expect(body.numberOfRuns).toBe(2);
  });
});
