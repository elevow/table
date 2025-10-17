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
    Server: jest.fn().mockImplementation(() => ({ on: mockOn, to: mockTo, emit: mockEmit }))
  };
});

describe('ActionManager RIT showdown integration', () => {
  let actionManager: ActionManager;
  let mockIo: jest.Mocked<SocketServer>;
  let mockStateManager: jest.Mocked<StateManager>;
  let state: TableState;
  let p1: Player; let p2: Player;

  beforeEach(() => {
  // Actor (P1) must not be all-in so their 'check' action is valid; opponent is all-in to satisfy prior RIT conditions.
  p1 = { id: 'P1', name: 'P1', position: 0, stack: 1000, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30000 };
  p2 = { id: 'P2', name: 'P2', position: 1, stack: 1000, currentBet: 0, hasActed: true, isFolded: false, isAllIn: true, timeBank: 30000 };

    state = {
      tableId: 'tRIT',
      stage: 'river',
      players: [p1, p2],
      activePlayer: 'P1',
      pot: 400,
      communityCards: [
        { rank: 'A', suit: 'hearts' },
        { rank: 'K', suit: 'clubs' },
        { rank: '5', suit: 'spades' },
        { rank: '5', suit: 'diamonds' },
        { rank: '2', suit: 'hearts' }
      ],
      currentBet: 0,
      dealerPosition: 0,
      smallBlind: 5,
      bigBlind: 10,
      minRaise: 10,
      lastRaise: 0,
      runItTwice: { enabled: true, numberOfRuns: 2, boards: [], results: [], potDistribution: [], seeds: [] }
    } as any;

    mockIo = new SocketServer({} as HttpServer) as jest.Mocked<SocketServer>;
    mockStateManager = {
      getState: jest.fn().mockReturnValue(state),
      updateState: jest.fn().mockResolvedValue(true),
      handleAction: jest.fn()
    } as unknown as jest.Mocked<StateManager>;

    actionManager = new ActionManager(mockStateManager, mockIo);
  });

  it('produces RIT boards/results and clears pot on showdown transition', async () => {
    // The action should push stage from river to showdown; we simulate a "check" concluding betting.
    const action: PlayerAction = { type: 'check', playerId: 'P1', tableId: 'tRIT', timestamp: Date.now() };

    const result = await actionManager.handlePlayerAction(action);

    expect(result.success).toBe(true);
    // Expect stage ended at showdown
    expect(result.state?.stage).toBe('showdown');
    // RIT results should now have boards + results populated
    const rit = result.state?.runItTwice;
    expect(rit).toBeDefined();
    expect(rit?.enabled).toBe(true);
    expect(rit?.results.length).toBeGreaterThan(0);
    expect(rit?.boards.length).toBe(rit?.numberOfRuns);
    // Pot should be zeroed after distribution
    expect(result.state?.pot).toBe(0);
    // updateState must have been invoked with runItTwice containing results
    const updateCalls = (mockStateManager.updateState as jest.Mock).mock.calls.filter(c => c[0] === 'tRIT');
    const lastUpdatePayload = updateCalls[updateCalls.length - 1][1];
    expect(lastUpdatePayload.runItTwice?.results?.length).toBeGreaterThan(0);
  });
});
