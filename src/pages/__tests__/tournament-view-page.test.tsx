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
  registration: { open: false, full: false, maxPlayers: null },
  costs: { entry: 13, rebuy: 12, addOn: 10 },
  chipCounts: [{ userId: 'a', name: 'Alice', chips: 40000 }, { userId: 'me', name: 'Me', chips: 25000 }],
  tables: [{ number: 2, roomId: 'room-2', players: [{ seat: 5, userId: 'me', name: 'Me' }, { seat: 7, userId: 'a', name: 'Alice' }] }],
  canManage: false,
  entrants: [],
  undo: null,
  cancelled: null,
  refunds: [],
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
    forfeited: 0,
    board: [
      { userId: 'a', name: 'Alice', won: 4.5, bounty: 6.5 },
      { userId: 'z', name: 'Zed', won: 1, bounty: null },
    ],
  },
  finishers: [{ place: 10, userId: 'z', name: 'Zed', prize: 0, eliminatedBy: 'a', removed: false }],
  you: { eliminated: false, canUnregister: false, canRebuy: false, canAddOn: false, place: null, table: 2, seat: 5, bounty: 3, bountyWon: 1, paid: 13, chips: 25000, roomId: 'room-2' },
  ...overrides,
});

let view: TournamentView;
let posts: { url: string; body: any }[];
beforeEach(() => {
  jest.useFakeTimers();
  view = baseView();
  posts = [];
  localStorage.setItem('auth_token', 'token-1');
  (global as any).fetch = jest.fn(async (url: string, init?: any) => {
    if (init?.method === 'POST') {
      posts.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => view };
  });
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
      finishers: [{ place: 2, userId: 'me', name: 'Me', prize: 60, eliminatedBy: 'a', removed: false }],
      you: { eliminated: true, canUnregister: false, canRebuy: false, canAddOn: false, place: 2, table: null, seat: null, bounty: null, bountyWon: 2, paid: 13, chips: 25000, roomId: 'room-2' },
    });
    await renderPage();
    expect(within(screen.getByRole('region', { name: 'You' })).getByText('Finished 2nd, won $60')).toBeInTheDocument();
  });

  test('shows an error when the tournament cannot be loaded', async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: 'Tournament not found' }) }));
    render(<TournamentPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Tournament not found');
  });

  test('lists the tables and seats', async () => {
    await renderPage();
    const tables = screen.getByRole('region', { name: 'Tables' });
    expect(within(tables).getByText('Table 2')).toBeInTheDocument();
    expect(within(tables).getByText('Seat 7: Alice')).toBeInTheDocument();
  });

  test('a signed-in visitor can register while registration is open', async () => {
    view = baseView({ status: 'setup', you: null, registration: { open: true, full: false, maxPlayers: null } });
    await renderPage();
    await act(async () => { screen.getByRole('button', { name: 'Register ($13)' }).click(); });
    expect(posts).toEqual([{ url: '/api/tournaments/register', body: { tournamentId: 't-1' } }]);
  });

  test('a busted player can rebuy and return, and the director gets a link to the controls', async () => {
    view = baseView({
      you: { eliminated: true, canUnregister: false, canRebuy: true, canAddOn: false, place: 10, table: null, seat: null, bounty: null, bountyWon: 0, paid: 13, chips: 25000, roomId: 'room-2' },
      canManage: true,
    });
    await renderPage();
    expect(screen.getByRole('link', { name: 'Director controls' })).toHaveAttribute('href', '/tournaments/t-1/manage');
    await act(async () => { screen.getByRole('button', { name: 'Rebuy and return ($12)' }).click(); });
    expect(posts[0]).toEqual({ url: '/api/tournaments/rebuy', body: { tournamentId: 't-1' } });
  });

  test('a refused action shows why', async () => {
    view = baseView({ status: 'setup', you: { ...baseView().you!, canUnregister: true } });
    (global as any).fetch = jest.fn(async (_url: string, init?: any) =>
      init?.method === 'POST'
        ? { ok: false, status: 400, json: async () => ({ error: 'You can only unregister before the tournament starts' }) }
        : { ok: true, json: async () => view });
    await renderPage();
    await act(async () => { screen.getByRole('button', { name: 'Unregister' }).click(); });
    expect(await screen.findByText('You can only unregister before the tournament starts')).toBeInTheDocument();
  });

  test('a cancelled tournament says so instead of showing the clock', async () => {
    view = baseView({ status: 'cancelled', cancelled: { at: 1, reason: 'Venue closed' } });
    await renderPage();
    const section = screen.getByRole('region', { name: 'Cancelled' });
    expect(within(section).getByText('Venue closed')).toBeInTheDocument();
    expect(within(section).getByText(/You paid in \$13/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Clock' })).not.toBeInTheDocument();
  });

  test('shows the chip counts and a link to the table of the viewer', async () => {
    await renderPage();
    const counts = screen.getByRole('region', { name: 'Chip counts' });
    expect(within(counts).getByText('1. Alice')).toBeInTheDocument();
    expect(within(counts).getByText('40,000')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'You' })).getByText('Your stack: 25,000')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to your table' })).toHaveAttribute('href', '/game/room-2');
  });
});
