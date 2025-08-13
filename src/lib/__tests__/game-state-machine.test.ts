import { PokerGameStateMachine } from '../game-state-machine';
import { GameAction } from '../../types/poker';

describe('PokerGameStateMachine', () => {
  let stateMachine: PokerGameStateMachine;

  beforeEach(() => {
    (PokerGameStateMachine as any).instance = undefined;
    stateMachine = PokerGameStateMachine.getInstance();
  });

  describe('State Transitions', () => {
    it('should initialize in idle state', () => {
      expect(stateMachine.currentState).toBe('idle');
    });

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

    it('should prevent invalid transitions and move to error state', () => {
      const invalidAction: GameAction = {
        type: 'deal',
        tableId: 'table1',
        timestamp: Date.now()
      };

      expect(stateMachine.transition(invalidAction)).toBe(false);
      expect(stateMachine.currentState).toBe('error');
    });
  });

  describe('Recovery Points', () => {
    it('should create recovery points at key game stages', () => {
      // Setup initial game state
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

      setupActions.forEach(action => stateMachine.transition(action));
      
      const lastRecovery = stateMachine.getLastRecoveryPoint();
      expect(lastRecovery).toBeDefined();
      if (lastRecovery) {
        expect(['preFlop', 'dealingCards']).toContain(lastRecovery.state);
        expect(lastRecovery.transitions.length).toBe(4);
      }
    });

    it('should successfully restore from recovery point', () => {
      // Setup and create a recovery point
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
        }
      ];

      setupActions.forEach(action => stateMachine.transition(action));
      
      const recoveryPoint = stateMachine.getLastRecoveryPoint();
      if (recoveryPoint) {
        // Move to a different state
        stateMachine.transition({
          type: 'error',
          tableId: 'table1',
          timestamp: Date.now()
        });

        expect(stateMachine.currentState).toBe('error');

        // Restore from recovery
        expect(stateMachine.resetToRecoveryPoint(recoveryPoint)).toBe(true);
        expect(stateMachine.currentState).toBe(recoveryPoint.state);
      }
    });
  });

  describe('Error Handling', () => {
    it('should transition to error state on invalid actions', () => {
      const setupAction: GameAction = {
        type: 'initialize',
        tableId: 'table1',
        timestamp: Date.now()
      };
      stateMachine.transition(setupAction);
      
      const invalidAction: GameAction = {
        type: 'bet',
        tableId: 'table1',
        playerId: 'player1',
        amount: 100,
        timestamp: Date.now()
      };

      stateMachine.transition(invalidAction);
      expect(stateMachine.currentState).toBe('error');
    });

    it('should allow recovery from error state', () => {
      // Setup and force error state
      const setupAction: GameAction = {
        type: 'initialize',
        tableId: 'table1',
        timestamp: Date.now()
      };
      stateMachine.transition(setupAction);
      
      const invalidAction: GameAction = {
        type: 'bet',
        tableId: 'table1',
        playerId: 'player1',
        amount: 100,
        timestamp: Date.now()
      };

      stateMachine.transition(invalidAction);
      expect(stateMachine.currentState).toBe('error');

      // Attempt recovery
      const initAction: GameAction = {
        type: 'initialize',
        tableId: 'table1',
        timestamp: Date.now()
      };

      expect(stateMachine.transition(initAction)).toBe(true);
      expect(stateMachine.currentState).toBe('initializing');
    });
  });
});
