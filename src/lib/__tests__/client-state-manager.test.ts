import { Socket } from 'socket.io-client';
import { ClientStateManager } from '../client-state-manager';
import { TableState } from '../../types/poker';
import { StateUpdate, StateReconciliation } from '../../types/state-update';

jest.mock('socket.io-client');

describe('ClientStateManager', () => {
  let clientStateManager: ClientStateManager;
  let mockSocket: any;
  let mockOnStateChange: jest.Mock;
  
  beforeEach(() => {
    mockSocket = {
      on: jest.fn(),
      emit: jest.fn(),
      connect: jest.fn(),
    };
    
    mockOnStateChange = jest.fn();
    clientStateManager = new ClientStateManager(mockSocket, mockOnStateChange);
  });

  it('should handle state updates in order', () => {
    const update: StateUpdate = {
      type: 'state_update',
      tableId: 'table1',
      sequence: 1,
      payload: { pot: 100 },
      timestamp: Date.now()
    };

    // Simulate receiving a state update
    mockSocket.on.mock.calls.find(([event]) => event === 'state_update')?.[1](update);

    expect(clientStateManager.getState()).toMatchObject({ pot: 100 });
    expect(clientStateManager.getSequence()).toBe(1);
  });

  it('should handle optimistic updates', () => {
    const update: Partial<TableState> = { pot: 100 };
    clientStateManager.optimisticUpdate(update);

    expect(clientStateManager.getState()).toMatchObject(update);
    expect(mockOnStateChange).toHaveBeenCalled();
  });

  it('should handle state reconciliation', () => {
    const reconciliation: StateReconciliation = {
      tableId: 'table1',
      clientSequence: 0,
      serverSequence: 2,
      fullState: {
        tableId: 'table1',
        stage: 'preflop',
        players: [],
        pot: 200,
        communityCards: [],
        currentBet: 50,
        activePlayer: '',
        dealerPosition: 0,
        smallBlind: 10,
        bigBlind: 20,
        minRaise: 20,
        lastRaise: 0
      }
    };

    // Simulate receiving reconciliation
    mockSocket.on.mock.calls.find(([event]) => event === 'reconcile')?.[1](reconciliation);

    expect(clientStateManager.getState()).toEqual(reconciliation.fullState);
    expect(clientStateManager.getSequence()).toBe(2);
  });

  it('should handle reconnection with backoff', () => {
    jest.useFakeTimers();

    // Simulate disconnect
    const disconnectHandler = mockSocket.on.mock.calls.find(([event]) => event === 'disconnect')?.[1];
    disconnectHandler?.();

    // Run any pending timers
    jest.runAllTimers();

    // Should attempt first reconnect immediately
    expect(mockSocket.connect).toHaveBeenCalledTimes(1);

    // Simulate connection error
    const errorHandler = mockSocket.on.mock.calls.find(([event]) => event === 'connect_error')?.[1];
    errorHandler?.(new Error('Connection failed'));

    // Run any pending timers
    jest.runAllTimers();

    // Should attempt second reconnect
    expect(mockSocket.connect).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });
});
