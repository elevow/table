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

  it('should handle player disconnection', () => {
    recovery.handleDisconnect('player1', 'table1');
    expect(recovery.isInGracePeriod('player1')).toBe(true);
  });

  it('should handle player reconnection within grace period', () => {
    recovery.handleDisconnect('player1', 'table1');
    const reconciliation = recovery.handleReconnect('player1', mockState);
    
    expect(reconciliation).toBeDefined();
    expect(reconciliation?.tableId).toBe('table1');
    expect(reconciliation?.fullState).toEqual(mockState);
  });

  it('should record and retrieve missed actions', () => {
    recovery.handleDisconnect('player1', 'table1');
    
    // Add a delay to ensure timestamp is after disconnect
    const action: PlayerAction = {
      type: 'bet',
      playerId: 'player2',
      tableId: 'table1',
      amount: 50,
      timestamp: Date.now() + 1 // ensure timestamp is after disconnect
    };

    recovery.recordAction('table1', action);

    const missedActions = recovery.getMissedActions('player1');

    expect(missedActions).toHaveLength(1);
    expect(missedActions[0]).toEqual({ ...action, tableId: 'table1' });
  });

  it('should identify timed out players', () => {
    jest.useFakeTimers();

    recovery.handleDisconnect('player1', 'table1');
    
    // Advance time past grace period
    jest.advanceTimersByTime(2000);

    const timeouts = recovery.checkTimeouts();
    expect(timeouts).toHaveLength(1);
    expect(timeouts[0]).toEqual({ playerId: 'player1', tableId: 'table1' });

    jest.useRealTimers();
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

    const actions = recovery.getMissedActions('somePlayer');
    expect(actions.length).toBeLessThanOrEqual(10);
  });

  it('should clear table history', () => {
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

  it('should handle grace period expiration', () => {
    jest.useFakeTimers();

    recovery.handleDisconnect('player1', 'table1');
    expect(recovery.isInGracePeriod('player1')).toBe(true);

    jest.advanceTimersByTime(2000);
    expect(recovery.isInGracePeriod('player1')).toBe(false);

    jest.useRealTimers();
  });
});
