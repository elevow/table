import type { NextApiRequest, NextApiResponse } from 'next';

import createHandler from '../../../pages/api/tournaments/create';
import registerHandler from '../../../pages/api/tournaments/register';
import startHandler from '../../../pages/api/tournaments/start';
import advanceHandler from '../../../pages/api/tournaments/advance-level';
import endBreakHandler from '../../../pages/api/tournaments/end-break';
import pauseHandler from '../../../pages/api/tournaments/pause';
import resumeHandler from '../../../pages/api/tournaments/resume';
import payoutsHandler from '../../../pages/api/tournaments/payouts';
import getHandler from '../../../pages/api/tournaments/get';
import reportHandler from '../../../pages/api/tournaments/report';
import rebuyHandler from '../../../pages/api/tournaments/rebuy';
import addOnHandler from '../../../pages/api/tournaments/add-on';

import { createDefaultFreezeoutConfig } from '../../../src/lib/tournament/tournament-utils';

// Mock rate limiter
jest.mock('../../../src/lib/api/rate-limit', () => ({
  rateLimit: jest.fn().mockReturnValue({ allowed: true, remaining: 1, resetAt: Date.now() + 60000 })
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

describe('Tournaments API routes (US-058)', () => {
  test('end-to-end lifecycle via API', async () => {
    const cfg = createDefaultFreezeoutConfig();
    // Create
    const res1 = createRes();
    await createHandler(createReq('POST', { name: 'Weekly', config: cfg }) as any, res1 as any);
    expect(res1.status).toHaveBeenCalledWith(201);
    const created = res1.json.mock.calls[0][0];
    expect(created.status).toBe('setup');

    // Register
    const res2 = createRes();
    await registerHandler(createReq('POST', { tournamentId: created.id, userId: 'u1' }) as any, res2 as any);
    expect(res2.status).toHaveBeenCalledWith(200);

    const res3 = createRes();
    await registerHandler(createReq('POST', { tournamentId: created.id, userId: 'u2' }) as any, res3 as any);
    expect(res3.status).toHaveBeenCalledWith(200);

    // Start
    const res4 = createRes();
    await startHandler(createReq('POST', { tournamentId: created.id }) as any, res4 as any);
    expect(res4.status).toHaveBeenCalledWith(200);
    const started = res4.json.mock.calls[0][0];
    expect(started.status).toBe('running');

    // Advance level then hit break
    const res5 = createRes();
    await advanceHandler(createReq('POST', { tournamentId: created.id }) as any, res5 as any);
    expect(res5.status).toHaveBeenCalledWith(200);
    const afterAdv1 = res5.json.mock.calls[0][0];
    expect(afterAdv1.status).toBe('running');

    const res6 = createRes();
    await advanceHandler(createReq('POST', { tournamentId: created.id }) as any, res6 as any);
    expect(res6.status).toHaveBeenCalledWith(200);
    const onBreak = res6.json.mock.calls[0][0];
    expect(onBreak.status).toBe('on-break');

    // End break
    const res7 = createRes();
    await endBreakHandler(createReq('POST', { tournamentId: created.id }) as any, res7 as any);
    expect(res7.status).toHaveBeenCalledWith(200);

    // Pause/Resume
    const res8 = createRes();
    await pauseHandler(createReq('POST', { tournamentId: created.id }) as any, res8 as any);
    expect(res8.status).toHaveBeenCalledWith(200);
    const paused = res8.json.mock.calls[0][0];
    expect(paused.status).toBe('paused');

    const res9 = createRes();
    await resumeHandler(createReq('POST', { tournamentId: created.id }) as any, res9 as any);
    expect(res9.status).toHaveBeenCalledWith(200);

    // Payouts
    const res10 = createRes();
    await payoutsHandler(createReq('GET', undefined, { tournamentId: created.id, prizePool: '1000' }) as any, res10 as any);
    expect(res10.status).toHaveBeenCalledWith(200);
    const payouts = res10.json.mock.calls[0][0];
    expect(Array.isArray(payouts)).toBe(true);
    expect(payouts[0].amount).toBeGreaterThan(0);

    // Get current state
    const res11 = createRes();
    await getHandler(createReq('GET', undefined, { tournamentId: created.id }) as any, res11 as any);
    expect(res11.status).toHaveBeenCalledWith(200);

  // Rebuy (should be allowed if config supports; default freezeout does not, expect error)
  const resRebuy = createRes();
  await rebuyHandler(createReq('POST', { tournamentId: created.id, userId: 'u1' }) as any, resRebuy as any);
  // For freezeout, expect 400
  expect(resRebuy.status).toHaveBeenCalledWith(400);

  // Create a rebuy tournament and exercise add-on
  const resA = createRes();
  const { createRebuyAddOnConfig } = await import('../../../src/lib/tournament/tournament-utils');
  await createHandler(createReq('POST', { name: 'Rebuy', config: createRebuyAddOnConfig() }) as any, resA as any);
  const createdRebuy = resA.json.mock.calls[0][0];
  const resB = createRes();
  await registerHandler(createReq('POST', { tournamentId: createdRebuy.id, userId: 'u3' }) as any, resB as any);
  const resC = createRes();
  await registerHandler(createReq('POST', { tournamentId: createdRebuy.id, userId: 'u4' }) as any, resC as any);
  const resD = createRes();
  await startHandler(createReq('POST', { tournamentId: createdRebuy.id }) as any, resD as any);
  // Rebuy should succeed
  const resE = createRes();
  await rebuyHandler(createReq('POST', { tournamentId: createdRebuy.id, userId: 'u3' }) as any, resE as any);
  expect(resE.status).toHaveBeenCalledWith(200);
  // Advance to break and do add-on
  const resF1 = createRes();
  await advanceHandler(createReq('POST', { tournamentId: createdRebuy.id }) as any, resF1 as any);
  const resF2 = createRes();
  await advanceHandler(createReq('POST', { tournamentId: createdRebuy.id }) as any, resF2 as any);
  const resF3 = createRes();
  await advanceHandler(createReq('POST', { tournamentId: createdRebuy.id }) as any, resF3 as any);
  const resG = createRes();
  await addOnHandler(createReq('POST', { tournamentId: createdRebuy.id, userId: 'u3' }) as any, resG as any);
  expect(resG.status).toHaveBeenCalledWith(200);

  // Report
  const res12 = createRes();
  await reportHandler(createReq('GET', undefined, { tournamentId: created.id, prizePool: '1000' }) as any, res12 as any);
  expect(res12.status).toHaveBeenCalledWith(200);
  const report = res12.json.mock.calls[0][0];
  expect(report.registration.total).toBeGreaterThanOrEqual(2);
  });
});
