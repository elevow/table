import { act, render, screen } from '@testing-library/react';
import SessionLedgerPanel from '../SessionLedgerPanel';

jest.mock('../../utils/auth-headers', () => ({ authHeaders: () => ({}) }));

const respond = (status: number, body?: unknown) => {
  (global as any).fetch = jest.fn().mockResolvedValue({ ok: status === 200, status, json: async () => body });
};

// The panel waits a moment after each hand before loading
const load = async () => {
  await act(async () => { jest.advanceTimersByTime(1600); });
  await act(async () => {});
};

describe('SessionLedgerPanel', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-11-12T20:30:00')));
  afterEach(() => jest.useRealTimers());

  it('shows your session from the server, with win rate and time at the table', async () => {
    respond(200, {
      lines: [],
      payments: [],
      session: { handsPlayed: 8, handsWon: 2, biggestPotWon: 40, boughtIn: 100, net: -15, startedAt: new Date('2026-11-12T19:15:00').toISOString() },
    });
    render(<SessionLedgerPanel embedded tableId="t1" refreshKey={0} />);
    await load();
    expect(screen.getByText('25%')).toBeTruthy();
    expect(screen.getByText(/At the table 1h 15m/)).toBeTruthy();
    expect(screen.getByText('-$15')).toBeTruthy();
  });

  it('asks you to take a seat when you have not played here', async () => {
    respond(403);
    render(<SessionLedgerPanel embedded tableId="t1" refreshKey={0} />);
    await load();
    expect(screen.getByText(/Take a seat/)).toBeTruthy();
  });
});
