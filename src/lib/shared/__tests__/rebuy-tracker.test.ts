import { recordBuyin, getPlayerRebuyInfo, getRoomRebuySnapshot, clearRoomRebuys, resetAllRebuyTracking } from '../rebuy-tracker';

describe('rebuy-tracker', () => {
  afterEach(() => {
    resetAllRebuyTracking();
  });

  it('tracks initial buyin without incrementing rebuys', () => {
    const roomId = 'tableA';
    const playerId = 'player-1';

    const record = recordBuyin(roomId, playerId);
    expect(record.buyins).toBe(1);
    expect(record.rebuys).toBe(0);

    const stored = getPlayerRebuyInfo(roomId, playerId);
    expect(stored).toBe(record);
  });

  it('increments rebuys for subsequent buyins', () => {
    const roomId = 'tableB';
    const playerId = 'player-2';

    recordBuyin(roomId, playerId);
    const second = recordBuyin(roomId, playerId);
    expect(second.buyins).toBe(2);
    expect(second.rebuys).toBe(1);

    const third = recordBuyin(roomId, playerId);
    expect(third.buyins).toBe(3);
    expect(third.rebuys).toBe(2);
  });

  it('provides snapshot data and supports clearing room state', () => {
    const roomId = 'tableC';
    recordBuyin(roomId, 'p1');
    recordBuyin(roomId, 'p1');
    recordBuyin(roomId, 'p2');

    const snapshot = getRoomRebuySnapshot(roomId);
    expect(snapshot).toHaveLength(2);
    const p1 = snapshot.find(entry => entry.playerId === 'p1');
    expect(p1?.rebuys).toBe(1);
    const p2 = snapshot.find(entry => entry.playerId === 'p2');
    expect(p2?.rebuys).toBe(0);

    clearRoomRebuys(roomId);
    expect(getRoomRebuySnapshot(roomId)).toHaveLength(0);
  });
});
