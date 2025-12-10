// Mock Supabase before any imports
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    channel: jest.fn(() => ({
      send: jest.fn(),
    })),
  })),
}));

import { postHandResultToChat } from '../post-hand-result';
import { formatHandResult, SYSTEM_SENDER_ID } from '../hand-result-formatter';
import { publishChatMessage } from '../../realtime/publisher';
import type { TableState } from '../../../types/poker';

// Mock dependencies
jest.mock('../hand-result-formatter');
jest.mock('../../realtime/publisher');
jest.mock('crypto', () => ({
  randomUUID: jest.fn(() => 'mock-uuid-1234'),
}));

const mockFormatHandResult = formatHandResult as jest.MockedFunction<typeof formatHandResult>;
const mockPublishChatMessage = publishChatMessage as jest.MockedFunction<typeof publishChatMessage>;

describe('postHandResultToChat', () => {
  const mockTableState: TableState = {
    tableId: 'table-123',
    pot: 100,
    smallBlind: 5,
    bigBlind: 10,
    currentBet: 0,
    minRaise: 10,
    stage: 'showdown',
    activePlayer: '',
    communityCards: [
      { rank: 'A', suit: 'hearts' },
      { rank: 'K', suit: 'hearts' },
      { rank: 'Q', suit: 'hearts' },
      { rank: 'J', suit: 'hearts' },
      { rank: '10', suit: 'hearts' },
    ],
    players: [
      {
        id: 'player-1',
        name: 'Alice',
        stack: 1000,
        currentBet: 0,
        hasActed: true,
        isFolded: false,
        isAllIn: false,
        position: 0,
        holeCards: [
          { rank: '9', suit: 'hearts' },
          { rank: '8', suit: 'hearts' },
        ],
      },
      {
        id: 'player-2',
        name: 'Bob',
        stack: 1000,
        currentBet: 0,
        hasActed: true,
        isFolded: false,
        isAllIn: false,
        position: 1,
        holeCards: [
          { rank: '7', suit: 'hearts' },
          { rank: '6', suit: 'hearts' },
        ],
      },
    ],
    variant: 'texas-holdem',
    bettingMode: 'no-limit',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should post hand result to chat successfully', async () => {
    const mockFormattedResult = {
      message: '🏆 Alice wins with Straight Flush',
      winners: [
        {
          playerId: 'player-1',
          playerName: 'Alice',
          amount: 100,
          handDescription: 'Straight Flush',
        },
      ],
      isWinByFold: false,
    };

    mockFormatHandResult.mockReturnValue(mockFormattedResult);
    mockPublishChatMessage.mockResolvedValue(undefined);

    const result = await postHandResultToChat('table-123', mockTableState);

    expect(result).toBeDefined();
    expect(result).toMatchObject({
      id: 'mock-uuid-1234',
      roomId: 'table-123',
      senderId: SYSTEM_SENDER_ID,
      message: '🏆 Alice wins with Straight Flush',
      isPrivate: false,
      recipientId: null,
      isModerated: false,
      moderatedAt: null,
      moderatorId: null,
      isSystem: true,
    });
    expect(result.sentAt).toBeDefined();

    expect(mockFormatHandResult).toHaveBeenCalledWith(mockTableState);
    expect(mockPublishChatMessage).toHaveBeenCalledWith('table-123', {
      message: expect.objectContaining({
        message: '🏆 Alice wins with Straight Flush',
        isSystem: true,
      }),
    });
  });

  it('should return null when formatHandResult returns null', async () => {
    mockFormatHandResult.mockReturnValue(null);

    const result = await postHandResultToChat('table-123', mockTableState);

    expect(result).toBeNull();
    expect(mockFormatHandResult).toHaveBeenCalledWith(mockTableState);
    expect(mockPublishChatMessage).not.toHaveBeenCalled();
  });

  it('should return null when formatHandResult returns result without message', async () => {
    mockFormatHandResult.mockReturnValue({
      message: '',
      winners: [],
      isWinByFold: false,
    });

    const result = await postHandResultToChat('table-123', mockTableState);

    expect(result).toBeNull();
    expect(mockPublishChatMessage).not.toHaveBeenCalled();
  });

  it('should handle publishChatMessage errors gracefully', async () => {
    const mockFormattedResult = {
      message: '🏆 Bob wins the pot',
      winners: [
        {
          playerId: 'player-2',
          playerName: 'Bob',
          amount: 100,
        },
      ],
      isWinByFold: true,
    };

    mockFormatHandResult.mockReturnValue(mockFormattedResult);
    mockPublishChatMessage.mockRejectedValue(new Error('Network error'));

    // Should not throw, but return null
    const result = await postHandResultToChat('table-123', mockTableState);

    expect(result).toBeNull();
    expect(mockFormatHandResult).toHaveBeenCalledWith(mockTableState);
    expect(mockPublishChatMessage).toHaveBeenCalled();
  });

  it('should handle formatHandResult throwing an error', async () => {
    mockFormatHandResult.mockImplementation(() => {
      throw new Error('Formatting error');
    });

    const result = await postHandResultToChat('table-123', mockTableState);

    expect(result).toBeNull();
    expect(mockPublishChatMessage).not.toHaveBeenCalled();
  });

  it('should create system message with correct structure', async () => {
    const mockFormattedResult = {
      message: '🏆 Split pot between Alice and Bob',
      winners: [
        { playerId: 'player-1', playerName: 'Alice', amount: 50 },
        { playerId: 'player-2', playerName: 'Bob', amount: 50 },
      ],
      isWinByFold: false,
    };

    mockFormatHandResult.mockReturnValue(mockFormattedResult);
    mockPublishChatMessage.mockResolvedValue(undefined);

    const result = await postHandResultToChat('table-123', mockTableState);

    expect(result).toMatchObject({
      roomId: 'table-123',
      senderId: SYSTEM_SENDER_ID,
      isPrivate: false,
      recipientId: null,
      isSystem: true,
    });
  });

  it('should handle empty winners array', async () => {
    const mockFormattedResult = {
      message: '🏆 Hand complete',
      winners: [],
      isWinByFold: false,
    };

    mockFormatHandResult.mockReturnValue(mockFormattedResult);
    mockPublishChatMessage.mockResolvedValue(undefined);

    const result = await postHandResultToChat('table-123', mockTableState);

    expect(result).toBeDefined();
    expect(result?.message).toBe('🏆 Hand complete');
  });

  it('should generate different UUIDs for different calls', async () => {
    const crypto = require('crypto');
    let callCount = 0;
    (crypto.randomUUID as jest.Mock).mockImplementation(() => `mock-uuid-${++callCount}`);

    const mockFormattedResult = {
      message: '🏆 Alice wins',
      winners: [{ playerId: 'player-1', playerName: 'Alice', amount: 100 }],
      isWinByFold: false,
    };

    mockFormatHandResult.mockReturnValue(mockFormattedResult);
    mockPublishChatMessage.mockResolvedValue(undefined);

    const result1 = await postHandResultToChat('table-123', mockTableState);
    const result2 = await postHandResultToChat('table-456', mockTableState);

    expect(result1?.id).toBe('mock-uuid-1');
    expect(result2?.id).toBe('mock-uuid-2');
  });
});
