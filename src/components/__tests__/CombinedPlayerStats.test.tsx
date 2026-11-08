import { render, screen } from '@testing-library/react';
import CombinedPlayerStats from '../CombinedPlayerStats';

const summary = {
  handsPlayed: 40,
  handsWon: 12,
  profit: -35,
  biggestPot: 220,
  winnings: 310,
  losses: 345,
  sessions: 2,
  timePlayedMs: 90 * 60 * 1000,
};

function respond(body: unknown, ok = true) {
  (global as any).fetch = jest.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => body });
}

afterEach(() => {
  delete (global as any).fetch;
  localStorage.clear();
});

describe('CombinedPlayerStats', () => {
  it('shows the server totals, ignoring numbers left in this browser', async () => {
    localStorage.setItem('session_stats_old', JSON.stringify({ handsPlayed: 999, handsWon: 999, totalLosses: 999 }));
    respond(summary);
    render(<CombinedPlayerStats />);

    expect(await screen.findByText('40')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('30%')).toBeTruthy();
    expect(screen.getByText('-$35')).toBeTruthy();
    expect(screen.getByText('$345')).toBeTruthy();
    expect(screen.getByText('1h 30m')).toBeTruthy();
    expect(screen.queryByText('999')).toBeNull();
    expect((global as any).fetch).toHaveBeenCalledWith('/api/stats/summary', expect.anything());
  });

  it('invites a new player to play', async () => {
    respond({ ...summary, handsPlayed: 0, handsWon: 0 });
    render(<CombinedPlayerStats />);
    expect(await screen.findByText('No hands yet')).toBeTruthy();
  });

  it('says so when the totals cannot be loaded', async () => {
    respond({ error: 'nope' }, false);
    render(<CombinedPlayerStats />);
    expect(await screen.findByText(/could not be loaded/)).toBeTruthy();
  });
});
