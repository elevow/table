import { StateRecovery } from '../state-recovery';
import { PlayerAction, TableState } from '../../types/poker';

describe('StateRecovery', () => {
  let recovery: StateRecovery;
  let mockState: TableState;

  beforeEach(() => {
    recovery = new StateRecovery({ graceTimeout: 1000, maxHistorySize: 10 });
    mockState = {
      tableId: 'table1',
      stage: 'preflop',
      players: [
        { id: 'player1', name: 'P1', position: 0, stack: 1000, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30000 },
        { id: 'player2', name: 'P2', position: 1, stack: 1000, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30000 }
      ],
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
  });

  describe('Disconnection and Reconnection', () => {
    it('should generate valid reconnect token on disconnect', () => {
      const token = recovery.handleDisconnect('player1', 'table1');
      const status = recovery.getGracePeriodStatus('player1');
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
      expect(recovery.validateReconnectToken('player1', token)).toBe(true);
    });

    it('should track grace period status', () => {
      recovery.handleDisconnect('player1', 'table1');
      const status = recovery.getGracePeriodStatus('player1');
      
      expect(status.inGracePeriod).toBe(true);
      expect(status.remainingTime).toBeGreaterThan(0);
      expect(status.remainingTime).toBeLessThanOrEqual(1000);
    });

    it('should handle reconnection with valid token', () => {
      const token = recovery.handleDisconnect('player1', 'table1');
      const reconciliation = recovery.handleReconnect('player1', mockState, token);
      
      expect(reconciliation).toBeDefined();
      expect(reconciliation?.tableId).toBe('table1');
      expect(reconciliation?.fullState).toEqual(mockState);
      expect(reconciliation?.recoveryState).toBeDefined();
      expect(reconciliation?.recoveryState.reconnectToken).toBe(token);
    });

    it('should reject reconnection with invalid token', () => {
      recovery.handleDisconnect('player1', 'table1');
      const reconciliation = recovery.handleReconnect('player1', mockState, 'invalid-token');
      
      expect(reconciliation).toBeNull();
    });
  });

  describe('Action History and Recovery', () => {
    it('should record and replay missed actions in order', () => {
      recovery.handleDisconnect('player1', 'table1');
      
      const actions: PlayerAction[] = [
        {
          type: 'bet',
          playerId: 'player2',
          tableId: 'table1',
          amount: 50,
          timestamp: Date.now() + 1
        },
        {
          type: 'call',
          playerId: 'player3',
          tableId: 'table1',
          amount: 50,
          timestamp: Date.now() + 2
        }
      ];

      actions.forEach(action => recovery.recordAction('table1', action));
      const replayedActions = recovery.replayMissedActions('player1');

      expect(replayedActions).toHaveLength(2);
      expect(replayedActions[0].timestamp).toBeLessThan(replayedActions[1].timestamp);
      expect(replayedActions.map(a => a.type)).toEqual(['bet', 'call']);
    });

    it('should maintain action history size limit', () => {
      for (let i = 0; i < 15; i++) {
        recovery.recordAction('table1', {
          type: 'bet',
          playerId: 'player1',
          tableId: 'table1',
          amount: 10,
          timestamp: Date.now() + i
        });
      }

      const actions = recovery.getMissedActions('player1');
      expect(actions.length).toBeLessThanOrEqual(10);
    });

    it('should clear history when table completes', () => {
      recovery.recordAction('table1', {
        type: 'bet',
        playerId: 'player1',
        tableId: 'table1',
        amount: 10,
        timestamp: Date.now()
      });

      recovery.clearTableHistory('table1');
      expect(recovery.getMissedActions('player1')).toHaveLength(0);
    });
  });

  describe('Grace Period and Timeouts', () => {
    it('should track grace period expiration', () => {
      jest.useFakeTimers();
      recovery.handleDisconnect('player1', 'table1');

      const initialStatus = recovery.getGracePeriodStatus('player1');
      expect(initialStatus.inGracePeriod).toBe(true);
      expect(initialStatus.remainingTime).toBeGreaterThan(0);

      jest.advanceTimersByTime(2000);
      
      const expiredStatus = recovery.getGracePeriodStatus('player1');
      expect(expiredStatus.inGracePeriod).toBe(false);
      expect(expiredStatus.remainingTime).toBe(0);

      jest.useRealTimers();
    });

    it('should identify timed out players', () => {
      jest.useFakeTimers();
      recovery.handleDisconnect('player1', 'table1');
      
      jest.advanceTimersByTime(2000);

      const timeouts = recovery.checkTimeouts();
      expect(timeouts).toHaveLength(1);
      expect(timeouts[0]).toEqual({ playerId: 'player1', tableId: 'table1' });

      jest.useRealTimers();
    });
  });
});
