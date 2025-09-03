import shareHandler from '../../../pages/api/social/share';
import engagementHandler from '../../../pages/api/social/engagement';

// Return a stable singleton mock pool so the handler and test share the same instance
jest.mock('../../../src/lib/database/database-connection', () => {
  const pool = { query: jest.fn() };
  return { getDbPool: () => pool };
});

function mockReqRes(method: string, body?: any) {
  const req: any = { method, body };
  const json = jest.fn();
  const res: any = { status: jest.fn(() => res), json };
  return { req, res, json };
}

describe('Social API', () => {
  it('POST /api/social/share returns created record', async () => {
    const { getDbPool } = jest.requireMock('../../../src/lib/database/database-connection');
    (getDbPool as any)().query.mockResolvedValueOnce({ rows: [{ id: 's1', user_id: 'u1', kind: 'hand', ref_id: 'h1', visibility: 'public', message: null, platforms: [], payload: { handId: 'h1' }, share_slug: null, created_at: new Date('2024-01-01T00:00:00Z') }] });
    const { req, res, json } = mockReqRes('POST', { userId: 'u1', kind: 'hand', refId: 'h1', payload: { handId: 'h1' } });
    await shareHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ id: 's1', userId: 'u1', kind: 'hand', refId: 'h1' }));
  });

  it('POST /api/social/engagement returns counters', async () => {
    const { getDbPool } = jest.requireMock('../../../src/lib/database/database-connection');
    (getDbPool as any)().query.mockResolvedValueOnce({ rows: [{ share_id: 's1', metric: 'click', count: 5 }] });
    const { req, res, json } = mockReqRes('POST', { shareId: 's1', metric: 'click', inc: 1 });
    await engagementHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ shareId: 's1', metric: 'click', count: 5 });
  });
});
