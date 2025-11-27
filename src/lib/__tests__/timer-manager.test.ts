import { TimerManager, TimerState, TimerConfig } from '../timer-manager';
import { Broadcaster } from '../broadcaster';
import { StateManager } from '../state-manager';

// Mock dependencies
const mockEmit = jest.fn();
const mockTo = jest.fn(() => ({ emit: mockEmit }));
const mockBroadcaster: Broadcaster = {
  emit: mockEmit,
  to: mockTo
};

const mockHandleAction = jest.fn();
const mockStateManager = {
  handleAction: mockHandleAction
} as unknown as StateManager;

describe('TimerManager', () => {
  let timerManager: TimerManager;
  let config: Partial<TimerConfig>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    config = {
      defaultDuration: 30000,
      warningThreshold: 10000,
      timeBankInitial: 120000,
      timeBankMax: 300000,
      timeBankReplenishAmount: 30000,
      timeBankReplenishInterval: 3600000
    };

    timerManager = new TimerManager(mockBroadcaster, mockStateManager, config);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should create a TimerManager with default config', () => {
      const manager = new TimerManager(mockBroadcaster, mockStateManager);
      expect(manager).toBeDefined();
    });

    it('should create a TimerManager with custom config', () => {
      const manager = new TimerManager(mockBroadcaster, mockStateManager, config);
      expect(manager).toBeDefined();
    });
  });

  describe('startTimer()', () => {
    it('should start a timer for a player', () => {
      timerManager.startTimer('table-1', 'player-1');
      const state = timerManager.getTimerState('table-1');
      expect(state).toBeDefined();
      expect(state?.activePlayer).toBe('player-1');
    });

    it('should initialize time bank for new players', () => {
      timerManager.startTimer('table-1', 'player-1');
      const timeBank = timerManager.getTimeBank('player-1');
      expect(timeBank).toBe(120000);
    });

    it('should broadcast timer state', () => {
      timerManager.startTimer('table-1', 'player-1');
      expect(mockTo).toHaveBeenCalledWith('table-1');
      expect(mockEmit).toHaveBeenCalledWith('timer_update', expect.any(Object));
    });

    it('should set correct timer duration', () => {
      timerManager.startTimer('table-1', 'player-1');
      const state = timerManager.getTimerState('table-1');
      expect(state?.duration).toBe(30000);
    });
  });

  describe('stopTimer()', () => {
    it('should stop an active timer', () => {
      timerManager.startTimer('table-1', 'player-1');
      timerManager.stopTimer('table-1');
      const state = timerManager.getTimerState('table-1');
      expect(state).toBeUndefined();
    });

    it('should broadcast timer removal', () => {
      timerManager.startTimer('table-1', 'player-1');
      jest.clearAllMocks();
      timerManager.stopTimer('table-1');
      expect(mockTo).toHaveBeenCalledWith('table-1');
      expect(mockEmit).toHaveBeenCalledWith('timer_update', undefined);
    });

    it('should not throw when stopping non-existent timer', () => {
      expect(() => timerManager.stopTimer('non-existent')).not.toThrow();
    });
  });

  describe('useTimeBank()', () => {
    it('should return false if no timer exists', () => {
      const result = timerManager.useTimeBank('table-1', 'player-1');
      expect(result).toBe(false);
    });

    it('should return false if player is not the active player', () => {
      timerManager.startTimer('table-1', 'player-1');
      const result = timerManager.useTimeBank('table-1', 'player-2');
      expect(result).toBe(false);
    });

    it('should return true and use time bank when valid', () => {
      timerManager.startTimer('table-1', 'player-1');
      const result = timerManager.useTimeBank('table-1', 'player-1');
      expect(result).toBe(true);
    });

    it('should set time bank to 0 after use', () => {
      timerManager.startTimer('table-1', 'player-1');
      timerManager.useTimeBank('table-1', 'player-1');
      const timeBank = timerManager.getTimeBank('player-1');
      expect(timeBank).toBe(0);
    });

    it('should return false if time bank is already 0', () => {
      timerManager.startTimer('table-1', 'player-1');
      timerManager.useTimeBank('table-1', 'player-1');
      const result = timerManager.useTimeBank('table-1', 'player-1');
      expect(result).toBe(false);
    });
  });

  describe('getTimerState()', () => {
    it('should return undefined for non-existent timer', () => {
      const state = timerManager.getTimerState('non-existent');
      expect(state).toBeUndefined();
    });

    it('should return timer state for existing timer', () => {
      timerManager.startTimer('table-1', 'player-1');
      const state = timerManager.getTimerState('table-1');
      expect(state).toBeDefined();
      expect(state?.activePlayer).toBe('player-1');
    });
  });

  describe('getTimeBank()', () => {
    it('should return 0 for unknown player', () => {
      const timeBank = timerManager.getTimeBank('unknown-player');
      expect(timeBank).toBe(0);
    });

    it('should return time bank amount for known player', () => {
      timerManager.startTimer('table-1', 'player-1');
      const timeBank = timerManager.getTimeBank('player-1');
      expect(timeBank).toBe(120000);
    });
  });

  describe('checkAndReplenishTimeBanks()', () => {
    it('should not throw when called', () => {
      expect(() => timerManager.checkAndReplenishTimeBanks()).not.toThrow();
    });

    it('should replenish time bank after interval', () => {
      timerManager.startTimer('table-1', 'player-1');
      timerManager.useTimeBank('table-1', 'player-1');
      expect(timerManager.getTimeBank('player-1')).toBe(0);
      
      // Advance time by the replenish interval
      jest.advanceTimersByTime(3600000);
      timerManager.checkAndReplenishTimeBanks();
      
      expect(timerManager.getTimeBank('player-1')).toBeGreaterThan(0);
    });
  });

  describe('timer timeout', () => {
    it('should trigger auto-fold on timeout', () => {
      timerManager.startTimer('table-1', 'player-1');
      
      // Advance time past the timer duration
      jest.advanceTimersByTime(31000);
      
      expect(mockHandleAction).toHaveBeenCalledWith(
        'table-1',
        expect.objectContaining({
          type: 'fold',
          playerId: 'player-1',
          tableId: 'table-1'
        })
      );
    });
  });

  describe('warning threshold', () => {
    it('should broadcast warning when threshold reached', () => {
      timerManager.startTimer('table-1', 'player-1');
      jest.clearAllMocks();
      
      // Advance time to just past the warning threshold (30000 - 10000 = 20000ms)
      jest.advanceTimersByTime(21000);
      
      const emitCalls = mockEmit.mock.calls;
      const timerUpdates = emitCalls.filter((call: any[]) => call[0] === 'timer_update');
      const hasWarningUpdate = timerUpdates.some((call: any[]) => call[1]?.warning === true);
      expect(hasWarningUpdate).toBe(true);
    });
  });
});
