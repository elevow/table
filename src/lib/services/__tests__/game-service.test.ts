import { GameService } from '../game-service';
import { GameManager } from '../../database/game-manager';
import { ActiveGameRecord, CreateRoomInput, GameRoomRecord } from '../../../types/game';

// Mock GameManager so GameService delegates without touching DB
jest.mock('../../database/game-manager', () => {
  return {
    GameManager: jest.fn().mockImplementation(() => ({
      getRoomById: jest.fn(async (_roomId: string) => ({
        id: _roomId,
        name: 'Room',
        gameType: 'poker',
        maxPlayers: 6,
        blindLevels: {},
        createdBy: 'u1',
        createdAt: new Date(),
        status: 'waiting',
  configuration: { bettingMode: 'pot-limit', requireRunItTwiceUnanimous: true },
      })),
      createRoom: jest.fn(async (input: CreateRoomInput): Promise<GameRoomRecord> => ({
        id: 'room-1',
        name: input.name,
        gameType: input.gameType,
        maxPlayers: input.maxPlayers,
        blindLevels: input.blindLevels ?? {},
        createdBy: input.createdBy,
        createdAt: new Date(),
        status: 'waiting',
        configuration: input.configuration ?? null,
      })),
      listRooms: jest.fn(async (_p: number, _l: number) => ({
        items: [],
        total: 0,
        page: _p,
        limit: _l,
        totalPages: 0,
      })),
      startGame: jest.fn(async (): Promise<ActiveGameRecord> => ({
        id: 'ag-1',
        roomId: 'room-1',
        currentHandId: null,
        dealerPosition: 0,
        currentPlayerPosition: 0,
        pot: 0,
        state: null,
        lastActionAt: new Date(),
      })),
      updateActiveGame: jest.fn(async (partial: any): Promise<ActiveGameRecord> => ({
        id: partial.id,
        roomId: 'room-1',
        currentHandId: partial.currentHandId ?? null,
        dealerPosition: partial.dealerPosition ?? 0,
        currentPlayerPosition: partial.currentPlayerPosition ?? 0,
        pot: partial.pot ?? 0,
        state: partial.state ?? null,
        lastActionAt: new Date(),
      })),
      endGame: jest.fn(async () => {}),
      getActiveGameByRoom: jest.fn(async (_roomId: string): Promise<ActiveGameRecord | null> => ({
        id: 'ag-1',
        roomId: _roomId,
        currentHandId: null,
        dealerPosition: 0,
        currentPlayerPosition: 0,
        pot: 0,
        state: null,
        lastActionAt: new Date(),
      })),
    })),
  };
});

describe('GameService', () => {
  const getMgr = () => (GameManager as unknown as jest.Mock).mock.results[(GameManager as unknown as jest.Mock).mock.results.length - 1].value as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('createRoom validates required fields and delegates', async () => {
    const svc = new GameService({} as any);
    const mgr = getMgr();

    const input: CreateRoomInput = {
      name: 'Table 1',
      gameType: 'poker',
      maxPlayers: 6,
      blindLevels: {},
      createdBy: 'u1',
      configuration: { ante: 0 },
    };

    const room = await svc.createRoom(input);
    expect(mgr.createRoom).toHaveBeenCalledWith(input);
    expect(room.status).toBe('waiting');

    await expect(svc.createRoom({ ...input, name: '  ' })).rejects.toThrow('Missing or invalid name');
    await expect(svc.createRoom({ ...input, gameType: '' })).rejects.toThrow('Missing or invalid gameType');
    await expect(svc.createRoom({ ...input, maxPlayers: undefined as any })).rejects.toThrow('Missing or invalid maxPlayers');
    await expect(svc.createRoom({ ...input, createdBy: '' as any })).rejects.toThrow('Missing or invalid createdBy');
  });

  it('listRooms normalizes pagination (defaults, invalid, and over max)', async () => {
    const svc = new GameService({} as any);
    const mgr = getMgr();

    // Defaults -> (1,20)
    await svc.listRooms();
    expect(mgr.listRooms).toHaveBeenLastCalledWith(1, 20);

    // Invalid page and limit -> fallback
    await svc.listRooms(-2 as any, 0 as any);
    expect(mgr.listRooms).toHaveBeenLastCalledWith(1, 20);

    // Over max limit -> 20
    await svc.listRooms(3, 500);
    expect(mgr.listRooms).toHaveBeenLastCalledWith(3, 20);

    // Within max -> used as-is
    await svc.listRooms(2, 100);
    expect(mgr.listRooms).toHaveBeenLastCalledWith(2, 100);
  });

  it('startGame validates inputs and delegates', async () => {
    const svc = new GameService({} as any);
    const mgr = getMgr();

  await svc.startGame({ roomId: 'room-1', dealerPosition: 1, currentPlayerPosition: 2 });
  // Expect service to fetch room config and include bettingMode and RIT unanimity policy in state
  expect(mgr.getRoomById).toHaveBeenCalledWith('room-1');
  expect(mgr.startGame).toHaveBeenCalledWith({ roomId: 'room-1', dealerPosition: 1, currentPlayerPosition: 2, state: { bettingMode: 'pot-limit', requireRunItTwiceUnanimous: true } });

    await expect(svc.startGame({ roomId: '', dealerPosition: 1, currentPlayerPosition: 2 })).rejects.toThrow('Missing or invalid roomId');
    await expect(svc.startGame({ roomId: 'room-1', dealerPosition: NaN as any, currentPlayerPosition: 2 })).rejects.toThrow('Missing or invalid dealerPosition');
    await expect(svc.startGame({ roomId: 'room-1', dealerPosition: 1, currentPlayerPosition: undefined as any })).rejects.toThrow('Missing or invalid currentPlayerPosition');
  });

  it('updateActiveGame requires id and delegates', async () => {
    const svc = new GameService({} as any);
    const mgr = getMgr();

    await svc.updateActiveGame({ id: 'ag-1', pot: 100 });
    expect(mgr.updateActiveGame).toHaveBeenCalledWith({ id: 'ag-1', pot: 100 });

    await expect(svc.updateActiveGame({ id: '  ' } as any)).rejects.toThrow('Missing or invalid id');
  });

  it('endGame requires id and delegates', async () => {
    const svc = new GameService({} as any);
    const mgr = getMgr();

    await svc.endGame('ag-1');
    expect(mgr.endGame).toHaveBeenCalledWith('ag-1');

    await expect(svc.endGame('')).rejects.toThrow('Missing or invalid id');
  });

  it('getActiveGameByRoom requires roomId and delegates', async () => {
    const svc = new GameService({} as any);
    const mgr = getMgr();

    const res = await svc.getActiveGameByRoom('room-1');
    expect(mgr.getActiveGameByRoom).toHaveBeenCalledWith('room-1');
    expect(res?.roomId).toBe('room-1');

    await expect(svc.getActiveGameByRoom('  ')).rejects.toThrow('Missing or invalid roomId');
  });
});
