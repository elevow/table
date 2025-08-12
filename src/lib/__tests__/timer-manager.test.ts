import { Server as SocketServer } from 'socket.io';
import { TimerManager, TimerState } from '../timer-manager';
import { StateManager } from '../state-manager';
import { PlayerAction } from '../../types/poker';

jest.mock('socket.io');
jest.mock('../state-manager');

describe('TimerManager', () => {
  let timerManager: TimerManager;
  let mockIo: jest.Mocked<SocketServer>;
  let mockStateManager: jest.Mocked<StateManager>;

  beforeEach(() => {
    jest.useFakeTimers();
    mockIo = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn()
    } as any;
    mockStateManager = {
      handleAction: jest.fn()
    } as any;

    // Create timer manager with custom config for testing
    timerManager = new TimerManager(mockIo, mockStateManager, {
      defaultDuration: 15000, // 15 seconds
      warningThreshold: 5000, // 5 seconds
      timeBankInitial: 60000, // 1 minute
      timeBankMax: 120000, // 2 minutes
      timeBankReplenishAmount: 15000, // 15 seconds
      timeBankReplenishInterval: 1800000 // 30 minutes
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    mockIo.to.mockClear();
    mockIo.emit.mockClear();
    mockStateManager.handleAction.mockClear();
  });

  describe('startTimer', () => {
    it('should start a new timer and broadcast state', () => {
      timerManager.startTimer('table1', 'player1');

      const timerState = timerManager.getTimerState('table1');
      expect(timerState).toBeDefined();
      expect(timerState?.activePlayer).toBe('player1');
      expect(timerState?.duration).toBe(15000);
      expect(mockIo.to).toHaveBeenCalledWith('table1');
      expect(mockIo.emit).toHaveBeenCalledWith('timer_update', expect.any(Object));
    });

    it('should initialize time bank for new players', () => {
      timerManager.startTimer('table1', 'player1');
      expect(timerManager.getTimeBank('player1')).toBe(60000);
    });

    it('should reset warning flag when starting new timer', () => {
      // Start timer and advance to warning state
      timerManager.startTimer('table1', 'player1');
      jest.advanceTimersByTime(11000);
      
      // Start new timer for same player
      timerManager.startTimer('table1', 'player1');
      const timerState = timerManager.getTimerState('table1');
      expect(timerState?.warning).toBe(false);
    });

    it('should handle multiple players at different tables', () => {
      timerManager.startTimer('table1', 'player1');
      timerManager.startTimer('table2', 'player2');

      const timer1 = timerManager.getTimerState('table1');
      const timer2 = timerManager.getTimerState('table2');

      expect(timer1?.activePlayer).toBe('player1');
      expect(timer2?.activePlayer).toBe('player2');
    });

    it('should override existing timer for the same table', () => {
      timerManager.startTimer('table1', 'player1');
      timerManager.startTimer('table1', 'player2');

      const timerState = timerManager.getTimerState('table1');
      expect(timerState?.activePlayer).toBe('player2');
    });
  });

  describe('useTimeBank', () => {
    it('should allow using time bank when available', () => {
      timerManager.startTimer('table1', 'player1');
      const result = timerManager.useTimeBank('table1', 'player1');
      
      const timerState = timerManager.getTimerState('table1');
      expect(result).toBe(true);
      expect(timerManager.getTimeBank('player1')).toBe(0);
      expect(timerState?.duration).toBeGreaterThan(15000); // Should include time bank
      expect(mockIo.to).toHaveBeenCalledWith('table1');
      expect(mockIo.emit).toHaveBeenCalledWith('timer_update', expect.any(Object));
    });

    it('should not allow using time bank when empty', () => {
      timerManager.startTimer('table1', 'player1');
      timerManager.useTimeBank('table1', 'player1'); // Use up time bank
      const result = timerManager.useTimeBank('table1', 'player1');
      
      expect(result).toBe(false);
      expect(timerManager.getTimeBank('player1')).toBe(0);
    });

    it('should not allow using time bank for wrong player', () => {
      timerManager.startTimer('table1', 'player1');
      const result = timerManager.useTimeBank('table1', 'player2');
      
      expect(result).toBe(false);
      expect(timerManager.getTimeBank('player1')).toBe(60000);
    });

    it('should add remaining regular time when using time bank', () => {
      timerManager.startTimer('table1', 'player1');
      jest.advanceTimersByTime(5000); // 10 seconds remaining
      
      timerManager.useTimeBank('table1', 'player1');
      const timerState = timerManager.getTimerState('table1');
      
      expect(timerState?.duration).toBe(70000); // 10s remaining + 60s time bank
    });

    it('should reset warning state when using time bank', () => {
      timerManager.startTimer('table1', 'player1');
      jest.advanceTimersByTime(11000); // Trigger warning
      
      timerManager.useTimeBank('table1', 'player1');
      const timerState = timerManager.getTimerState('table1');
      
      expect(timerState?.warning).toBe(false);
    });
  });

  describe('timeout handling', () => {
    it('should emit warning when approaching timeout', () => {
      timerManager.startTimer('table1', 'player1');
      jest.advanceTimersByTime(10000); // 5 seconds before timeout

      expect(mockIo.to).toHaveBeenCalledWith('table1');
      expect(mockIo.emit).toHaveBeenCalledWith('timer_update', expect.objectContaining({
        warning: true
      }));
    });

    it('should auto-fold on timeout', () => {
      timerManager.startTimer('table1', 'player1');
      jest.advanceTimersByTime(15000); // Full duration

      expect(mockStateManager.handleAction).toHaveBeenCalledWith('table1', expect.objectContaining({
        type: 'fold',
        playerId: 'player1',
        tableId: 'table1'
      }));
    });

    it('should handle concurrent timeouts for different tables', () => {
      timerManager.startTimer('table1', 'player1');
      timerManager.startTimer('table2', 'player2');
      jest.advanceTimersByTime(15000);

      expect(mockStateManager.handleAction).toHaveBeenCalledWith('table1', expect.objectContaining({
        type: 'fold',
        playerId: 'player1'
      }));
      expect(mockStateManager.handleAction).toHaveBeenCalledWith('table2', expect.objectContaining({
        type: 'fold',
        playerId: 'player2'
      }));
    });

    it('should not timeout if timer is stopped', () => {
      timerManager.startTimer('table1', 'player1');
      jest.advanceTimersByTime(10000);
      timerManager.stopTimer('table1');
      jest.advanceTimersByTime(5000);

      expect(mockStateManager.handleAction).not.toHaveBeenCalled();
    });

    it('should not emit warning after timer is stopped', () => {
      timerManager.startTimer('table1', 'player1');
      timerManager.stopTimer('table1');
      jest.advanceTimersByTime(10000);

      expect(mockIo.emit).not.toHaveBeenCalledWith('timer_update', expect.objectContaining({
        warning: true
      }));
    });

    it('should handle timeout after time bank is depleted', () => {
      timerManager.startTimer('table1', 'player1');
      timerManager.useTimeBank('table1', 'player1');
      jest.advanceTimersByTime(75000); // Regular time (15s) + time bank (60s)

      expect(mockStateManager.handleAction).toHaveBeenCalledWith('table1', expect.objectContaining({
        type: 'fold',
        playerId: 'player1'
      }));
    });
  });

  describe('time bank replenishment', () => {
    let now: number;

    beforeEach(() => {
      now = Date.now();
      jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
      jest.spyOn(Date, 'now').mockRestore();
    });

    it('should replenish time bank after interval', () => {
      timerManager.startTimer('table1', 'player1');
      now += 1800000; // 30 minutes
      timerManager.checkAndReplenishTimeBanks();

      expect(mockIo.to).toHaveBeenCalledWith('player1');
      expect(mockIo.emit).toHaveBeenCalledWith('timebank_update', expect.objectContaining({
        amount: expect.any(Number)
      }));
    });

    it('should not exceed maximum time bank', () => {
      timerManager.startTimer('table1', 'player1');
      now += 7200000; // 2 hours
      timerManager.checkAndReplenishTimeBanks();

      const timeBank = timerManager.getTimeBank('player1');
      expect(timeBank).toBeLessThanOrEqual(120000); // 2 minutes max
    });

    it('should replenish correct amount', () => {
      timerManager.startTimer('table1', 'player1');
      timerManager.useTimeBank('table1', 'player1'); // Use entire time bank
      now += 1800000; // 30 minutes
      timerManager.checkAndReplenishTimeBanks();

      const timeBank = timerManager.getTimeBank('player1');
      expect(timeBank).toBe(15000); // 15 second replenishment
    });

    it('should handle multiple replenishment cycles', () => {
      timerManager.startTimer('table1', 'player1');
      timerManager.useTimeBank('table1', 'player1'); // Use entire time bank
      
      // Three replenishment cycles
      now += 5400000; // 90 minutes
      timerManager.checkAndReplenishTimeBanks();
      
      const timeBank = timerManager.getTimeBank('player1');
      expect(timeBank).toBe(45000); // 3 * 15 seconds
    });

    it('should track replenishment time per player', () => {
      // Initialize players with time banks (60s each)
      timerManager.startTimer('table1', 'player1');
      timerManager.startTimer('table2', 'player2');
      
      // First replenishment (both players get +15s)
      now += 1800000; // 30 minutes
      timerManager.checkAndReplenishTimeBanks();
      
      // Use time bank for player 1
      timerManager.useTimeBank('table1', 'player1');
      // After using time bank, player1 has 0, player2 has 75s (60s initial + 15s)
      
      // Second replenishment (both players get +15s)
      now += 1800000; // 30 minutes more
      timerManager.checkAndReplenishTimeBanks();
      
      // Player1: 0 + 15s = 15s
      expect(timerManager.getTimeBank('player1')).toBe(15000);
      // Player2: 75s + 15s = 90s
      expect(timerManager.getTimeBank('player2')).toBe(90000);
    });
  });

  describe('stopTimer', () => {
    it('should clear timer state', () => {
      timerManager.startTimer('table1', 'player1');
      timerManager.stopTimer('table1');
      
      const timerState = timerManager.getTimerState('table1');
      expect(timerState).toBeUndefined();
    });

    it('should not affect other tables', () => {
      timerManager.startTimer('table1', 'player1');
      timerManager.startTimer('table2', 'player2');
      timerManager.stopTimer('table1');
      
      const timer1 = timerManager.getTimerState('table1');
      const timer2 = timerManager.getTimerState('table2');
      
      expect(timer1).toBeUndefined();
      expect(timer2).toBeDefined();
    });

    it('should broadcast timer removal', () => {
      timerManager.startTimer('table1', 'player1');
      timerManager.stopTimer('table1');
      
      expect(mockIo.to).toHaveBeenCalledWith('table1');
      expect(mockIo.emit).toHaveBeenCalledWith('timer_update', undefined);
    });
  });
});
