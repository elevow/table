jest.mock('pg', () => ({ Pool: jest.fn() }));
jest.mock('../../database/pool', () => ({ getPool: jest.fn() }));
jest.mock('../../utils/post-hand-result', () => ({ postHandResultToChat: jest.fn() }));

import { rowToHandRecord, saveHandRecord } from '../hand-records';
import { fetchRoomNames } from '../room-names';
import type { HandRecord } from '../../../types/hand-record';

const record: HandRecord = {
  id: 'hand-1', roomId: 'r', handNumber: 1, variant: 'texas-holdem', kind: 'normal', smallBlind: 1, bigBlind: 2,
  startedAt: null, endedAt: '2026-01-01T00:00:00.000Z', board: [], players: [], actions: [], winners: [], pot: 0,
  bettingMode: 'pot-limit', buttonSeat: 3,
};

describe('hand record export fields', () => {
  it('stores the betting mode and button seat', async () => {
    const query = jest.fn().mockResolvedValue({ rowCount: 1 });
    await expect(saveHandRecord({ query } as any, record)).resolves.toBe(true);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('run_boards, betting_mode, button_seat)');
    expect(params.slice(16)).toEqual(['pot-limit', 3]);
  });

  it('still stores the hand on a database without the new columns', async () => {
    const query = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error('column "betting_mode" does not exist'), { code: '42703' }))
      .mockResolvedValueOnce({ rowCount: 1 });
    await expect(saveHandRecord({ query } as any, { ...record, bettingMode: undefined, buttonSeat: undefined })).resolves.toBe(true);
    const [sql, params] = query.mock.calls[1];
    expect(sql).not.toContain('betting_mode');
    expect(params).toHaveLength(16);
  });

  it('passes other errors on', async () => {
    const query = jest.fn().mockRejectedValue(new Error('down'));
    await expect(saveHandRecord({ query } as any, record)).rejects.toThrow('down');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('reads the new columns, leaving them out on older rows', () => {
    const base = { id: 'h', ended_at: '2026-01-01T00:00:00Z' };
    expect(rowToHandRecord({ ...base, betting_mode: 'pot-limit', button_seat: '4' })).toMatchObject({ bettingMode: 'pot-limit', buttonSeat: 4 });
    expect(rowToHandRecord({ ...base, betting_mode: 'no-limit' }).bettingMode).toBe('no-limit');
    const old = rowToHandRecord(base);
    expect(old.bettingMode).toBeUndefined();
    expect(old.buttonSeat).toBeUndefined();
  });
});

describe('fetchRoomNames', () => {
  it('looks up unique ids and skips the query when there are none', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: null }] });
    await expect(fetchRoomNames({ query } as any, [])).resolves.toEqual({});
    expect(query).not.toHaveBeenCalled();
    await expect(fetchRoomNames({ query } as any, ['a', 'a', 'b', ''])).resolves.toEqual({ a: 'Alpha' });
    expect(query.mock.calls[0][1]).toEqual([['a', 'b']]);
  });
});
