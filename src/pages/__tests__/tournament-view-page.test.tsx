import React from 'react';
import { render, screen, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('next/router', () => ({ useRouter: () => ({ query: { id: 't-1' }, push: jest.fn() }) }));

import TournamentPage from '../../../pages/tournaments/[id]';
import type { TournamentView } from '../../../src/lib/tournament/tournament-view';

const MIN = 60_000;

const baseView = (overrides: Partial<TournamentView> = {}): TournamentView => ({
  id: 't-1',
  name: 'Friday KO',
  status: 'running',
  serverNow: 0,
  level: { number: 3, smallBlind: 300, bigBlind: 600, ante: 75, minutes: 12 },
  nextLevel: { number: 4, smallBlind: 400, bigBlind: 800, ante: 100, minutes: 12 },
  levelRemainingMs: 5 * MIN,
  onBreak: false,
  breakRemainingMs: null,
  players: { entrants: 20, remaining: 9, paidPlaces: 3 },
  prizePool: 200,
  payouts: [
    { place: 1, percentage: 50, amount: 100 },
    { place: 2, percentage: 30, amount: 60 },
    { place: 3, percentage: 20, amount: 40 },
  ],
  chipsInPlay: 400000,
  averageStack: 44444,
  bounty: {
    type: 'progressive',
    amount: 2,
    total: 40,
    board: [
      { userId: 'a', name: 'Alice', won: 4.5, bounty: 6.5 },
      { userId: 'z', name: 'Zed', won: 1, bounty: null },
    ],
  },
  finishers: [{ place: 10, userId: 'z', name: 'Zed', prize: 0, eliminatedBy: 'a' }],
  you: { eliminated: false, place: null, table: 2, seat: 5, bounty: 3, bountyWon: 1 },
  ...overrides,
});

let view: TournamentView;
beforeEach(() => {
  jest.useFakeTimers();
  view = baseView();
  (global as any).fetch = jest.fn(async () => ({ ok: true, json: async () => view }));
});
afterEach(() => jest.useRealTimers());

async function renderPage() {
  render(<TournamentPage />);
  await screen.findByText('Friday KO');
}

describe('Tournament page', () => {
  test('shows the level, blinds and a running countdown', async () => {
    await renderPage();
    const clock = screen.getByRole('region', { name: 'Clock' });
    expect(within(clock).getByText('300/600 ante 75')).toBeInTheDocument();
    expect(within(clock).getByText('5:00')).toBeInTheDocument();
    expect(within(clock).getByText('Next: 400/800 ante 100')).toBeInTheDocument();
    // The display ticks once a second, so 3 seconds on it reads 4:57 or 4:58 depending on when the tick lands
    await act(async () => { jest.advanceTimersByTime(3000); });
    expect(within(clock).getByText(/^4:5[78]$/)).toBeInTheDocument();
  });

  test('a paused clock stands still', async () => {
    view = baseView({ status: 'paused' });
    await renderPage();
    await act(async () => { jest.advanceTimersByTime(3000); });
    expect(screen.getByText('5:00')).toBeInTheDocument();
    expect(screen.getByText('Level 3 (paused)')).toBeInTheDocument();
  });

  test('shows the break countdown and the level play resumes with', async () => {
    view = baseView({ onBreak: true, status: 'on-break', breakRemainingMs: 4 * MIN, levelRemainingMs: null });
    await renderPage();
    expect(screen.getByText('4:00')).toBeInTheDocument();
    expect(screen.getByText('Back with level 3: 300/600 ante 75')).toBeInTheDocument();
  });

  test('shows players left, average stack, prize pool, payouts and the viewer', async () => {
    await renderPage();
    const summary = screen.getByRole('region', { name: 'Summary' });
    expect(within(summary).getByText('9 / 20')).toBeInTheDocument();
    expect(within(summary).getByText('44,444')).toBeInTheDocument();
    expect(within(summary).getByText('$200')).toBeInTheDocument();
    expect(within(summary).getByText('$40')).toBeInTheDocument();

    const payouts = screen.getByRole('region', { name: 'Payouts' });
    expect(within(payouts).getByText('Top 3 paid, 9 left')).toBeInTheDocument();
    expect(within(payouts).getByText('$100')).toBeInTheDocument();

    const you = screen.getByRole('region', { name: 'You' });
    expect(within(you).getByText('Table 2, seat 5')).toBeInTheDocument();
    expect(within(you).getByText('Bounty on you: $3')).toBeInTheDocument();
  });

  test('shows the bounty board', async () => {
    await renderPage();
    const bounties = screen.getByRole('region', { name: 'Bounties' });
    expect(within(bounties).getByText(/progressive/)).toBeInTheDocument();
    expect(within(bounties).getByText('$4.50')).toBeInTheDocument();
    expect(within(bounties).getByText('$6.50')).toBeInTheDocument();
    expect(within(bounties).getByText('Out')).toBeInTheDocument();
  });

  test('a finished player sees their place and prize', async () => {
    view = baseView({
      status: 'completed',
      finishers: [{ place: 2, userId: 'me', name: 'Me', prize: 60, eliminatedBy: 'a' }],
      you: { eliminated: true, place: 2, table: null, seat: null, bounty: null, bountyWon: 2 },
    });
    await renderPage();
    expect(within(screen.getByRole('region', { name: 'You' })).getByText('Finished 2nd, won $60')).toBeInTheDocument();
  });

  test('shows an error when the tournament cannot be loaded', async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: 'Tournament not found' }) }));
    render(<TournamentPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Tournament not found');
  });
});
