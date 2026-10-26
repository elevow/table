import { nextSeq, resetSeq } from '../sequence';

describe('sequence', () => {
  let now = 1_800_000_000_000;

  beforeEach(() => {
    now = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    resetSeq('table1');
    resetSeq('table2');
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps increasing within a server, even within one millisecond', () => {
    const a = nextSeq('table1');
    const b = nextSeq('table1');
    const c = nextSeq('table1');
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('follows the clock, so a later update from a fresh server still sorts after earlier ones', () => {
    // Many updates on one server
    let last = 0;
    for (let i = 0; i < 100; i++) last = nextSeq('table1');
    // A different server instance starts with no memory of this table
    resetSeq('table1');
    now += 5;
    expect(nextSeq('table1')).toBeGreaterThan(last);
  });

  it('keeps tables separate', () => {
    nextSeq('table1');
    nextSeq('table1');
    const first2 = nextSeq('table2');
    expect(first2).toBe(now * 1000);
  });

  it('stays a safe integer', () => {
    expect(Number.isSafeInteger(nextSeq('table1'))).toBe(true);
  });

  it('does not throw when resetting a table it never saw', () => {
    expect(() => resetSeq('non-existent-table')).not.toThrow();
  });
});
