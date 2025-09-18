import { RabbitHuntService } from '../rabbit-hunt-service';
import { RabbitHuntManager } from '../../database/rabbit-hunt-manager';
import { GameManager } from '../../database/game-manager';
import { createPokerEngine } from '../../poker/engine-factory';
import { PokerEngine } from '../../poker/poker-engine';
import { Pool } from 'pg';
import {
  RequestRabbitHuntInput,
  ListRevealsQuery,
  RabbitHuntRecord,
  FeatureCooldown
} from '../../../types/rabbit-hunt';
import { ActiveGameRecord } from '../../../types/game';

// Mock dependencies
jest.mock('../../database/rabbit-hunt-manager');
jest.mock('../../database/game-manager');
jest.mock('../../poker/engine-factory');
jest.mock('../../poker/poker-engine');

describe('RabbitHuntService', () => {
  let rabbitHuntService: RabbitHuntService;
  let mockRabbitHuntManager: jest.Mocked<RabbitHuntManager>;
  let mockGameManager: jest.Mocked<GameManager>;
  let mockCreatePokerEngine: jest.MockedFunction<typeof createPokerEngine>;
  let mockPokerEngine: jest.Mocked<PokerEngine>;
  let mockPool: jest.Mocked<Pool>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockPool = {} as jest.Mocked<Pool>;

    mockRabbitHuntManager = {
      recordReveal: jest.fn(),
      listReveals: jest.fn(),
      getCooldown: jest.fn(),
      setCooldown: jest.fn(),
    } as any;

    mockGameManager = {
      getActiveGameByRoom: jest.fn(),
    } as any;

    mockPokerEngine = {
      prepareRabbitPreview: jest.fn(),
      previewRabbitHunt: jest.fn(),
    } as any;

    mockCreatePokerEngine = createPokerEngine as jest.MockedFunction<typeof createPokerEngine>;
    mockCreatePokerEngine.mockReturnValue(mockPokerEngine);

    // Mock static methods
    (PokerEngine.fromDbCard as jest.Mock) = jest.fn().mockImplementation((s: string) => ({ suit: 'H', rank: 'A' }));
    (PokerEngine.toDbCard as jest.Mock) = jest.fn().mockImplementation(() => 'AH');

    (RabbitHuntManager as jest.MockedClass<typeof RabbitHuntManager>).mockImplementation(() => mockRabbitHuntManager);
    (GameManager as jest.MockedClass<typeof GameManager>).mockImplementation(() => mockGameManager);
    
    rabbitHuntService = new RabbitHuntService(mockPool);
  });

  describe('Constructor', () => {
    it('should create an instance with Pool', () => {
      expect(rabbitHuntService).toBeInstanceOf(RabbitHuntService);
      expect(RabbitHuntManager).toHaveBeenCalledWith(mockPool);
      expect(GameManager).toHaveBeenCalledWith(mockPool);
    });
  });

  describe('requestReveal', () => {
    const validRequest: RequestRabbitHuntInput = {
      handId: 'hand123',
      userId: 'user123',
      street: 'flop',
      revealedCards: ['AH', 'KD'],
      remainingDeck: ['QS', 'JC', '10H']
    };

    const mockRabbitRecord: RabbitHuntRecord = {
      id: 'rabbit123',
      handId: 'hand123',
      requestedBy: 'user123',
      street: 'flop',
      revealedCards: ['AH', 'KD'],
      remainingDeck: ['QS', 'JC', '10H'],
      revealedAt: new Date().toISOString()
    };

    beforeEach(() => {
      // Mock Date.now for consistent cooldown testing
      jest.spyOn(Date, 'now').mockReturnValue(1000000);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should request reveal successfully when no cooldown', async () => {
      mockRabbitHuntManager.getCooldown.mockResolvedValue(null);
      mockRabbitHuntManager.recordReveal.mockResolvedValue(mockRabbitRecord);
      mockRabbitHuntManager.setCooldown.mockResolvedValue({
        id: 'cooldown123',
        userId: 'user123',
        featureType: 'rabbit_hunt',
        lastUsed: new Date().toISOString(),
        nextAvailable: new Date().toISOString()
      });

      const result = await rabbitHuntService.requestReveal(validRequest);

      expect(mockRabbitHuntManager.getCooldown).toHaveBeenCalledWith('user123', 'rabbit_hunt');
      expect(mockRabbitHuntManager.recordReveal).toHaveBeenCalledWith(validRequest);
      expect(mockRabbitHuntManager.setCooldown).toHaveBeenCalledWith(
        'user123',
        'rabbit_hunt',
        new Date(1060000).toISOString() // 60 seconds later
      );
      expect(result).toEqual(mockRabbitRecord);
    });

    it('should request reveal successfully when cooldown has expired', async () => {
      const expiredCooldown: FeatureCooldown = {
        id: 'cooldown124',
        userId: 'user123',
        featureType: 'rabbit_hunt',
        lastUsed: new Date(900000).toISOString(),
        nextAvailable: new Date(999000).toISOString() // Before current time
      };

      mockRabbitHuntManager.getCooldown.mockResolvedValue(expiredCooldown);
      mockRabbitHuntManager.recordReveal.mockResolvedValue(mockRabbitRecord);
      mockRabbitHuntManager.setCooldown.mockResolvedValue({
        id: 'cooldown125',
        userId: 'user123',
        featureType: 'rabbit_hunt',
        lastUsed: new Date().toISOString(),
        nextAvailable: new Date().toISOString()
      });

      const result = await rabbitHuntService.requestReveal(validRequest);

      expect(result).toEqual(mockRabbitRecord);
    });

    it('should throw error when feature is on cooldown', async () => {
      const activeCooldown: FeatureCooldown = {
        id: 'cooldown126',
        userId: 'user123',
        featureType: 'rabbit_hunt',
        lastUsed: new Date(500000).toISOString(),
        nextAvailable: new Date(1001000).toISOString() // After current time
      };

      mockRabbitHuntManager.getCooldown.mockResolvedValue(activeCooldown);

      await expect(rabbitHuntService.requestReveal(validRequest))
        .rejects.toThrow('Feature on cooldown');
      
      expect(mockRabbitHuntManager.recordReveal).not.toHaveBeenCalled();
      expect(mockRabbitHuntManager.setCooldown).not.toHaveBeenCalled();
    });

    it('should throw error for missing handId', async () => {
      const request = { ...validRequest, handId: '' };

      await expect(rabbitHuntService.requestReveal(request))
        .rejects.toThrow('handId required');
    });

    it('should throw error for undefined handId', async () => {
      const request = { ...validRequest, handId: undefined as any };

      await expect(rabbitHuntService.requestReveal(request))
        .rejects.toThrow('handId required');
    });

    it('should throw error for missing userId', async () => {
      const request = { ...validRequest, userId: '' };

      await expect(rabbitHuntService.requestReveal(request))
        .rejects.toThrow('userId required');
    });

    it('should throw error for undefined userId', async () => {
      const request = { ...validRequest, userId: undefined as any };

      await expect(rabbitHuntService.requestReveal(request))
        .rejects.toThrow('userId required');
    });

    it('should throw error for missing street', async () => {
      const request = { ...validRequest, street: '' as any };

      await expect(rabbitHuntService.requestReveal(request))
        .rejects.toThrow('street required');
    });

    it('should throw error for undefined street', async () => {
      const request = { ...validRequest, street: undefined as any };

      await expect(rabbitHuntService.requestReveal(request))
        .rejects.toThrow('street required');
    });

    it('should throw error for non-array revealedCards', async () => {
      const request = { ...validRequest, revealedCards: 'invalid' as any };

      await expect(rabbitHuntService.requestReveal(request))
        .rejects.toThrow('revealedCards required');
    });

    it('should throw error for undefined revealedCards', async () => {
      const request = { ...validRequest, revealedCards: undefined as any };

      await expect(rabbitHuntService.requestReveal(request))
        .rejects.toThrow('revealedCards required');
    });

    it('should throw error for non-array remainingDeck', async () => {
      const request = { ...validRequest, remainingDeck: 'invalid' as any };

      await expect(rabbitHuntService.requestReveal(request))
        .rejects.toThrow('remainingDeck required');
    });

    it('should throw error for undefined remainingDeck', async () => {
      const request = { ...validRequest, remainingDeck: undefined as any };

      await expect(rabbitHuntService.requestReveal(request))
        .rejects.toThrow('remainingDeck required');
    });

    it('should allow empty arrays for revealedCards and remainingDeck', async () => {
      const request = { ...validRequest, revealedCards: [], remainingDeck: [] };

      mockRabbitHuntManager.getCooldown.mockResolvedValue(null);
      mockRabbitHuntManager.recordReveal.mockResolvedValue(mockRabbitRecord);
      mockRabbitHuntManager.setCooldown.mockResolvedValue({
        id: 'cooldown127',
        userId: 'user123',
        featureType: 'rabbit_hunt',
        lastUsed: new Date().toISOString(),
        nextAvailable: new Date().toISOString()
      });

      await expect(rabbitHuntService.requestReveal(request))
        .resolves.toEqual(mockRabbitRecord);
    });
  });

  describe('listReveals', () => {
    const validQuery: ListRevealsQuery = {
      handId: 'hand123',
      limit: 10
    };

    const mockReveals: RabbitHuntRecord[] = [
      {
        id: 'rabbit1',
        handId: 'hand123',
        requestedBy: 'user1',
        street: 'flop',
        revealedCards: ['AH', 'KD'],
        remainingDeck: [],
        revealedAt: new Date().toISOString()
      },
      {
        id: 'rabbit2',
        handId: 'hand123',
        requestedBy: 'user2',
        street: 'turn',
        revealedCards: ['QS'],
        remainingDeck: ['JC', '10H'],
        revealedAt: new Date().toISOString()
      }
    ];

    it('should list reveals successfully', async () => {
      mockRabbitHuntManager.listReveals.mockResolvedValue(mockReveals);

      const result = await rabbitHuntService.listReveals(validQuery);

      expect(mockRabbitHuntManager.listReveals).toHaveBeenCalledWith(validQuery);
      expect(result).toEqual(mockReveals);
    });

    it('should return empty array when no reveals found', async () => {
      mockRabbitHuntManager.listReveals.mockResolvedValue([]);

      const result = await rabbitHuntService.listReveals(validQuery);

      expect(result).toEqual([]);
    });

    it('should throw error for missing handId', async () => {
      const query = { ...validQuery, handId: '' };

      await expect(rabbitHuntService.listReveals(query))
        .rejects.toThrow('handId required');
      
      expect(mockRabbitHuntManager.listReveals).not.toHaveBeenCalled();
    });

    it('should throw error for undefined handId', async () => {
      const query = { ...validQuery, handId: undefined as any };

      await expect(rabbitHuntService.listReveals(query))
        .rejects.toThrow('handId required');
    });

    it('should handle query with only handId', async () => {
      const minimalQuery = { handId: 'hand123' };
      
      mockRabbitHuntManager.listReveals.mockResolvedValue(mockReveals);

      const result = await rabbitHuntService.listReveals(minimalQuery);

      expect(mockRabbitHuntManager.listReveals).toHaveBeenCalledWith(minimalQuery);
      expect(result).toEqual(mockReveals);
    });
  });

  describe('getCooldown', () => {
    const mockCooldown: FeatureCooldown = {
      id: 'cooldown128',
      userId: 'user123',
      featureType: 'rabbit_hunt',
      lastUsed: new Date().toISOString(),
      nextAvailable: new Date().toISOString()
    };

    it('should get cooldown successfully', async () => {
      mockRabbitHuntManager.getCooldown.mockResolvedValue(mockCooldown);

      const result = await rabbitHuntService.getCooldown('user123');

      expect(mockRabbitHuntManager.getCooldown).toHaveBeenCalledWith('user123', 'rabbit_hunt');
      expect(result).toEqual(mockCooldown);
    });

    it('should return null when no cooldown exists', async () => {
      mockRabbitHuntManager.getCooldown.mockResolvedValue(null);

      const result = await rabbitHuntService.getCooldown('user123');

      expect(result).toBeNull();
    });

    it('should throw error for missing userId', async () => {
      await expect(rabbitHuntService.getCooldown(''))
        .rejects.toThrow('userId required');
      
      expect(mockRabbitHuntManager.getCooldown).not.toHaveBeenCalled();
    });

    it('should throw error for undefined userId', async () => {
      await expect(rabbitHuntService.getCooldown(undefined as any))
        .rejects.toThrow('userId required');
    });
  });

  describe('preview', () => {
    const mockActiveGame: ActiveGameRecord = {
      id: 'game123',
      roomId: 'room123',
      currentHandId: 'hand123',
      dealerPosition: 0,
      currentPlayerPosition: 1,
      pot: 100,
      state: {
        players: [
          { id: 'player1', name: 'Player 1', position: 1, stack: 1000, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30000 },
          { id: 'player2', name: 'Player 2', position: 2, stack: 1000, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30000 }
        ],
        smallBlind: 5,
        bigBlind: 10,
        communityCards: ['AH', 'KD', 'QS']
      },
      lastActionAt: new Date()
    };

    const mockPreviewResult = {
      street: 'turn' as const,
      cards: [{ suit: 'clubs' as const, rank: 'J' as const }],
      remainingDeck: [{ suit: 'hearts' as const, rank: '10' as const }, { suit: 'diamonds' as const, rank: '9' as const }]
    };

    it('should preview rabbit hunt successfully', async () => {
      mockGameManager.getActiveGameByRoom.mockResolvedValue(mockActiveGame);
      mockPokerEngine.previewRabbitHunt.mockReturnValue(mockPreviewResult);

      const params = {
        roomId: 'room123',
        street: 'turn' as const
      };

      const result = await rabbitHuntService.preview(params);

      expect(mockGameManager.getActiveGameByRoom).toHaveBeenCalledWith('room123');
      expect(mockCreatePokerEngine).toHaveBeenCalledWith({
        tableId: 'game123',
        players: mockActiveGame.state.players,
        smallBlind: 5,
        bigBlind: 10,
        state: { bettingMode: undefined, requireRunItTwiceUnanimous: false }
      });
      expect(mockPokerEngine.prepareRabbitPreview).toHaveBeenCalledWith({
        community: [{ suit: 'H', rank: 'A' }, { suit: 'H', rank: 'A' }, { suit: 'H', rank: 'A' }], // Mocked conversion
        known: []
      });
      expect(mockPokerEngine.previewRabbitHunt).toHaveBeenCalledWith('turn');
      expect(result).toEqual({
        street: 'turn',
        revealedCards: ['AH'],
        remainingDeck: ['AH', 'AH']
      });
    });

    it('should preview with caller user id', async () => {
      mockGameManager.getActiveGameByRoom.mockResolvedValue(mockActiveGame);
      mockPokerEngine.previewRabbitHunt.mockReturnValue(mockPreviewResult);

      const params = {
        roomId: 'room123',
        street: 'flop' as const,
        callerUserId: 'user123'
      };

      await rabbitHuntService.preview(params);

      expect(mockGameManager.getActiveGameByRoom).toHaveBeenCalledWith('room123', 'user123');
    });

    it('should preview with known cards', async () => {
      mockGameManager.getActiveGameByRoom.mockResolvedValue(mockActiveGame);
      mockPokerEngine.previewRabbitHunt.mockReturnValue(mockPreviewResult);

      const params = {
        roomId: 'room123',
        street: 'river' as const,
        knownCards: ['JS', '10C']
      };

      await rabbitHuntService.preview(params);

      expect(PokerEngine.fromDbCard).toHaveBeenCalledWith('JS');
      expect(PokerEngine.fromDbCard).toHaveBeenCalledWith('10C');
      expect(mockPokerEngine.prepareRabbitPreview).toHaveBeenCalledWith({
        community: expect.any(Array),
        known: expect.any(Array)
      });
    });

    it('should preview with custom community cards', async () => {
      mockGameManager.getActiveGameByRoom.mockResolvedValue(mockActiveGame);
      mockPokerEngine.previewRabbitHunt.mockReturnValue(mockPreviewResult);

      const params = {
        roomId: 'room123',
        street: 'turn' as const,
        communityCards: ['2H', '3D', '4S']
      };

      await rabbitHuntService.preview(params);

      expect(PokerEngine.fromDbCard).toHaveBeenCalledWith('2H');
      expect(PokerEngine.fromDbCard).toHaveBeenCalledWith('3D');
      expect(PokerEngine.fromDbCard).toHaveBeenCalledWith('4S');
    });

    it('should use default players when game has no players', async () => {
      const gameWithoutPlayers = {
        ...mockActiveGame,
        state: { smallBlind: 1, bigBlind: 2 }
      };

      mockGameManager.getActiveGameByRoom.mockResolvedValue(gameWithoutPlayers);
      mockPokerEngine.previewRabbitHunt.mockReturnValue(mockPreviewResult);

      const params = {
        roomId: 'room123',
        street: 'flop' as const
      };

      await rabbitHuntService.preview(params);

      expect(mockCreatePokerEngine).toHaveBeenCalledWith({
        tableId: 'game123',
        players: [
          { id: 'sb', name: 'sb', position: 1, stack: 100, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30000 },
          { id: 'bb', name: 'bb', position: 2, stack: 100, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30000 }
        ],
        smallBlind: 1,
        bigBlind: 2,
        state: { bettingMode: undefined, requireRunItTwiceUnanimous: false }
      });
    });

    it('should handle game state with betting mode and run it twice', async () => {
      const gameWithConfig = {
        ...mockActiveGame,
        state: {
          ...mockActiveGame.state,
          bettingMode: 'pot-limit',
          requireRunItTwiceUnanimous: true
        }
      };

      mockGameManager.getActiveGameByRoom.mockResolvedValue(gameWithConfig);
      mockPokerEngine.previewRabbitHunt.mockReturnValue(mockPreviewResult);

      const params = {
        roomId: 'room123',
        street: 'turn' as const
      };

      await rabbitHuntService.preview(params);

      expect(mockCreatePokerEngine).toHaveBeenCalledWith(
        expect.objectContaining({
          state: { bettingMode: 'pot-limit', requireRunItTwiceUnanimous: true }
        })
      );
    });

    it('should throw error for missing roomId', async () => {
      const params = {
        roomId: '',
        street: 'flop' as const
      };

      await expect(rabbitHuntService.preview(params))
        .rejects.toThrow('roomId required');
    });

    it('should throw error for undefined roomId', async () => {
      const params = {
        roomId: undefined as any,
        street: 'flop' as const
      };

      await expect(rabbitHuntService.preview(params))
        .rejects.toThrow('roomId required');
    });

    it('should throw error for missing street', async () => {
      const params = {
        roomId: 'room123',
        street: '' as any
      };

      await expect(rabbitHuntService.preview(params))
        .rejects.toThrow('street required');
    });

    it('should throw error for undefined street', async () => {
      const params = {
        roomId: 'room123',
        street: undefined as any
      };

      await expect(rabbitHuntService.preview(params))
        .rejects.toThrow('street required');
    });

    it('should throw error when no active game found', async () => {
      mockGameManager.getActiveGameByRoom.mockResolvedValue(null);

      const params = {
        roomId: 'room123',
        street: 'flop' as const
      };

      await expect(rabbitHuntService.preview(params))
        .rejects.toThrow('No active game for room');
      
      expect(mockCreatePokerEngine).not.toHaveBeenCalled();
    });

    it('should handle empty game state', async () => {
      const gameWithEmptyState = {
        ...mockActiveGame,
        state: null
      };

      mockGameManager.getActiveGameByRoom.mockResolvedValue(gameWithEmptyState);
      mockPokerEngine.previewRabbitHunt.mockReturnValue(mockPreviewResult);

      const params = {
        roomId: 'room123',
        street: 'flop' as const
      };

      await rabbitHuntService.preview(params);

      expect(mockCreatePokerEngine).toHaveBeenCalledWith({
        tableId: 'game123',
        players: expect.any(Array),
        smallBlind: 1, // Default values
        bigBlind: 2,
        state: { bettingMode: undefined, requireRunItTwiceUnanimous: false }
      });
    });
  });

  describe('Edge cases and validation', () => {
    it('should handle null values in validation', async () => {
      const request = {
        handId: null as any,
        userId: 'user123',
        street: 'flop' as const,
        revealedCards: [],
        remainingDeck: []
      };

      await expect(rabbitHuntService.requestReveal(request))
        .rejects.toThrow('handId required');
    });

    it('should allow whitespace-only strings in validation', async () => {
      const mockRecord: RabbitHuntRecord = {
        id: 'rabbit123',
        handId: '   ',
        requestedBy: 'user123',
        street: 'flop',
        revealedCards: [],
        remainingDeck: [],
        revealedAt: new Date().toISOString()
      };

      const request = {
        handId: '   ',
        userId: 'user123',
        street: 'flop' as const,
        revealedCards: [],
        remainingDeck: []
      };

      mockRabbitHuntManager.getCooldown.mockResolvedValue(null);
      mockRabbitHuntManager.recordReveal.mockResolvedValue(mockRecord);
      mockRabbitHuntManager.setCooldown.mockResolvedValue({
        id: 'cooldown129',
        userId: 'user123',
        featureType: 'rabbit_hunt',
        lastUsed: new Date().toISOString(),
        nextAvailable: new Date().toISOString()
      });

      await expect(rabbitHuntService.requestReveal(request))
        .resolves.toEqual(mockRecord);
    });
  });
});