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

describe('SessionLedgerPanel with side bets', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-11-12T20:30:00')));
  afterEach(() => jest.useRealTimers());

  it('splits the night into poker and side bets, lists your side bets and settles both together', async () => {
    respond(200, {
      lines: [
        { playerId: 'me', playerName: 'Me', boughtIn: 100, cashedOut: 0, onTable: 140, net: 40, sideBets: -2.5, total: 37.5 },
        { playerId: 'b', playerName: 'Bo', boughtIn: 100, cashedOut: 0, onTable: 60, net: -40, sideBets: 2.5, total: -37.5 },
      ],
      payments: [{ from: 'Bo', to: 'Me', amount: 37.5 }],
      session: { handsPlayed: 3, handsWon: 1, biggestPotWon: 40, boughtIn: 100, net: 40, sideBets: -2.5, total: 37.5 },
      mySideBets: [{ handNumber: 3, bet: 'flop-color', note: 'Flop color (red)', amount: -2.5 }],
    });
    render(<SessionLedgerPanel embedded tableId="t1" refreshKey={0} />);
    await load();
    expect(screen.getByText('Poker net')).toBeTruthy();
    expect(screen.getByText('Night total')).toBeTruthy();
    expect(screen.getAllByText('+$37.50').length).toBeGreaterThan(0);

    await act(async () => { screen.getByRole('button', { name: 'Side bets net' }).click(); });
    expect(screen.getByText('Hand 3 · Flop color (red)')).toBeTruthy();

    await act(async () => { screen.getByRole('button', { name: 'Show table ledger' }).click(); });
    expect(screen.getByText('Side')).toBeTruthy();
    expect(screen.getByText(/poker and side bets together/)).toBeTruthy();
    expect(screen.getByText('Bo pays Me $37.50')).toBeTruthy();
  });
});
