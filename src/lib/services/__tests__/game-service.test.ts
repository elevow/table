import { GameService } from '../game-service';
import { GameManager } from '../../database/game-manager';
import { validateTournamentConfig } from '../../tournament/tournament-utils';
import { Pool } from 'pg';
import {
  ActiveGameRecord,
  CreateRoomInput,
  GameRoomRecord,
  Paginated,
  StartGameInput,
  UpdateActiveGameInput
} from '../../../types/game';

// Mock dependencies
jest.mock('../../database/game-manager');
jest.mock('../../tournament/tournament-utils');

describe('GameService', () => {
  let gameService: GameService;
  let mockGameManager: jest.Mocked<GameManager>;
  let mockPool: jest.Mocked<Pool>;
  let mockValidateTournamentConfig: jest.MockedFunction<typeof validateTournamentConfig>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockPool = {} as jest.Mocked<Pool>;

    mockGameManager = {
      createRoom: jest.fn(),
      listRooms: jest.fn(),
      startGame: jest.fn(),
      updateActiveGame: jest.fn(),
      endGame: jest.fn(),
      getActiveGameByRoom: jest.fn(),
      getRoomById: jest.fn(),
    } as any;

    mockValidateTournamentConfig = validateTournamentConfig as jest.MockedFunction<typeof validateTournamentConfig>;

    (GameManager as jest.MockedClass<typeof GameManager>).mockImplementation(() => mockGameManager);
    
    gameService = new GameService(mockPool);
  });

  describe('Constructor', () => {
    it('should create an instance with Pool', () => {
      expect(gameService).toBeInstanceOf(GameService);
      expect(GameManager).toHaveBeenCalledWith(mockPool);
    });
  });

  describe('createRoom', () => {
    const validRoomInput: CreateRoomInput = {
      name: 'Test Room',
      gameType: 'texas_holdem',
      maxPlayers: 6,
      blindLevels: { small: 10, big: 20 },
      createdBy: 'user123',
      configuration: {}
    };

    const mockRoomRecord: GameRoomRecord = {
      id: 'room123',
      name: 'Test Room',
      gameType: 'texas_holdem',
      maxPlayers: 6,
      blindLevels: { small: 10, big: 20 },
      createdBy: 'user123',
      createdAt: new Date(),
      status: 'waiting',
      configuration: {}
    };

    it('should create room successfully', async () => {
      mockGameManager.createRoom.mockResolvedValue(mockRoomRecord);

      const result = await gameService.createRoom(validRoomInput);

      expect(mockGameManager.createRoom).toHaveBeenCalledWith(validRoomInput);
      expect(result).toEqual(mockRoomRecord);
    });

    it('should throw error for missing name', async () => {
      const input = { ...validRoomInput, name: '' };

      await expect(gameService.createRoom(input))
        .rejects.toThrow('Missing or invalid name');
      
      expect(mockGameManager.createRoom).not.toHaveBeenCalled();
    });

    it('should throw error for undefined name', async () => {
      const input = { ...validRoomInput, name: undefined as any };

      await expect(gameService.createRoom(input))
        .rejects.toThrow('Missing or invalid name');
    });

    it('should throw error for whitespace name', async () => {
      const input = { ...validRoomInput, name: '   ' };

      await expect(gameService.createRoom(input))
        .rejects.toThrow('Missing or invalid name');
    });

    it('should throw error for missing gameType', async () => {
      const input = { ...validRoomInput, gameType: '' as any };

      await expect(gameService.createRoom(input))
        .rejects.toThrow('Missing or invalid gameType');
    });

    it('should throw error for invalid maxPlayers', async () => {
      const input = { ...validRoomInput, maxPlayers: NaN };

      await expect(gameService.createRoom(input))
        .rejects.toThrow('Missing or invalid maxPlayers');
    });

    it('should throw error for undefined maxPlayers', async () => {
      const input = { ...validRoomInput, maxPlayers: undefined as any };

      await expect(gameService.createRoom(input))
        .rejects.toThrow('Missing or invalid maxPlayers');
    });

    it('should throw error for missing createdBy', async () => {
      const input = { ...validRoomInput, createdBy: '' };

      await expect(gameService.createRoom(input))
        .rejects.toThrow('Missing or invalid createdBy');
    });

    it('should validate tournament configuration when present', async () => {
      const inputWithTournament: CreateRoomInput = {
        ...validRoomInput,
        configuration: {
          tournament: {
            config: { buyIn: 100, startingChips: 1000 }
          }
        }
      };

      mockValidateTournamentConfig.mockReturnValue({
        valid: true,
        errors: []
      });
      mockGameManager.createRoom.mockResolvedValue(mockRoomRecord);

      const result = await gameService.createRoom(inputWithTournament);

      expect(mockValidateTournamentConfig).toHaveBeenCalledWith({ buyIn: 100, startingChips: 1000 });
      expect(mockGameManager.createRoom).toHaveBeenCalledWith(inputWithTournament);
      expect(result).toEqual(mockRoomRecord);
    });

    it('should throw error for invalid tournament configuration', async () => {
      const inputWithTournament: CreateRoomInput = {
        ...validRoomInput,
        configuration: {
          tournament: {
            config: { invalidField: true }
          }
        }
      };

      mockValidateTournamentConfig.mockReturnValue({
        valid: false,
        errors: ['Invalid buy-in amount', 'Missing starting chips']
      });

      await expect(gameService.createRoom(inputWithTournament))
        .rejects.toThrow('Invalid tournament config: Invalid buy-in amount, Missing starting chips');
      
      expect(mockGameManager.createRoom).not.toHaveBeenCalled();
    });

    it('should handle tournament preset without config', async () => {
      const inputWithPreset: CreateRoomInput = {
        ...validRoomInput,
        configuration: {
          tournament: {
            preset: 'standard'
          }
        }
      };

      mockGameManager.createRoom.mockResolvedValue(mockRoomRecord);

      const result = await gameService.createRoom(inputWithPreset);

      expect(mockValidateTournamentConfig).not.toHaveBeenCalled();
      expect(mockGameManager.createRoom).toHaveBeenCalledWith(inputWithPreset);
      expect(result).toEqual(mockRoomRecord);
    });
  });

  describe('listRooms', () => {
    const mockResponse: Paginated<GameRoomRecord> = {
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0
    };

    it('should list rooms with default pagination', async () => {
      mockGameManager.listRooms.mockResolvedValue(mockResponse);

      const result = await gameService.listRooms();

      expect(mockGameManager.listRooms).toHaveBeenCalledWith(1, 20);
      expect(result).toEqual(mockResponse);
    });

    it('should list rooms with custom pagination', async () => {
      mockGameManager.listRooms.mockResolvedValue(mockResponse);

      const result = await gameService.listRooms(2, 10);

      expect(mockGameManager.listRooms).toHaveBeenCalledWith(2, 10);
      expect(result).toEqual(mockResponse);
    });

    it('should normalize invalid page to 1', async () => {
      mockGameManager.listRooms.mockResolvedValue(mockResponse);

      await gameService.listRooms(-1, 10);

      expect(mockGameManager.listRooms).toHaveBeenCalledWith(1, 10);
    });

    it('should normalize invalid limit to 20', async () => {
      mockGameManager.listRooms.mockResolvedValue(mockResponse);

      await gameService.listRooms(1, -1);

      expect(mockGameManager.listRooms).toHaveBeenCalledWith(1, 20);
    });

    it('should cap limit at 100', async () => {
      mockGameManager.listRooms.mockResolvedValue(mockResponse);

      await gameService.listRooms(1, 150);

      expect(mockGameManager.listRooms).toHaveBeenCalledWith(1, 20);
    });
  });

  describe('startGame', () => {
    const validStartGameInput: StartGameInput = {
      roomId: 'room123',
      dealerPosition: 0,
      currentPlayerPosition: 1,
      state: { phase: 'pre-flop' }
    };

    const mockActiveGame: ActiveGameRecord = {
      id: 'game123',
      roomId: 'room123',
      currentHandId: null,
      dealerPosition: 0,
      currentPlayerPosition: 1,
      pot: 0,
      state: { phase: 'pre-flop' },
      lastActionAt: new Date()
    };

    const mockRoom: GameRoomRecord = {
      id: 'room123',
      name: 'Test Room',
      gameType: 'texas_holdem',
      maxPlayers: 6,
      blindLevels: { small: 10, big: 20 },
      createdBy: 'user123',
      createdAt: new Date(),
      status: 'waiting',
      configuration: {}
    };

    it('should start game successfully', async () => {
      mockGameManager.getRoomById.mockResolvedValue(mockRoom);
      mockGameManager.startGame.mockResolvedValue(mockActiveGame);

      const result = await gameService.startGame(validStartGameInput);

      expect(mockGameManager.getRoomById).toHaveBeenCalledWith('room123');
      expect(mockGameManager.startGame).toHaveBeenCalledWith(validStartGameInput);
      expect(result).toEqual(mockActiveGame);
    });

    it('should apply betting mode from room configuration', async () => {
      const roomWithConfig = {
        ...mockRoom,
        configuration: { bettingMode: 'pot-limit' }
      };
      
      mockGameManager.getRoomById.mockResolvedValue(roomWithConfig);
      mockGameManager.startGame.mockResolvedValue(mockActiveGame);

      await gameService.startGame(validStartGameInput);

      expect(mockGameManager.startGame).toHaveBeenCalledWith({
        ...validStartGameInput,
        state: {
          phase: 'pre-flop',
          bettingMode: 'pot-limit'
        }
      });
    });

    it('should apply run-it-twice requirement from room configuration', async () => {
      const roomWithConfig = {
        ...mockRoom,
        configuration: { requireRunItTwiceUnanimous: true }
      };
      
      mockGameManager.getRoomById.mockResolvedValue(roomWithConfig);
      mockGameManager.startGame.mockResolvedValue(mockActiveGame);

      await gameService.startGame(validStartGameInput);

      expect(mockGameManager.startGame).toHaveBeenCalledWith({
        ...validStartGameInput,
        state: {
          phase: 'pre-flop',
          requireRunItTwiceUnanimous: true
        }
      });
    });

    it('should apply variant from room configuration', async () => {
      const roomWithConfig = {
        ...mockRoom,
        configuration: { variant: 'omaha' }
      };
      
      mockGameManager.getRoomById.mockResolvedValue(roomWithConfig);
      mockGameManager.startGame.mockResolvedValue(mockActiveGame);

      await gameService.startGame(validStartGameInput);

      expect(mockGameManager.startGame).toHaveBeenCalledWith({
        ...validStartGameInput,
        state: {
          phase: 'pre-flop',
          variant: 'omaha'
        }
      });
    });

    it('should not override no-limit betting mode (default)', async () => {
      const roomWithConfig = {
        ...mockRoom,
        configuration: { bettingMode: 'no-limit' }
      };
      
      mockGameManager.getRoomById.mockResolvedValue(roomWithConfig);
      mockGameManager.startGame.mockResolvedValue(mockActiveGame);

      await gameService.startGame(validStartGameInput);

      expect(mockGameManager.startGame).toHaveBeenCalledWith(validStartGameInput);
    });

    it('should handle undefined state', async () => {
      const inputWithoutState = {
        ...validStartGameInput,
        state: undefined
      };
      
      const roomWithConfig = {
        ...mockRoom,
        configuration: { bettingMode: 'pot-limit' }
      };
      
      mockGameManager.getRoomById.mockResolvedValue(roomWithConfig);
      mockGameManager.startGame.mockResolvedValue(mockActiveGame);

      await gameService.startGame(inputWithoutState);

      expect(mockGameManager.startGame).toHaveBeenCalledWith({
        ...inputWithoutState,
        state: { bettingMode: 'pot-limit' }
      });
    });

    it('should throw error for missing roomId', async () => {
      const input = { ...validStartGameInput, roomId: '' };

      await expect(gameService.startGame(input))
        .rejects.toThrow('Missing or invalid roomId');
      
      expect(mockGameManager.startGame).not.toHaveBeenCalled();
    });

    it('should throw error for invalid dealerPosition', async () => {
      const input = { ...validStartGameInput, dealerPosition: NaN };

      await expect(gameService.startGame(input))
        .rejects.toThrow('Missing or invalid dealerPosition');
    });

    it('should throw error for invalid currentPlayerPosition', async () => {
      const input = { ...validStartGameInput, currentPlayerPosition: undefined as any };

      await expect(gameService.startGame(input))
        .rejects.toThrow('Missing or invalid currentPlayerPosition');
    });
  });

  describe('updateActiveGame', () => {
    const validUpdateInput: UpdateActiveGameInput = {
      id: 'game123',
      state: { phase: 'flop' },
      currentPlayerPosition: 2
    };

    const mockUpdatedGame: ActiveGameRecord = {
      id: 'game123',
      roomId: 'room123',
      currentHandId: null,
      dealerPosition: 0,
      currentPlayerPosition: 2,
      pot: 0,
      state: { phase: 'flop' },
      lastActionAt: new Date()
    };

    it('should update active game successfully', async () => {
      mockGameManager.updateActiveGame.mockResolvedValue(mockUpdatedGame);

      const result = await gameService.updateActiveGame(validUpdateInput);

      expect(mockGameManager.updateActiveGame).toHaveBeenCalledWith(validUpdateInput);
      expect(result).toEqual(mockUpdatedGame);
    });

    it('should throw error for missing id', async () => {
      const input = { ...validUpdateInput, id: '' };

      await expect(gameService.updateActiveGame(input))
        .rejects.toThrow('Missing or invalid id');
      
      expect(mockGameManager.updateActiveGame).not.toHaveBeenCalled();
    });

    it('should throw error for undefined id', async () => {
      const input = { ...validUpdateInput, id: undefined as any };

      await expect(gameService.updateActiveGame(input))
        .rejects.toThrow('Missing or invalid id');
    });
  });

  describe('endGame', () => {
    it('should end game successfully', async () => {
      mockGameManager.endGame.mockResolvedValue();

      await gameService.endGame('game123');

      expect(mockGameManager.endGame).toHaveBeenCalledWith('game123');
    });

    it('should throw error for missing id', async () => {
      await expect(gameService.endGame(''))
        .rejects.toThrow('Missing or invalid id');
      
      expect(mockGameManager.endGame).not.toHaveBeenCalled();
    });

    it('should throw error for undefined id', async () => {
      await expect(gameService.endGame(undefined as any))
        .rejects.toThrow('Missing or invalid id');
    });
  });

  describe('getActiveGameByRoom', () => {
    const mockActiveGame: ActiveGameRecord = {
      id: 'game123',
      roomId: 'room123',
      currentHandId: null,
      dealerPosition: 0,
      currentPlayerPosition: 1,
      pot: 0,
      state: { phase: 'pre-flop' },
      lastActionAt: new Date()
    };

    it('should get active game by room without caller', async () => {
      mockGameManager.getActiveGameByRoom.mockResolvedValue(mockActiveGame);

      const result = await gameService.getActiveGameByRoom('room123');

      expect(mockGameManager.getActiveGameByRoom).toHaveBeenCalledWith('room123');
      expect(result).toEqual(mockActiveGame);
    });

    it('should get active game by room with caller', async () => {
      mockGameManager.getActiveGameByRoom.mockResolvedValue(mockActiveGame);

      const result = await gameService.getActiveGameByRoom('room123', 'user456');

      expect(mockGameManager.getActiveGameByRoom).toHaveBeenCalledWith('room123', 'user456');
      expect(result).toEqual(mockActiveGame);
    });

    it('should return null when no active game exists', async () => {
      mockGameManager.getActiveGameByRoom.mockResolvedValue(null);

      const result = await gameService.getActiveGameByRoom('room123');

      expect(result).toBeNull();
    });

    it('should throw error for missing roomId', async () => {
      await expect(gameService.getActiveGameByRoom(''))
        .rejects.toThrow('Missing or invalid roomId');
      
      expect(mockGameManager.getActiveGameByRoom).not.toHaveBeenCalled();
    });

    it('should throw error for undefined roomId', async () => {
      await expect(gameService.getActiveGameByRoom(undefined as any))
        .rejects.toThrow('Missing or invalid roomId');
    });
  });

  describe('Validation helpers', () => {
    it('should validate non-string values in require', async () => {
      const input = {
        name: 123 as any,
        gameType: 'texas_holdem',
        maxPlayers: 6,
        blindLevels: { small: 10, big: 20 },
        createdBy: 'user123'
      };

      await expect(gameService.createRoom(input))
        .rejects.toThrow('Missing or invalid name');
    });

    it('should validate null values in require', async () => {
      const input = {
        name: null as any,
        gameType: 'texas_holdem',
        maxPlayers: 6,
        blindLevels: { small: 10, big: 20 },
        createdBy: 'user123'
      };

      await expect(gameService.createRoom(input))
        .rejects.toThrow('Missing or invalid name');
    });

    it('should validate infinite values in requireNumber', async () => {
      const input = {
        name: 'Test Room',
        gameType: 'texas_holdem',
        maxPlayers: Infinity,
        blindLevels: { small: 10, big: 20 },
        createdBy: 'user123'
      };

      await expect(gameService.createRoom(input))
        .rejects.toThrow('Missing or invalid maxPlayers');
    });
  });

  describe('Pagination normalization', () => {
    it('should handle zero page values', async () => {
      mockGameManager.listRooms.mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0
      });

      await gameService.listRooms(0, 20);
      expect(mockGameManager.listRooms).toHaveBeenCalledWith(1, 20);
    });

    it('should handle NaN limit values', async () => {
      mockGameManager.listRooms.mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0
      });

      await gameService.listRooms(1, NaN);
      expect(mockGameManager.listRooms).toHaveBeenCalledWith(1, 20);
    });
  });
});