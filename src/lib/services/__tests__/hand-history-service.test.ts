import { HandHistoryService } from '../hand-history-service';
import { HandHistoryManager } from '../../database/hand-history-manager';

jest.mock('../../database/hand-history-manager', () => ({
  HandHistoryManager: jest.fn().mockImplementation(() => ({
    createHandHistory: jest.fn(async (req: any) => ({
      id: 'hh-1',
      tableId: req.tableId,
      handId: String(req.handId),
      actionSequence: req.actionSequence,
      communityCards: req.communityCards,
      results: req.results,
      startedAt: req.startedAt,
      endedAt: req.endedAt,
    })),
    addRunItTwiceOutcome: jest.fn(async (input: any) => ({
      id: 'rit-1',
      handId: input.handId,
      boardNumber: input.boardNumber,
      communityCards: input.communityCards,
      winners: input.winners,
      potAmount: input.potAmount,
    })),
    listRunItTwiceOutcomes: jest.fn(async () => []),
  })),
}));

describe('HandHistoryService (US-021)', () => {
  beforeEach(() => jest.clearAllMocks());

  const baseReq = {
    tableId: 'g-1',
    handId: '42',
    actionSequence: [{ playerId: 'u1', action: 'bet', amount: 10, timestamp: new Date(), position: 0 }],
    communityCards: ['Ah', 'Kd', 'Qc', '7s', '2h'],
    results: { winners: [{ playerId: 'u1', winAmount: 10 }], pot: [{ type: 'main', amount: 10, eligiblePlayers: ['u1'], winner: 'u1' }], totalPot: 10, rake: 0 },
    startedAt: new Date(Date.now() - 2000),
    endedAt: new Date(),
  };

  it('records a hand with validation and delegates to manager', async () => {
    const svc = new HandHistoryService({} as any);
    const rec = await svc.recordHand(baseReq as any);
    expect(rec.id).toBe('hh-1');
    expect(rec.tableId).toBe('g-1');
  });

  it('rejects invalid inputs for recordHand', async () => {
    const svc = new HandHistoryService({} as any);
    await expect(svc.recordHand({ ...baseReq, tableId: '  ' } as any)).rejects.toThrow('Missing or invalid gameId');
    await expect(svc.recordHand({ ...baseReq, handId: '' } as any)).rejects.toThrow('Missing or invalid handId');
    await expect(svc.recordHand({ ...baseReq, actionSequence: [] } as any)).rejects.toThrow('Missing or invalid actionSequence');
    await expect(svc.recordHand({ ...baseReq, communityCards: null } as any)).rejects.toThrow('Missing or invalid communityCards');
    await expect(svc.recordHand({ ...baseReq, results: null } as any)).rejects.toThrow('Missing or invalid results');
    await expect(svc.recordHand({ ...baseReq, startedAt: new Date(), endedAt: new Date(Date.now() - 1000) } as any)).rejects.toThrow('Missing or invalid time range');
  });

  it('adds and lists Run It Twice outcomes', async () => {
    const svc = new HandHistoryService({} as any);
    const out = await svc.addRunItTwiceOutcome({ handId: 'h1', boardNumber: 1, communityCards: ['Ah','Kh','Qh','Jh','Th'], winners: [{ playerId: 'u1' }], potAmount: 50 });
    expect(out.id).toBe('rit-1');
    await expect(svc.listRunItTwiceOutcomes('')).rejects.toThrow('Missing or invalid handId');
    const list = await svc.listRunItTwiceOutcomes('h1');
    expect(Array.isArray(list)).toBe(true);
  });
});
