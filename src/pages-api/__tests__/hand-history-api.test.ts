import type { NextApiRequest, NextApiResponse } from 'next';

import recordHandler from '../../../pages/api/history/hands/record';
import addRitHandler from '../../../pages/api/history/run-it-twice/add';
import listRitHandler from '../../../pages/api/history/run-it-twice/list';

jest.mock('pg', () => ({ Pool: jest.fn().mockImplementation(() => ({})) }));

jest.mock('../../../src/lib/api/rate-limit', () => ({
  rateLimit: jest.fn().mockReturnValue({ allowed: true, remaining: 1, resetAt: Date.now() + 60000 })
}));

const mockService: any = {
  recordHand: jest.fn(),
  addRunItTwiceOutcome: jest.fn(),
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

function createReq(method: string, body?: any, query?: any): Partial<NextApiRequest> {
  return {
    method,
    body,
    query,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' } as any
  } as any;
}

describe('Hand History API (US-021)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POST /api/history/hands/record', async () => {
    const payload = { id: 'hh-1' } as any;
    mockService.recordHand.mockResolvedValue(payload);
    const req = createReq('POST', { tableId: 'g1', handId: '1', actionSequence: [{}], communityCards: [], results: { winners: [], pot: [], totalPot: 0, rake: 0 }, startedAt: new Date(), endedAt: new Date(Date.now()+1000) });
    const res = createRes();
    await recordHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(payload);
  });

  it('POST /api/history/run-it-twice/add', async () => {
    const out = { id: 'rit-1' } as any;
    mockService.addRunItTwiceOutcome.mockResolvedValue(out);
    const req = createReq('POST', { handId: 'h1', boardNumber: 1, communityCards: [], winners: [], potAmount: 10 });
    const res = createRes();
    await addRitHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(out);
  });

  it('GET /api/history/run-it-twice/list', async () => {
    const list = [] as any;
    mockService.listRunItTwiceOutcomes.mockResolvedValue(list);
    const req = createReq('GET', undefined, { handId: 'h1' });
    const res = createRes();
    await listRitHandler(req as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(list);
  });
});
