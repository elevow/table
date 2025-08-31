import { describe, it, beforeEach, expect, jest } from '@jest/globals';
import { HandHistoryManager } from '../hand-history-manager';

// Fix UUID for deterministic assertions
jest.mock('uuid', () => ({ v4: () => 'hid-1' }));

describe('HandHistoryManager (US-021)', () => {
  let mgr: HandHistoryManager;
  let mockClient: { query: jest.Mock; release: jest.Mock };
  let mockPool: any;

  beforeEach(() => {
    mockClient = { query: jest.fn(), release: jest.fn() };
    mockPool = { connect: jest.fn().mockResolvedValue(mockClient) } as any;
    mgr = new HandHistoryManager(mockPool);
    jest.clearAllMocks();
  });

  it('creates hand history and maps return shape', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'hid-1' }] });

    const now = new Date();
    const res = await mgr.createHandHistory({
      tableId: 't1',
      handId: '42',
      actionSequence: [
        { playerId: 'p1', action: 'bet', amount: 10, timestamp: now, position: 1 },
        { playerId: 'p2', action: 'call', amount: 10, timestamp: now, position: 2 },
      ],
      communityCards: ['As', 'Kd', 'Qc', 'Jh', '10s'],
      results: {
        winners: [{ playerId: 'p1', position: 1, holeCards: ['Ah', 'Ad'], bestHand: ['As', 'Kd', 'Qc', 'Jh', '10s'], handRank: 'straight', winAmount: 20, showedCards: true }],
        pot: [{ type: 'main', amount: 20, eligiblePlayers: ['p1', 'p2'], winner: 'p1' }],
        totalPot: 20,
        rake: 0,
      },
      startedAt: now,
      endedAt: now,
    });

    expect(res.id).toBe('hid-1');
    expect(res.tableId).toBe('t1');
    expect(res.handId).toBe('42');

    // Verify query shape roughly
    expect(mockClient.query).toHaveBeenCalledTimes(1);
    const [sql, values] = mockClient.query.mock.calls[0];
    expect(String(sql)).toContain('INSERT INTO hand_history');
    expect(Array.isArray(values)).toBe(true);
    expect((values as any[])).toHaveLength(10);
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('adds run-it-twice outcome and parses winners/pot types', async () => {
    mockClient.query.mockResolvedValueOnce({
      rows: [{
        id: 'o1',
        hand_id: 'hid-1',
        board_number: 1,
        community_cards: ['As', 'Kd', 'Qc', 'Jh', '10s'],
        winners: JSON.stringify([{ playerId: 'p1', amount: 20 }]),
        pot_amount: '20.5',
      }],
    });

    const out = await mgr.addRunItTwiceOutcome({
      handId: 'hid-1',
      boardNumber: 1,
      communityCards: ['As', 'Kd', 'Qc', 'Jh', '10s'],
      winners: [{ playerId: 'p1', amount: 20.5 }],
      potAmount: 20.5,
    });

    expect(out.id).toBe('o1');
    expect(out.handId).toBe('hid-1');
    expect(out.boardNumber).toBe(1);
    expect(Array.isArray(out.winners)).toBe(true);
    expect(out.potAmount).toBeCloseTo(20.5);
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('lists run-it-twice outcomes and handles mixed types', async () => {
    mockClient.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'o1', hand_id: 'hid-1', board_number: 1,
          community_cards: ['As', 'Kd', 'Qc', 'Jh', '10s'],
          winners: JSON.stringify([{ playerId: 'p1', amount: 10 }]),
          pot_amount: 10,
        },
        {
          id: 'o2', hand_id: 'hid-1', board_number: 2,
          community_cards: ['2s', '3d', '4c', '5h', '6s'],
          // @ts-expect-error - purposely not a string to exercise non-string branch
          winners: [{ playerId: 'p2', amount: 30 }],
          pot_amount: '30',
        } as any,
      ],
    });

    const list = await mgr.listRunItTwiceOutcomes('hid-1');
    expect(list).toHaveLength(2);
    expect(list[0].potAmount).toBe(10);
    expect(list[1].potAmount).toBe(30);
    expect(Array.isArray(list[1].winners)).toBe(true);
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('releases client on error and propagates', async () => {
    mockClient.query.mockRejectedValueOnce(new Error('db error'));

    await expect(mgr.addRunItTwiceOutcome({
      handId: 'hid-err',
      boardNumber: 1,
      communityCards: [],
      winners: [],
      potAmount: 0,
    })).rejects.toThrow('db error');

    expect(mockClient.release).toHaveBeenCalled();
  });
});
