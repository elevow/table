import { buildProfitSeries, formatDuration, groupSessions, SESSION_GAP_MS, type ProfitHand } from '../profit-sessions';

const T0 = Date.parse('2026-10-20T18:00:00.000Z');
const min = 60 * 1000;
const hand = (id: string, roomId: string, endMin: number, net: number, startMin?: number): ProfitHand => ({
  handId: id,
  roomId,
  startedAt: startMin == null ? null : new Date(T0 + startMin * min).toISOString(),
  endedAt: new Date(T0 + endMin * min).toISOString(),
  net,
});

describe('buildProfitSeries', () => {
  it('sorts by time and keeps a running total', () => {
    const series = buildProfitSeries([hand('c', 'r', 30, -5), hand('a', 'r', 10, 20), hand('b', 'r', 20, 0.1)]);
    expect(series.map(p => p.handId)).toEqual(['a', 'b', 'c']);
    expect(series.map(p => p.cumulative)).toEqual([20, 20.1, 15.1]);
    expect(series[0].t).toBe(T0 + 10 * min);
  });

  it('skips hands with unreadable times', () => {
    expect(buildProfitSeries([{ ...hand('a', 'r', 1, 5), endedAt: 'nope' }])).toEqual([]);
  });
});

describe('groupSessions', () => {
  it('splits a table on long breaks and returns newest first', () => {
    const sessions = groupSessions([
      hand('a', 'r1', 2, 10, 0),
      hand('b', 'r1', 5, -3, 3),
      // more than two hours later
      hand('c', 'r1', 5 + 121 + 2, 7, 5 + 121),
    ]);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({ roomId: 'r1', hands: 1, net: 7 });
    expect(sessions[1]).toMatchObject({ roomId: 'r1', hands: 2, net: 7, start: T0, end: T0 + 5 * min, durationMs: 5 * min });
  });

  it('keeps a break of exactly the gap in one session', () => {
    const sessions = groupSessions([hand('a', 'r', 0, 1), hand('b', 'r', SESSION_GAP_MS / min, 1)]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].hands).toBe(2);
  });

  it('gives tables played at the same time their own sessions', () => {
    const sessions = groupSessions([
      hand('a', 'r1', 1, 5), hand('b', 'r2', 2, -1), hand('c', 'r1', 3, 5), hand('d', 'r2', 4, -1),
    ]);
    expect(sessions).toHaveLength(2);
    expect(sessions.find(s => s.roomId === 'r1')).toMatchObject({ hands: 2, net: 10 });
    expect(sessions.find(s => s.roomId === 'r2')).toMatchObject({ hands: 2, net: -2 });
  });

  it('ignores a start time after the end', () => {
    const [s] = groupSessions([hand('a', 'r', 10, 1, 50)]);
    expect(s.start).toBe(T0 + 10 * min);
    expect(s.durationMs).toBe(0);
  });

  it('accepts a custom gap', () => {
    expect(groupSessions([hand('a', 'r', 0, 1), hand('b', 'r', 11, 1)], 10 * min)).toHaveLength(2);
  });
});

describe('formatDuration', () => {
  it('formats minutes and hours', () => {
    expect(formatDuration(20 * 1000)).toBe('<1m');
    expect(formatDuration(40 * min)).toBe('40m');
    expect(formatDuration(85 * min)).toBe('1h 25m');
  });
});
