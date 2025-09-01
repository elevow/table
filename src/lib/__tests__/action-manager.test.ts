import { Server as SocketServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { ActionManager } from '../action-manager';
import { StateManager } from '../state-manager';
import { PlayerAction, TableState, Player } from '../../types/poker';

jest.mock('socket.io', () => {
  const mockEmit = jest.fn();
  const mockOn = jest.fn();
  const mockTo = jest.fn(() => ({ emit: mockEmit }));
  
  return {
    Server: jest.fn().mockImplementation(() => ({
      on: mockOn,
      to: mockTo,
      emit: mockEmit
    }))
  };
});

describe('ActionManager', () => {
  let actionManager: ActionManager;
  let mockIo: jest.Mocked<SocketServer>;
  let mockStateManager: jest.Mocked<StateManager>;
  let mockState: TableState;
  let mockPlayer: Player;

  beforeEach(() => {
    mockPlayer = {
      id: 'player1',
      name: 'Player 1',
      stack: 1000,
      currentBet: 0,
      hasActed: false,
      isFolded: false,
      isAllIn: false,
      position: 0,
      timeBank: 30000
    };

    mockState = {
      tableId: 'table1',
      stage: 'preflop',
      players: [mockPlayer],
      activePlayer: 'player1',
      pot: 0,
      communityCards: [],
      currentBet: 0,
      dealerPosition: 0,
      smallBlind: 10,
      bigBlind: 20,
      minRaise: 20,
      lastRaise: 0
    };

    mockIo = new SocketServer({} as HttpServer) as jest.Mocked<SocketServer>;
    mockStateManager = {
      getState: jest.fn().mockReturnValue(mockState),
      updateState: jest.fn().mockResolvedValue(true)
    } as unknown as jest.Mocked<StateManager>;

    actionManager = new ActionManager(mockStateManager, mockIo);

    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('handlePlayerAction', () => {
    it('should process valid bet action', async () => {
      const action: PlayerAction = {
        type: 'bet',
        playerId: 'player1',
        tableId: 'table1',
        amount: 100,
        timestamp: Date.now()
      };

      const result = await actionManager.handlePlayerAction(action);
      expect(result.success).toBe(true);
      expect(result.state?.pot).toBe(100);
      expect(mockStateManager.updateState).toHaveBeenCalled();
      expect(mockIo.to).toHaveBeenCalledWith('table1');
    });

    it('should handle player timeout', async () => {
      const action: PlayerAction = {
        type: 'bet',
        playerId: 'player1',
        tableId: 'table1',
        amount: 100,
        timestamp: Date.now()
      };

      await actionManager.handlePlayerAction(action);
      
      // Advance timers to trigger timeout
      jest.advanceTimersByTime(31000);

      // Should have emitted a fold action
      expect(mockIo.to).toHaveBeenLastCalledWith('table1');
      expect(mockIo.to('table1').emit).toHaveBeenLastCalledWith(
        'player_action',
        expect.objectContaining({
          type: 'fold',
          playerId: 'player1'
        })
      );
    });

    it('should validate actions', async () => {
      const invalidAction: PlayerAction = {
        type: 'bet',
        playerId: 'player1',
        tableId: 'table1',
        amount: 10, // Less than big blind
        timestamp: Date.now()
      };

      const result = await actionManager.handlePlayerAction(invalidAction);
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
      expect(mockStateManager.updateState).not.toHaveBeenCalled();
    });

    it('should move to next stage when betting round complete', async () => {
      const player2 = {
        ...mockPlayer,
        id: 'player2',
        position: 1,
        currentBet: 20,
        hasActed: true
      };
      mockState.players.push(player2);

      const action: PlayerAction = {
        type: 'call',
        playerId: 'player1',
        tableId: 'table1',
        timestamp: Date.now()
      };

      mockState.currentBet = 20;
      const result = await actionManager.handlePlayerAction(action);

      expect(result.success).toBe(true);
      expect(result.state?.stage).toBe('flop');
      expect(result.state?.currentBet).toBe(0);
      expect(result.state?.players.every(p => !p.hasActed)).toBe(true);
    });
  });

  describe('disconnect grace auto-action', () => {
    it('emits check when not facing a bet (check-fold path)', async () => {
      // Ensure player is not facing a bet
      mockState.currentBet = 0;
      mockPlayer.currentBet = 0;
      // Shorten timeBank to minimum grace (5000ms enforced by Math.max)
      mockPlayer.timeBank = 1000;

      // Call the private scheduler directly
      (actionManager as any).scheduleAutoAction('table1', 'player1');

      // Advance to after grace window
      jest.advanceTimersByTime(5000);

      // Expect a check to be broadcast as part of check-fold behavior
      expect(mockIo.to).toHaveBeenLastCalledWith('table1');
      expect(mockIo.to('table1').emit).toHaveBeenLastCalledWith(
        'player_action',
        expect.objectContaining({ type: 'check', playerId: 'player1' })
      );
    });

    it('emits fold when facing a bet (check-fold path)', async () => {
      // Facing a bet: table currentBet > player's currentBet
      mockState.currentBet = 50;
      mockPlayer.currentBet = 0;
      mockPlayer.timeBank = 1000;

      (actionManager as any).scheduleAutoAction('table1', 'player1');

      jest.advanceTimersByTime(5000);

      expect(mockIo.to).toHaveBeenLastCalledWith('table1');
      expect(mockIo.to('table1').emit).toHaveBeenLastCalledWith(
        'player_action',
        expect.objectContaining({ type: 'fold', playerId: 'player1' })
      );
    });
  });
});
