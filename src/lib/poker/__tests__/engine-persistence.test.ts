// Mock pg module to avoid TextEncoder issues in jsdom
jest.mock('pg', () => ({
  Pool: jest.fn(),
}));

// Mock dependencies before imports
jest.mock('../../database/pool');
jest.mock('../../poker/poker-engine');

import {
  persistEngineState,
  restoreEngineFromDb,
  getOrRestoreEngine,
  SerializedEngineState,
} from '../../poker/engine-persistence';
import { PokerEngine } from '../../poker/poker-engine';
import { getPool } from '../../database/pool';
import type { TableState, Card } from '../../../types/poker';

const mockGetPool = getPool as jest.MockedFunction<typeof getPool>;
const mockQuery = jest.fn();
const mockPool = {
  query: mockQuery,
  connect: jest.fn(),
  end: jest.fn(),
  on: jest.fn(),
};

describe('engine-persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPool.mockReturnValue(mockPool as any);
    // Clear global.activeGames
    (global as any).activeGames = new Map();
  });

  afterEach(() => {
    // Clean up global state
    delete (global as any).activeGames;
  });

  describe('persistEngineState', () => {
    it('should save engine state to database', async () => {
      const mockSerializedState: SerializedEngineState = {
        tableState: {
          tableId: 'table-1',
          players: [],
          smallBlind: 5,
          bigBlind: 10,
          pot: 0,
          currentBet: 0,
          minRaise: 10,
          stage: 'preflop',
          activePlayer: '',
          communityCards: [],
          variant: 'texas-holdem',
          bettingMode: 'no-limit',
        },
        deck: [],
        removedPlayers: [],
        rabbitPreviewed: 0,
        requireRitUnanimous: false,
        ritConsents: [],
      };

      const mockEngine = {
        serialize: jest.fn().mockReturnValue(mockSerializedState),
      } as unknown as PokerEngine;

      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

      await persistEngineState('table-1', mockEngine);

      expect(mockEngine.serialize).toHaveBeenCalled();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE active_games'),
        [JSON.stringify(mockSerializedState), 'table-1']
      );
    });

    it('should handle database errors gracefully', async () => {
      const mockEngine = {
        serialize: jest.fn().mockReturnValue({}),
      } as unknown as PokerEngine;

      mockQuery.mockRejectedValue(new Error('Database connection failed'));

      // Should not throw
      await expect(persistEngineState('table-1', mockEngine)).resolves.toBeUndefined();

      expect(mockEngine.serialize).toHaveBeenCalled();
    });

    it('should handle serialization errors gracefully', async () => {
      const mockEngine = {
        serialize: jest.fn().mockImplementation(() => {
          throw new Error('Serialization failed');
        }),
      } as unknown as PokerEngine;

      // Should not throw
      await expect(persistEngineState('table-1', mockEngine)).resolves.toBeUndefined();

      expect(mockEngine.serialize).toHaveBeenCalled();
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('restoreEngineFromDb', () => {
    it('should restore engine from valid database state', async () => {
      const mockSerializedState: SerializedEngineState = {
        tableState: {
          tableId: 'table-1',
          players: [
            {
              id: 'player-1',
              name: 'Alice',
              stack: 1000,
              currentBet: 0,
              hasActed: false,
              isFolded: false,
              isAllIn: false,
              position: 0,
              holeCards: [],
            },
          ],
          smallBlind: 5,
          bigBlind: 10,
          pot: 0,
          currentBet: 0,
          minRaise: 10,
          stage: 'preflop',
          activePlayer: 'player-1',
          communityCards: [],
          variant: 'texas-holdem',
          bettingMode: 'no-limit',
        },
        deck: [
          { rank: 'A', suit: 'hearts' },
          { rank: 'K', suit: 'hearts' },
        ] as Card[],
        removedPlayers: [],
        rabbitPreviewed: 0,
        requireRitUnanimous: false,
        ritConsents: [],
      };

      mockQuery.mockResolvedValue({
        rows: [{ state: mockSerializedState }],
        rowCount: 1,
      });

      const mockRestoredEngine = { getState: jest.fn() } as unknown as PokerEngine;
      (PokerEngine.fromSerialized as jest.Mock).mockReturnValue(mockRestoredEngine);

      const result = await restoreEngineFromDb('table-1');

      expect(result).toBe(mockRestoredEngine);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT state FROM active_games'),
        ['table-1']
      );
      expect(PokerEngine.fromSerialized).toHaveBeenCalledWith(mockSerializedState);
    });

    it('should return null when no state found in database', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
      });

      const result = await restoreEngineFromDb('table-1');

      expect(result).toBeNull();
      expect(PokerEngine.fromSerialized).not.toHaveBeenCalled();
    });

    it('should return null when state is null in database', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ state: null }],
        rowCount: 1,
      });

      const result = await restoreEngineFromDb('table-1');

      expect(result).toBeNull();
      expect(PokerEngine.fromSerialized).not.toHaveBeenCalled();
    });

    it('should return null for invalid serialized state (missing tableState)', async () => {
      const invalidState = {
        deck: [],
        removedPlayers: [],
        rabbitPreviewed: 0,
      };

      mockQuery.mockResolvedValue({
        rows: [{ state: invalidState }],
        rowCount: 1,
      });

      const result = await restoreEngineFromDb('table-1');

      expect(result).toBeNull();
      expect(PokerEngine.fromSerialized).not.toHaveBeenCalled();
    });

    it('should return null for invalid serialized state (tableState not an object)', async () => {
      const invalidState = {
        tableState: 'not-an-object',
        deck: [],
      };

      mockQuery.mockResolvedValue({
        rows: [{ state: invalidState }],
        rowCount: 1,
      });

      const result = await restoreEngineFromDb('table-1');

      expect(result).toBeNull();
    });

    it('should return null for invalid serialized state (deck not an array)', async () => {
      const invalidState = {
        tableState: {
          tableId: 'table-1',
          players: [],
          smallBlind: 5,
          bigBlind: 10,
        },
        deck: 'not-an-array',
      };

      mockQuery.mockResolvedValue({
        rows: [{ state: invalidState }],
        rowCount: 1,
      });

      const result = await restoreEngineFromDb('table-1');

      expect(result).toBeNull();
    });

    it('should return null for invalid tableState (missing tableId)', async () => {
      const invalidState = {
        tableState: {
          players: [],
          smallBlind: 5,
          bigBlind: 10,
        },
        deck: [],
      };

      mockQuery.mockResolvedValue({
        rows: [{ state: invalidState }],
        rowCount: 1,
      });

      const result = await restoreEngineFromDb('table-1');

      expect(result).toBeNull();
    });

    it('should return null for invalid tableState (players not an array)', async () => {
      const invalidState = {
        tableState: {
          tableId: 'table-1',
          players: 'not-an-array',
          smallBlind: 5,
          bigBlind: 10,
        },
        deck: [],
      };

      mockQuery.mockResolvedValue({
        rows: [{ state: invalidState }],
        rowCount: 1,
      });

      const result = await restoreEngineFromDb('table-1');

      expect(result).toBeNull();
    });

    it('should return null for invalid tableState (missing smallBlind)', async () => {
      const invalidState = {
        tableState: {
          tableId: 'table-1',
          players: [],
          bigBlind: 10,
        },
        deck: [],
      };

      mockQuery.mockResolvedValue({
        rows: [{ state: invalidState }],
        rowCount: 1,
      });

      const result = await restoreEngineFromDb('table-1');

      expect(result).toBeNull();
    });

    it('should handle database query errors', async () => {
      mockQuery.mockRejectedValue(new Error('Database error'));

      const result = await restoreEngineFromDb('table-1');

      expect(result).toBeNull();
    });

    it('should handle PokerEngine.fromSerialized errors', async () => {
      const validState: SerializedEngineState = {
        tableState: {
          tableId: 'table-1',
          players: [],
          smallBlind: 5,
          bigBlind: 10,
          pot: 0,
          currentBet: 0,
          minRaise: 10,
          stage: 'preflop',
          activePlayer: '',
          communityCards: [],
          variant: 'texas-holdem',
          bettingMode: 'no-limit',
        },
        deck: [],
        removedPlayers: [],
        rabbitPreviewed: 0,
        requireRitUnanimous: false,
        ritConsents: [],
      };

      mockQuery.mockResolvedValue({
        rows: [{ state: validState }],
        rowCount: 1,
      });

      (PokerEngine.fromSerialized as jest.Mock).mockImplementation(() => {
        throw new Error('Deserialization error');
      });

      const result = await restoreEngineFromDb('table-1');

      expect(result).toBeNull();
    });
  });

  describe('getOrRestoreEngine', () => {
    it('should return cached engine if available', async () => {
      const mockEngine = {
        getState: jest.fn().mockReturnValue({}),
      } as unknown as PokerEngine;

      (global as any).activeGames = new Map([['table-1', mockEngine]]);

      const result = await getOrRestoreEngine('table-1');

      expect(result).toBe(mockEngine);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should restore from database if not in cache', async () => {
      const mockSerializedState: SerializedEngineState = {
        tableState: {
          tableId: 'table-1',
          players: [],
          smallBlind: 5,
          bigBlind: 10,
          pot: 0,
          currentBet: 0,
          minRaise: 10,
          stage: 'preflop',
          activePlayer: '',
          communityCards: [],
          variant: 'texas-holdem',
          bettingMode: 'no-limit',
        },
        deck: [],
        removedPlayers: [],
        rabbitPreviewed: 0,
        requireRitUnanimous: false,
        ritConsents: [],
      };

      mockQuery.mockResolvedValue({
        rows: [{ state: mockSerializedState }],
        rowCount: 1,
      });

      const mockRestoredEngine = {
        getState: jest.fn(),
      } as unknown as PokerEngine;
      (PokerEngine.fromSerialized as jest.Mock).mockReturnValue(mockRestoredEngine);

      const result = await getOrRestoreEngine('table-1');

      expect(result).toBe(mockRestoredEngine);
      expect(mockQuery).toHaveBeenCalled();
      // Should cache the engine
      expect((global as any).activeGames.get('table-1')).toBe(mockRestoredEngine);
    });

    it('should initialize activeGames map if not present', async () => {
      delete (global as any).activeGames;

      const mockSerializedState: SerializedEngineState = {
        tableState: {
          tableId: 'table-1',
          players: [],
          smallBlind: 5,
          bigBlind: 10,
          pot: 0,
          currentBet: 0,
          minRaise: 10,
          stage: 'preflop',
          activePlayer: '',
          communityCards: [],
          variant: 'texas-holdem',
          bettingMode: 'no-limit',
        },
        deck: [],
        removedPlayers: [],
        rabbitPreviewed: 0,
        requireRitUnanimous: false,
        ritConsents: [],
      };

      mockQuery.mockResolvedValue({
        rows: [{ state: mockSerializedState }],
        rowCount: 1,
      });

      const mockRestoredEngine = {
        getState: jest.fn(),
      } as unknown as PokerEngine;
      (PokerEngine.fromSerialized as jest.Mock).mockReturnValue(mockRestoredEngine);

      const result = await getOrRestoreEngine('table-1');

      expect(result).toBe(mockRestoredEngine);
      expect((global as any).activeGames).toBeInstanceOf(Map);
      expect((global as any).activeGames.get('table-1')).toBe(mockRestoredEngine);
    });

    it('should return null if engine not in cache and not in database', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
      });

      const result = await getOrRestoreEngine('table-1');

      expect(result).toBeNull();
    });

    it('should not cache invalid engines from database', async () => {
      const invalidState = {
        tableState: 'invalid',
        deck: [],
      };

      mockQuery.mockResolvedValue({
        rows: [{ state: invalidState }],
        rowCount: 1,
      });

      const result = await getOrRestoreEngine('table-1');

      expect(result).toBeNull();
      expect((global as any).activeGames.has('table-1')).toBe(false);
    });

    it('should handle cache check when activeGames exists but is not a Map', async () => {
      (global as any).activeGames = 'not-a-map';

      const mockSerializedState: SerializedEngineState = {
        tableState: {
          tableId: 'table-1',
          players: [],
          smallBlind: 5,
          bigBlind: 10,
          pot: 0,
          currentBet: 0,
          minRaise: 10,
          stage: 'preflop',
          activePlayer: '',
          communityCards: [],
          variant: 'texas-holdem',
          bettingMode: 'no-limit',
        },
        deck: [],
        removedPlayers: [],
        rabbitPreviewed: 0,
        requireRitUnanimous: false,
        ritConsents: [],
      };

      mockQuery.mockResolvedValue({
        rows: [{ state: mockSerializedState }],
        rowCount: 1,
      });

      const mockRestoredEngine = {
        getState: jest.fn(),
      } as unknown as PokerEngine;
      (PokerEngine.fromSerialized as jest.Mock).mockReturnValue(mockRestoredEngine);

      // The function will try to call .get() on the string and should fail gracefully
      // or we need to restore from DB
      await expect(getOrRestoreEngine('table-1')).rejects.toThrow();
    });

    it('should not return cached engine if it lacks getState function', async () => {
      const invalidEngine = { someOtherMethod: jest.fn() };
      (global as any).activeGames = new Map([['table-1', invalidEngine]]);

      const mockSerializedState: SerializedEngineState = {
        tableState: {
          tableId: 'table-1',
          players: [],
          smallBlind: 5,
          bigBlind: 10,
          pot: 0,
          currentBet: 0,
          minRaise: 10,
          stage: 'preflop',
          activePlayer: '',
          communityCards: [],
          variant: 'texas-holdem',
          bettingMode: 'no-limit',
        },
        deck: [],
        removedPlayers: [],
        rabbitPreviewed: 0,
        requireRitUnanimous: false,
        ritConsents: [],
      };

      mockQuery.mockResolvedValue({
        rows: [{ state: mockSerializedState }],
        rowCount: 1,
      });

      const mockRestoredEngine = {
        getState: jest.fn(),
      } as unknown as PokerEngine;
      (PokerEngine.fromSerialized as jest.Mock).mockReturnValue(mockRestoredEngine);

      const result = await getOrRestoreEngine('table-1');

      expect(result).toBe(mockRestoredEngine);
    });
  });
});
