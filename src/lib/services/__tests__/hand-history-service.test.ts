import { HandHistoryService } from '../hand-history-service';
import { HandHistoryManager } from '../../database/hand-history-manager';
import { Pool } from 'pg';
import {
  CreateGameHistoryRequest,
  GameHistoryRecord,
  RunItTwiceOutcomeInput,
  RunItTwiceOutcomeRecord
} from '../../../types/game-history';

// Mock HandHistoryManager
jest.mock('../../database/hand-history-manager');

describe('HandHistoryService', () => {
  let handHistoryService: HandHistoryService;
  let mockHandHistoryManager: jest.Mocked<HandHistoryManager>;
  let mockPool: jest.Mocked<Pool>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockPool = {} as jest.Mocked<Pool>;

    mockHandHistoryManager = {
      createHandHistory: jest.fn(),
      addRunItTwiceOutcome: jest.fn(),
      listRunItTwiceOutcomes: jest.fn(),
    } as any;

    (HandHistoryManager as jest.MockedClass<typeof HandHistoryManager>).mockImplementation(() => mockHandHistoryManager);
    
    handHistoryService = new HandHistoryService(mockPool);
  });

  describe('Constructor', () => {
    it('should create an instance with Pool', () => {
      expect(handHistoryService).toBeInstanceOf(HandHistoryService);
      expect(HandHistoryManager).toHaveBeenCalledWith(mockPool);
    });
  });

  describe('recordHand', () => {
    const createValidHandRequest = (): CreateGameHistoryRequest => ({
      tableId: 'table123',
      handId: 'hand456',
      actionSequence: [
        { 
          playerId: 'player1', 
          action: 'bet', 
          amount: 0, 
          timestamp: new Date(),
          position: 0
        }
      ],
      communityCards: ['AH', 'KD', 'QS'],
      results: {
        winners: [{
          playerId: 'player1',
          position: 0,
          holeCards: ['AH', 'AS'],
          bestHand: ['AH', 'AS', 'KD', 'QS', 'JC'],
          handRank: 'pair of aces',
          winAmount: 100,
          showedCards: true
        }],
        totalPot: 100,
        pot: [{ type: 'main', amount: 100, eligiblePlayers: ['player1'], winner: 'player1' }],
        rake: 0
      },
      startedAt: new Date('2023-01-01T10:00:00Z'),
      endedAt: new Date('2023-01-01T10:05:00Z')
    });

    const mockHandRecord: GameHistoryRecord = {
      id: 'history123',
      tableId: 'table123',
      handId: 'hand456',
      communityCards: ['AH', 'KD', 'QS'],
      startedAt: new Date('2023-01-01T10:00:00Z'),
      endedAt: new Date('2023-01-01T10:05:00Z'),
      actionSequence: [
        { 
          playerId: 'player1', 
          action: 'bet', 
          amount: 0, 
          timestamp: new Date(),
          position: 0
        }
      ],
      results: {
        winners: [{
          playerId: 'player1',
          position: 0,
          holeCards: ['AH', 'AS'],
          bestHand: ['AH', 'AS', 'KD', 'QS', 'JC'],
          handRank: 'pair of aces',
          winAmount: 100,
          showedCards: true
        }],
        totalPot: 100,
        pot: [{ type: 'main', amount: 100, eligiblePlayers: ['player1'], winner: 'player1' }],
        rake: 0
      }
    };

    it('should record hand successfully', async () => {
      const request = createValidHandRequest();
      mockHandHistoryManager.createHandHistory.mockResolvedValue(mockHandRecord);

      const result = await handHistoryService.recordHand(request);

      expect(mockHandHistoryManager.createHandHistory).toHaveBeenCalledWith(request);
      expect(result).toEqual(mockHandRecord);
    });

    it('should throw error for missing tableId', async () => {
      const request = createValidHandRequest();
      request.tableId = '';

      await expect(handHistoryService.recordHand(request))
        .rejects.toThrow('Missing or invalid gameId');
      
      expect(mockHandHistoryManager.createHandHistory).not.toHaveBeenCalled();
    });

    it('should throw error for undefined tableId', async () => {
      const request = createValidHandRequest();
      request.tableId = undefined as any;

      await expect(handHistoryService.recordHand(request))
        .rejects.toThrow('Missing or invalid gameId');
    });

    it('should throw error for missing handId', async () => {
      const request = createValidHandRequest();
      request.handId = '';

      await expect(handHistoryService.recordHand(request))
        .rejects.toThrow('Missing or invalid handId');
    });

    it('should throw error for undefined handId', async () => {
      const request = createValidHandRequest();
      (request as any).handId = undefined;

      await expect(handHistoryService.recordHand(request))
        .rejects.toThrow('Missing or invalid handId');
    });

    it('should throw error for empty actionSequence', async () => {
      const request = createValidHandRequest();
      request.actionSequence = [];

      await expect(handHistoryService.recordHand(request))
        .rejects.toThrow('Missing or invalid actionSequence');
    });

    it('should throw error for non-array actionSequence', async () => {
      const request = createValidHandRequest();
      request.actionSequence = 'invalid' as any;

      await expect(handHistoryService.recordHand(request))
        .rejects.toThrow('Missing or invalid actionSequence');
    });

    it('should throw error for undefined actionSequence', async () => {
      const request = createValidHandRequest();
      request.actionSequence = undefined as any;

      await expect(handHistoryService.recordHand(request))
        .rejects.toThrow('Missing or invalid actionSequence');
    });

    it('should throw error for non-array communityCards', async () => {
      const request = createValidHandRequest();
      request.communityCards = 'invalid' as any;

      await expect(handHistoryService.recordHand(request))
        .rejects.toThrow('Missing or invalid communityCards');
    });

    it('should throw error for undefined communityCards', async () => {
      const request = createValidHandRequest();
      request.communityCards = undefined as any;

      await expect(handHistoryService.recordHand(request))
        .rejects.toThrow('Missing or invalid communityCards');
    });

    it('should allow empty communityCards array', async () => {
      const request = createValidHandRequest();
      request.communityCards = [];
      
      mockHandHistoryManager.createHandHistory.mockResolvedValue(mockHandRecord);

      await expect(handHistoryService.recordHand(request))
        .resolves.toEqual(mockHandRecord);
    });

    it('should throw error for missing results', async () => {
      const request = createValidHandRequest();
      request.results = undefined as any;

      await expect(handHistoryService.recordHand(request))
        .rejects.toThrow('Missing or invalid results');
    });

    it('should throw error for null results', async () => {
      const request = createValidHandRequest();
      request.results = null as any;

      await expect(handHistoryService.recordHand(request))
        .rejects.toThrow('Missing or invalid results');
    });

    it('should throw error for non-Date startedAt', async () => {
      const request = createValidHandRequest();
      request.startedAt = 'invalid' as any;

      await expect(handHistoryService.recordHand(request))
        .rejects.toThrow('Missing or invalid time range');
    });

    it('should throw error for non-Date endedAt', async () => {
      const request = createValidHandRequest();
      request.endedAt = 'invalid' as any;

      await expect(handHistoryService.recordHand(request))
        .rejects.toThrow('Missing or invalid time range');
    });

    it('should throw error when startedAt equals endedAt', async () => {
      const request = createValidHandRequest();
      const sameTime = new Date('2023-01-01T10:00:00Z');
      request.startedAt = sameTime;
      request.endedAt = sameTime;

      await expect(handHistoryService.recordHand(request))
        .rejects.toThrow('Missing or invalid time range');
    });

    it('should throw error when startedAt is after endedAt', async () => {
      const request = createValidHandRequest();
      request.startedAt = new Date('2023-01-01T10:05:00Z');
      request.endedAt = new Date('2023-01-01T10:00:00Z');

      await expect(handHistoryService.recordHand(request))
        .rejects.toThrow('Missing or invalid time range');
    });

    it('should accept valid time range', async () => {
      const request = createValidHandRequest();
      request.startedAt = new Date('2023-01-01T10:00:00Z');
      request.endedAt = new Date('2023-01-01T10:00:01Z'); // 1 second later
      
      mockHandHistoryManager.createHandHistory.mockResolvedValue(mockHandRecord);

      await expect(handHistoryService.recordHand(request))
        .resolves.toEqual(mockHandRecord);
    });
  });

  describe('getHandById', () => {
    it('should throw error for not implemented method', async () => {
      await expect(handHistoryService.getHandById('hand123'))
        .rejects.toThrow('Not implemented: getHandById');
    });

    it('should throw error for missing id', async () => {
      await expect(handHistoryService.getHandById(''))
        .rejects.toThrow('Missing or invalid id');
    });

    it('should throw error for undefined id', async () => {
      await expect(handHistoryService.getHandById(undefined as any))
        .rejects.toThrow('Missing or invalid id');
    });

    it('should throw error for whitespace id', async () => {
      await expect(handHistoryService.getHandById('   '))
        .rejects.toThrow('Missing or invalid id');
    });
  });

  describe('addRunItTwiceOutcome', () => {
    const validRunItTwiceInput: RunItTwiceOutcomeInput = {
      handId: 'hand123',
      boardNumber: 1,
      communityCards: ['AH', 'KD', 'QS', 'JC', '10H'],
      winners: { player1: 200 },
      potAmount: 200
    };

    const mockOutcomeRecord: RunItTwiceOutcomeRecord = {
      id: 'outcome123',
      handId: 'hand123',
      boardNumber: 1,
      communityCards: ['AH', 'KD', 'QS', 'JC', '10H'],
      winners: { player1: 200 },
      potAmount: 200
    };

    it('should add run it twice outcome successfully', async () => {
      mockHandHistoryManager.addRunItTwiceOutcome.mockResolvedValue(mockOutcomeRecord);

      const result = await handHistoryService.addRunItTwiceOutcome(validRunItTwiceInput);

      expect(mockHandHistoryManager.addRunItTwiceOutcome).toHaveBeenCalledWith(validRunItTwiceInput);
      expect(result).toEqual(mockOutcomeRecord);
    });

    it('should throw error for missing handId', async () => {
      const input = { ...validRunItTwiceInput, handId: '' };

      await expect(handHistoryService.addRunItTwiceOutcome(input))
        .rejects.toThrow('Missing or invalid handId');
      
      expect(mockHandHistoryManager.addRunItTwiceOutcome).not.toHaveBeenCalled();
    });

    it('should throw error for undefined handId', async () => {
      const input = { ...validRunItTwiceInput, handId: undefined as any };

      await expect(handHistoryService.addRunItTwiceOutcome(input))
        .rejects.toThrow('Missing or invalid handId');
    });

    it('should throw error for boardNumber less than 1', async () => {
      const input = { ...validRunItTwiceInput, boardNumber: 0 };

      await expect(handHistoryService.addRunItTwiceOutcome(input))
        .rejects.toThrow('Missing or invalid boardNumber');
    });

    it('should throw error for boardNumber greater than 2', async () => {
      const input = { ...validRunItTwiceInput, boardNumber: 3 };

      await expect(handHistoryService.addRunItTwiceOutcome(input))
        .rejects.toThrow('Missing or invalid boardNumber');
    });

    it('should throw error for non-integer boardNumber', async () => {
      const input = { ...validRunItTwiceInput, boardNumber: 1.5 };

      await expect(handHistoryService.addRunItTwiceOutcome(input))
        .rejects.toThrow('Missing or invalid boardNumber');
    });

    it('should accept valid boardNumber 2', async () => {
      const input = { ...validRunItTwiceInput, boardNumber: 2 };
      
      mockHandHistoryManager.addRunItTwiceOutcome.mockResolvedValue(mockOutcomeRecord);

      await expect(handHistoryService.addRunItTwiceOutcome(input))
        .resolves.toEqual(mockOutcomeRecord);
    });

    it('should throw error for non-array communityCards', async () => {
      const input = { ...validRunItTwiceInput, communityCards: 'invalid' as any };

      await expect(handHistoryService.addRunItTwiceOutcome(input))
        .rejects.toThrow('Missing or invalid communityCards');
    });

    it('should throw error for undefined communityCards', async () => {
      const input = { ...validRunItTwiceInput, communityCards: undefined as any };

      await expect(handHistoryService.addRunItTwiceOutcome(input))
        .rejects.toThrow('Missing or invalid communityCards');
    });

    it('should allow empty communityCards array', async () => {
      const input = { ...validRunItTwiceInput, communityCards: [] };
      
      mockHandHistoryManager.addRunItTwiceOutcome.mockResolvedValue(mockOutcomeRecord);

      await expect(handHistoryService.addRunItTwiceOutcome(input))
        .resolves.toEqual(mockOutcomeRecord);
    });

    it('should throw error for non-number potAmount', async () => {
      const input = { ...validRunItTwiceInput, potAmount: 'invalid' as any };

      await expect(handHistoryService.addRunItTwiceOutcome(input))
        .rejects.toThrow('Missing or invalid potAmount');
    });

    it('should throw error for undefined potAmount', async () => {
      const input = { ...validRunItTwiceInput, potAmount: undefined as any };

      await expect(handHistoryService.addRunItTwiceOutcome(input))
        .rejects.toThrow('Missing or invalid potAmount');
    });

    it('should throw error for infinite potAmount', async () => {
      const input = { ...validRunItTwiceInput, potAmount: Infinity };

      await expect(handHistoryService.addRunItTwiceOutcome(input))
        .rejects.toThrow('Missing or invalid potAmount');
    });

    it('should throw error for NaN potAmount', async () => {
      const input = { ...validRunItTwiceInput, potAmount: NaN };

      await expect(handHistoryService.addRunItTwiceOutcome(input))
        .rejects.toThrow('Missing or invalid potAmount');
    });

    it('should accept zero potAmount', async () => {
      const input = { ...validRunItTwiceInput, potAmount: 0 };
      
      mockHandHistoryManager.addRunItTwiceOutcome.mockResolvedValue(mockOutcomeRecord);

      await expect(handHistoryService.addRunItTwiceOutcome(input))
        .resolves.toEqual(mockOutcomeRecord);
    });
  });

  describe('listRunItTwiceOutcomes', () => {
    const mockOutcomes: RunItTwiceOutcomeRecord[] = [
      {
        id: 'outcome1',
        handId: 'hand123',
        boardNumber: 1,
        communityCards: ['AH', 'KD', 'QS', 'JC', '10H'],
        winners: { player1: 100 },
        potAmount: 100
      },
      {
        id: 'outcome2',
        handId: 'hand123',
        boardNumber: 2,
        communityCards: ['2H', '3D', '4S', '5C', '6H'],
        winners: { player1: 100 },
        potAmount: 100
      }
    ];

    it('should list run it twice outcomes successfully', async () => {
      mockHandHistoryManager.listRunItTwiceOutcomes.mockResolvedValue(mockOutcomes);

      const result = await handHistoryService.listRunItTwiceOutcomes('hand123');

      expect(mockHandHistoryManager.listRunItTwiceOutcomes).toHaveBeenCalledWith('hand123');
      expect(result).toEqual(mockOutcomes);
    });

    it('should return empty array when no outcomes exist', async () => {
      mockHandHistoryManager.listRunItTwiceOutcomes.mockResolvedValue([]);

      const result = await handHistoryService.listRunItTwiceOutcomes('hand123');

      expect(result).toEqual([]);
    });

    it('should throw error for missing handId', async () => {
      await expect(handHistoryService.listRunItTwiceOutcomes(''))
        .rejects.toThrow('Missing or invalid handId');
      
      expect(mockHandHistoryManager.listRunItTwiceOutcomes).not.toHaveBeenCalled();
    });

    it('should throw error for undefined handId', async () => {
      await expect(handHistoryService.listRunItTwiceOutcomes(undefined as any))
        .rejects.toThrow('Missing or invalid handId');
    });

    it('should throw error for whitespace handId', async () => {
      await expect(handHistoryService.listRunItTwiceOutcomes('   '))
        .rejects.toThrow('Missing or invalid handId');
    });
  });

  describe('Validation helpers', () => {
    it('should validate non-string values in require', async () => {
      const input = {
        handId: 123 as any,
        boardNumber: 1,
        communityCards: [],
        winners: { player1: 100 },
        potAmount: 100
      };

      await expect(handHistoryService.addRunItTwiceOutcome(input))
        .rejects.toThrow('Missing or invalid handId');
    });

    it('should validate null values in require', async () => {
      const input = {
        handId: null as any,
        boardNumber: 1,
        communityCards: [],
        winners: { player1: 100 },
        potAmount: 100
      };

      await expect(handHistoryService.addRunItTwiceOutcome(input))
        .rejects.toThrow('Missing or invalid handId');
    });
  });
});