import { Server as SocketServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { StateManager } from '../state-manager';
import { TableState } from '../../types/poker';

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

describe('StateManager', () => {
  let stateManager: StateManager;
  let mockIo: jest.Mocked<SocketServer>;
  
  beforeEach(() => {
    mockIo = new SocketServer({} as HttpServer) as jest.Mocked<SocketServer>;
    stateManager = new StateManager(mockIo);
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should update state and broadcast changes', () => {
    const tableId = 'table1';
    const update: Partial<TableState> = {
      pot: 100,
      currentBet: 20
    };

    stateManager.updateState(tableId, update);

    const state = stateManager.getState(tableId);
    expect(state).toMatchObject(update);
    expect(mockIo.to).toHaveBeenCalledWith(tableId);
    expect(mockIo.to(tableId).emit).toHaveBeenCalledWith(
      'state_update',
      expect.objectContaining({
        type: 'state_update',
        tableId,
        payload: update
      })
    );
  });

  it('should increment sequence number for each update', () => {
    const tableId = 'table1';
    
    stateManager.updateState(tableId, { pot: 100 });
    expect(stateManager.getSequence(tableId)).toBe(1);
    
    stateManager.updateState(tableId, { currentBet: 20 });
    expect(stateManager.getSequence(tableId)).toBe(2);
  });

  it('should enforce rate limiting', () => {
    const tableId = 'table1';
    const updates = Array(25).fill({ pot: 100 });
    
    updates.forEach(update => {
      stateManager.updateState(tableId, update);
    });

    // Only first 20 updates should succeed due to rate limit
    expect(stateManager.getSequence(tableId)).toBe(20);

    // After 1 second, should accept new updates
    jest.advanceTimersByTime(1000);
    stateManager.updateState(tableId, { pot: 200 });
    expect(stateManager.getSequence(tableId)).toBe(21);
  });
});
