import { Server as SocketServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { ActionManager } from '../action-manager';
import { StateManager } from '../state-manager';
import { TableState, Player } from '../../types/poker';

jest.mock('socket.io', () => {
  const mockEmit = jest.fn();
  const mockOn = jest.fn();
  const mockTo = jest.fn(() => ({ emit: mockEmit }));
  return {
    Server: jest.fn().mockImplementation(() => ({ on: mockOn, to: mockTo, emit: mockEmit }))
  };
});

// Minimal socket stub to trigger handlers directly
interface MockSocket {
  on: jest.Mock;
  emit: jest.Mock;
  join?: jest.Mock;
}

describe('ActionManager Run It Twice socket', () => {
  let actionManager: ActionManager;
  let mockIo: jest.Mocked<SocketServer>;
  let mockStateManager: jest.Mocked<StateManager>;
  let baseState: TableState;
  let playerA: Player;
  let playerB: Player;

  beforeEach(() => {
    playerA = { id: 'A', name: 'A', position: 0, stack: 1000, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30000 };
    playerB = { id: 'B', name: 'B', position: 1, stack: 1000, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30000 };
    baseState = {
      tableId: 't1', stage: 'turn', players: [playerA, playerB], activePlayer: 'A', pot: 500,
      communityCards: [
        { rank: 'A', suit: 'hearts' }, { rank: 'K', suit: 'spades' }, { rank: 'Q', suit: 'diamonds' }, { rank: '2', suit: 'clubs' }
      ],
      currentBet: 0, dealerPosition: 0, smallBlind: 5, bigBlind: 10, minRaise: 10, lastRaise: 0
    };

    mockIo = new SocketServer({} as HttpServer) as jest.Mocked<SocketServer>;
    mockStateManager = {
      getState: jest.fn().mockReturnValue(baseState),
      updateState: jest.fn().mockResolvedValue(true),
      handleAction: jest.fn()
    } as unknown as jest.Mocked<StateManager>;

    actionManager = new ActionManager(mockStateManager, mockIo);
  });

  function invokeSocketHandler(event: string, payload: any, cb?: any) {
    // Grab the registered 'connection' handler from the mocked instance's on() calls
    const onCalls = mockIo.on.mock.calls;
    // Use the last registered connection handler (in case ActionManager re-instantiated in a test)
    const connectionCall = [...onCalls].reverse().find(c => c[0] === 'connection');
    if (!connectionCall) throw new Error('connection handler not registered');
    const connectionHandler = connectionCall[1];
    // Simulate a per-connection socket with its own on registry
    const socket: MockSocket = { on: jest.fn(), emit: jest.fn(), join: jest.fn() } as any;
    connectionHandler(socket);
    const handlerCall = (socket.on as jest.Mock).mock.calls.find(c => c[0] === event);
    if (!handlerCall) throw new Error(`Handler for ${event} not registered`);
    const handler = handlerCall[1];
    handler(payload, cb);
  }

  it('fails when no all-in present', (done) => {
    invokeSocketHandler('enable_run_it_twice', { tableId: 't1', runs: 2 }, (resp: any) => {
      expect(resp.success).toBe(false);
      expect(resp.error).toMatch(/all-in/i);
      done();
    });
  });

  it('fails with invalid run count', (done) => {
    // Mark someone all-in to pass all-in test
    playerA.isAllIn = true;
    invokeSocketHandler('enable_run_it_twice', { tableId: 't1', runs: 5 }, (resp: any) => {
      expect(resp.success).toBe(false);
      expect(resp.error).toMatch(/Runs must be 1-2/i);
      done();
    });
  });

  it('fails when board complete', (done) => {
    playerA.isAllIn = true;
    baseState.communityCards.push({ rank: '9', suit: 'clubs' }); // now 5 cards
    invokeSocketHandler('enable_run_it_twice', { tableId: 't1', runs: 2 }, (resp: any) => {
      expect(resp.success).toBe(false);
      expect(resp.error).toMatch(/Too late|late/i);
      done();
    });
  });

  it('enables RIT successfully with valid conditions', (done) => {
    // Recreate ActionManager with an all-in state to ensure handler sees correct flags
    const allInState: TableState = {
      ...baseState,
      players: baseState.players.map(p => ({ ...p, isAllIn: true }))
    } as TableState;
    (mockStateManager.getState as jest.Mock).mockReturnValue(allInState);
    // Re-instantiate to register fresh socket handlers capturing updated mock
    actionManager = new ActionManager(mockStateManager, mockIo);
    // Sanity debug
    // eslint-disable-next-line no-console
    // console.log('debug players', baseState.players.map(p => ({id:p.id,isAllIn:p.isAllIn})));
    invokeSocketHandler('enable_run_it_twice', { tableId: 't1', runs: 2 }, (resp: any) => {
      try {
        // For debugging if failing
        if (!resp.success) {
          // eslint-disable-next-line no-console
          console.error('enable_run_it_twice failure payload', resp);
        }
        expect(resp.success).toBe(true);
        const call = (mockStateManager.updateState as jest.Mock).mock.calls.find(c => c[0] === 't1');
        expect(call).toBeDefined();
        const updateArg = call![1];
        expect(updateArg.runItTwice).toBeDefined();
        expect(updateArg.runItTwice.numberOfRuns).toBe(2);
        expect(mockIo.to).toHaveBeenCalledWith('t1');
        done();
      } catch (e) {
        done(e);
      }
    });
  }, 5000);

  it('prevents duplicate enabling', (done) => {
    playerA.isAllIn = true;
    // First enable
    invokeSocketHandler('enable_run_it_twice', { tableId: 't1', runs: 2 }, () => {
      // Mock state reflects enabled
      (mockStateManager.getState as jest.Mock).mockReturnValue({ ...baseState, runItTwice: { enabled: true, numberOfRuns: 2, boards: [], results: [], potDistribution: [], seeds: [] } as any });
      // Second attempt
      invokeSocketHandler('enable_run_it_twice', { tableId: 't1', runs: 2 }, (resp: any) => {
        expect(resp.success).toBe(false);
        expect(resp.error).toMatch(/already/i);
        done();
      });
    });
  });
});
