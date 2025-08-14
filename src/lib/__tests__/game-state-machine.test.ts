import { PokerGameStateMachine } from '../game-state-machine';
import { GameAction, TableState } from '../../types/poker';
import { GameState } from '../../types/state';

describe('PokerGameStateMachine', () => {
  let stateMachine: PokerGameStateMachine;

  beforeEach(() => {
    (PokerGameStateMachine as any).instance = undefined;
    stateMachine = PokerGameStateMachine.getInstance();
  });

  describe('Initialization', () => {
    it('should initialize in idle state', () => {
      expect(stateMachine.currentState).toBe('idle');
    });

    it('should return same instance when getInstance is called multiple times', () => {
      const instance1 = PokerGameStateMachine.getInstance();
      const instance2 = PokerGameStateMachine.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('State Transitions', () => {
    it('should transition through game setup states', () => {
      const initAction: GameAction = {
        type: 'initialize',
        tableId: 'table1',
        timestamp: Date.now()
      };

      const joinAction: GameAction = {
        type: 'join',
        tableId: 'table1',
        playerId: 'player1',
        timestamp: Date.now()
      };

      const startAction: GameAction = {
        type: 'start',
        tableId: 'table1',
        timestamp: Date.now()
      };

      const dealAction: GameAction = {
        type: 'deal',
        tableId: 'table1',
        timestamp: Date.now()
      };

      expect(stateMachine.transition(initAction)).toBe(true);
      expect(stateMachine.currentState).toBe('initializing');

      expect(stateMachine.transition(joinAction)).toBe(true);
      expect(stateMachine.currentState).toBe('waitingForPlayers');

      expect(stateMachine.transition(startAction)).toBe(true);
      expect(stateMachine.currentState).toBe('starting');

      expect(stateMachine.transition(dealAction)).toBe(true);
      expect(stateMachine.currentState).toBe('dealingCards');
    });
  });

  describe('Gameplay State Transitions', () => {
    beforeEach(() => {
      setupGameAndTableState();
    });

    function setupGameAndTableState() {
      const actions: GameAction[] = [
        {
          type: 'initialize',
          tableId: 'table1',
          timestamp: Date.now()
        },
        {
          type: 'join',
          tableId: 'table1',
          playerId: 'player1',
          timestamp: Date.now()
        },
        {
          type: 'start',
          tableId: 'table1',
          timestamp: Date.now()
        },
        {
          type: 'deal',
          tableId: 'table1',
          timestamp: Date.now()
        }
      ];

      actions.forEach(action => stateMachine.transition(action));

      const tableState: TableState = {
        tableId: 'table1',
        players: [
          {
            id: 'player1',
            name: 'Player 1',
            stack: 1000,
            currentBet: 10,
            position: 0,
            hasActed: true,
            isFolded: false,
            isAllIn: false,
            timeBank: 30000
          },
          {
            id: 'player2',
            name: 'Player 2',
            stack: 1000,
            currentBet: 10,
            position: 1,
            hasActed: true,
            isFolded: false,
            isAllIn: false,
            timeBank: 30000
          }
        ],
        pot: 20,
        currentBet: 10,
        stage: 'preflop',
        activePlayer: '',
        dealerPosition: 0,
        smallBlind: 5,
        bigBlind: 10,
        minRaise: 20,
        lastRaise: 10,
        communityCards: []
      };

      stateMachine.setTableState(tableState);
    }

    it('should handle all-in situations', () => {
      const allInTableState: TableState = {
        ...stateMachine.getTableState()!,
        players: [
          {
            id: 'player1',
            name: 'Player 1',
            stack: 1000,
            currentBet: 1000,
            position: 0,
            hasActed: true,
            isFolded: false,
            isAllIn: true,
            timeBank: 30000
          },
          {
            id: 'player2',
            name: 'Player 2',
            stack: 1000,
            currentBet: 1000,
            position: 1,
            hasActed: true,
            isFolded: false,
            isAllIn: true,
            timeBank: 30000
          }
        ],
        currentBet: 1000
      };

      stateMachine.setTableState(allInTableState);

      // Setup table state with all-in scenario
      const tableState = {
        tableId: 'table1',
        players: [
          { id: 'player1', isAllIn: true, currentBet: 1000, isFolded: false, hasActed: true },
          { id: 'player2', isAllIn: false, currentBet: 0, isFolded: false, hasActed: false }
        ],
        currentBet: 1000
      };
      (stateMachine as any).tableState = tableState;

      const betAction: GameAction = {
        type: 'bet',
        tableId: 'table1',
        playerId: 'player1',
        amount: 1000,
        timestamp: Date.now(),
        metadata: { isAllIn: true }
      };

      expect(stateMachine.transition(betAction)).toBe(true);
      expect(stateMachine.currentState).toBe('showdown');
    });
  });

  describe('Error Handling', () => {
    it('should handle explicit error transitions', () => {
      const errorAction: GameAction = {
        type: 'error',
        tableId: 'table1',
        timestamp: Date.now(),
        metadata: { error: 'Test error' }
      };

      expect(stateMachine.transition(errorAction)).toBe(true);
      expect(stateMachine.currentState).toBe('error');
    });

    it('should track error in transition history', () => {
      const errorAction: GameAction = {
        type: 'error',
        tableId: 'table1',
        timestamp: Date.now(),
        metadata: { error: 'Test error' }
      };

      stateMachine.transition(errorAction);
      const lastTransition = stateMachine.history[stateMachine.history.length - 1];
      expect(lastTransition.to).toBe('error');
      expect(lastTransition.trigger.type).toBe('error');
    });
  });

  describe('Recovery Points', () => {
    beforeEach(() => {
      const tableState: TableState = {
        tableId: 'table1',
        players: [
          {
            id: 'player1',
            name: 'Player 1',
            stack: 1000,
            currentBet: 10,
            position: 0,
            hasActed: true,
            isFolded: false,
            isAllIn: false,
            timeBank: 30000
          }
        ],
        pot: 10,
        currentBet: 10,
        stage: 'preflop',
        activePlayer: '',
        dealerPosition: 0,
        smallBlind: 5,
        bigBlind: 10,
        minRaise: 20,
        lastRaise: 10,
        communityCards: []
      };

      stateMachine.setTableState(tableState);
    });

    it('should create recovery points at key game states', () => {
      // Setup table state for preFlop
      const tableState = {
        tableId: 'table1',
        players: [
          { id: 'player1', isAllIn: false, currentBet: 100, isFolded: false, hasActed: true },
          { id: 'player2', isAllIn: false, currentBet: 100, isFolded: false, hasActed: true }
        ],
        currentBet: 100
      };
      (stateMachine as any).tableState = tableState;
      
      const actions: GameAction[] = [
        {
          type: 'initialize',
          tableId: 'table1',
          timestamp: Date.now()
        },
        {
          type: 'join',
          tableId: 'table1',
          playerId: 'player1',
          timestamp: Date.now()
        },
        {
          type: 'start',
          tableId: 'table1',
          timestamp: Date.now()
        },
        {
          type: 'deal',
          tableId: 'table1',
          timestamp: Date.now()
        }
      ];

      stateMachine.currentState = 'dealingCards';
      actions.forEach(action => stateMachine.transition(action));
      
      // Force state to preFlop which should create a recovery point
      // Move through the states to get to preFlop
      const setupActions: GameAction[] = [
        {
          type: 'initialize',
          tableId: 'table1',
          timestamp: Date.now()
        },
        {
          type: 'join',
          tableId: 'table1',
          playerId: 'player1',
          timestamp: Date.now()
        },
        {
          type: 'start',
          tableId: 'table1',
          timestamp: Date.now()
        },
        {
          type: 'deal',
          tableId: 'table1',
          timestamp: Date.now()
        }
      ];
      
      setupActions.forEach(action => expect(stateMachine.transition(action)).toBe(true));
      const recoveryPoint = stateMachine.getLastRecoveryPoint();
      expect(recoveryPoint).toBeTruthy();
      expect(recoveryPoint?.transitions).toBeTruthy();
    });

    it('should limit recovery points to last 5', () => {
      const actions: GameAction[] = Array(6).fill(null).map((_, i) => ({
        type: 'bet',
        tableId: 'table1',
        playerId: 'player1',
        amount: 10 * (i + 1),
        timestamp: Date.now() + i
      }));

      actions.forEach(action => stateMachine.transition(action));
      expect(stateMachine.recovery.length).toBeLessThanOrEqual(5);
    });

    it('should successfully restore from recovery point', () => {
      const originalState = stateMachine.getTableState();
      const initialPoint = {
        state: 'preflop' as GameState,
        timestamp: Date.now(),
        snapshot: originalState,
        transitions: []
      };

      // Make some changes
      const newTableState: TableState = {
        ...originalState!,
        pot: 1000,
        currentBet: 100
      };
      stateMachine.setTableState(newTableState);

      // Restore
      expect(stateMachine.resetToRecoveryPoint(initialPoint)).toBe(true);
      expect(stateMachine.getTableState()).toEqual(originalState);
    });
  });
});
