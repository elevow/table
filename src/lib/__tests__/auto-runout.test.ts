import { Server as SocketServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { ActionManager } from '../action-manager';
import type { StateManager } from '../state-manager';
import type { TableState, PlayerAction } from '../../types/poker';

jest.useFakeTimers();

// Minimal socket.io mock (instance-level) to satisfy ActionManager constructor
jest.mock('socket.io', () => {
  const mockEmit = jest.fn();
  const mockOn = jest.fn();
  const mockTo = jest.fn(() => ({ emit: mockEmit }));
  return {
    Server: jest.fn().mockImplementation(() => ({ on: mockOn, to: mockTo, emit: mockEmit }))
  };
});

// Helper to create a mutable StateManager mock that merges updates
function createStateManager(initial: TableState) {
  let current = { ...initial } as TableState;
  const updateState = jest.fn((tableId: string, update: Partial<TableState>) => {
    current = { ...current, ...update } as TableState;
    return true;
  });
  const getState = jest.fn((tableId: string) => current);
  const handleAction = jest.fn();
  return { getState, updateState, handleAction, _get: () => current } as unknown as jest.Mocked<StateManager> & { _get: () => TableState };
}

describe('ActionManager auto-runout on all-in', () => {
  let mockIo: jest.Mocked<SocketServer>;

  beforeEach(() => {
    jest.clearAllTimers();
    (SocketServer as unknown as jest.Mock).mockClear?.();
    mockIo = new (SocketServer as any)({} as HttpServer);
  });

  it('reveals flop/turn/river at 5s intervals then advances to showdown (all-in preflop)', async () => {
    const base: TableState = {
      tableId: 't1',
      stage: 'preflop',
      players: [
        { id: 'A', name: 'A', position: 0, stack: 100, currentBet: 0, hasActed: false, isFolded: false, isAllIn: true, timeBank: 30000 },
        { id: 'B', name: 'B', position: 1, stack: 100, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30000 },
      ],
      activePlayer: 'B',
      communityCards: [],
      currentBet: 0,
      dealerPosition: 0,
      smallBlind: 1,
      bigBlind: 2,
      minRaise: 2,
      lastRaise: 0,
    } as any;

    const sm = createStateManager(base);
    const am = new ActionManager(sm as any, mockIo);

    const action: PlayerAction = { type: 'check', playerId: 'B', tableId: 't1', timestamp: Date.now() } as any;
    const res = await am.handlePlayerAction(action);
    expect(res.success).toBe(true);

    // 5s -> flop
    jest.advanceTimersByTime(5000);
    let st = sm._get();
    expect(st.communityCards.length).toBe(3);
    expect(['flop', 'turn']).toContain(st.stage); // stage may become 'flop' or advance depending on bet-complete logic

    // 10s total -> turn
    jest.advanceTimersByTime(5000);
    st = sm._get();
    expect(st.communityCards.length).toBe(4);
    expect(['turn', 'river']).toContain(st.stage);

    // 15s total -> river
    jest.advanceTimersByTime(5000);
    st = sm._get();
    expect(st.communityCards.length).toBe(5);
    expect(st.stage).toBe('river');

    // 20s total -> showdown
    jest.advanceTimersByTime(5000);
    st = sm._get();
    expect(st.stage).toBe('showdown');
  });

  it('reveals remaining streets starting from turn and then showdown (all-in on flop)', async () => {
    const base: TableState = {
      tableId: 't2',
      stage: 'flop',
      players: [
        { id: 'A', name: 'A', position: 0, stack: 100, currentBet: 0, hasActed: false, isFolded: false, isAllIn: true, timeBank: 30000 },
        { id: 'B', name: 'B', position: 1, stack: 100, currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: 30000 },
      ],
      activePlayer: 'B',
      communityCards: [
        { rank: 'A', suit: 'hearts' }, { rank: 'K', suit: 'spades' }, { rank: 'Q', suit: 'diamonds' }
      ],
      currentBet: 0,
      dealerPosition: 0,
      smallBlind: 1,
      bigBlind: 2,
      minRaise: 2,
      lastRaise: 0,
    } as any;

    const sm = createStateManager(base);
    const am = new ActionManager(sm as any, mockIo);

    const action: PlayerAction = { type: 'check', playerId: 'B', tableId: 't2', timestamp: Date.now() } as any;
    const res = await am.handlePlayerAction(action);
    expect(res.success).toBe(true);

    // 5s -> turn
    jest.advanceTimersByTime(5000);
    let st = sm._get();
    expect(st.communityCards.length).toBe(4);
    expect(['turn', 'river']).toContain(st.stage);

    // 10s total -> river
    jest.advanceTimersByTime(5000);
    st = sm._get();
    expect(st.communityCards.length).toBe(5);
    expect(st.stage).toBe('river');

    // 15s total -> showdown
    jest.advanceTimersByTime(5000);
    st = sm._get();
    expect(st.stage).toBe('showdown');
  });
});
