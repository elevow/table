import type { Pool } from 'pg';
import { RabbitHuntService } from '../../services/rabbit-hunt-service';

jest.mock('../../database/rabbit-hunt-manager', () => {
  const actual = jest.requireActual('../../database/rabbit-hunt-manager');
  return {
    ...actual,
    RabbitHuntManager: jest.fn().mockImplementation(() => ({
      getCooldown: jest.fn(),
      setCooldown: jest.fn(),
      recordReveal: jest.fn(),
      listReveals: jest.fn(),
    })),
  };
});

const MockedManager = require('../../database/rabbit-hunt-manager').RabbitHuntManager as jest.Mock;

describe('RabbitHuntService (US-024)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const pool = {} as unknown as Pool;

  it('requestReveal validates input and enforces cooldown', async () => {
    const svc = new RabbitHuntService(pool);
    const mgr = MockedManager.mock.results[0].value;
    mgr.getCooldown.mockResolvedValue({ nextAvailable: new Date(Date.now() + 60_000).toISOString() });

    await expect(
      svc.requestReveal({ handId: 'h1', userId: 'u1', street: 'river', revealedCards: [], remainingDeck: [] })
    ).rejects.toThrow('Feature on cooldown');
  });

  it('requestReveal records and sets cooldown when allowed', async () => {
    const svc = new RabbitHuntService(pool);
    const mgr = MockedManager.mock.results[0].value;
    mgr.getCooldown.mockResolvedValue(null);
    mgr.recordReveal.mockResolvedValue({ id: 'rh1' });
    mgr.setCooldown.mockResolvedValue({});

    const out = await svc.requestReveal({ handId: 'h1', userId: 'u1', street: 'river', revealedCards: ['Ah'], remainingDeck: ['2d'] });
    expect(out).toEqual({ id: 'rh1' });
    expect(mgr.setCooldown).toHaveBeenCalled();
  });

  it('listReveals delegates to manager', async () => {
    const svc = new RabbitHuntService(pool);
    const mgr = MockedManager.mock.results[0].value;
    mgr.listReveals.mockResolvedValue([{ id: 'x' }]);
    const res = await svc.listReveals({ handId: 'h1' });
    expect(res).toEqual([{ id: 'x' }]);
  });
});
