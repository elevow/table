import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('next/router', () => ({ useRouter: () => ({ query: { id: 't-1' }, push: jest.fn() }) }));
// No live updates in these tests
jest.mock('../../../src/lib/realtime/supabaseClient', () => ({ getSupabaseBrowser: () => null }));

import ManageTournamentPage from '../../../pages/tournaments/[id]/manage';
import type { TournamentView } from '../../../src/lib/tournament/tournament-view';

const view = (overrides: Partial<TournamentView> = {}): TournamentView => ({
  id: 't-1',
  name: 'Friday KO',
  status: 'running',
  serverNow: 0,
  level: { number: 2, smallBlind: 200, bigBlind: 400, ante: null, minutes: 12 },
  nextLevel: { number: 3, smallBlind: 300, bigBlind: 600, ante: 75, minutes: 12 },
  levelRemainingMs: 300_000,
  directorControlsLevels: false,
  breakAfterLevelMinutes: null,
  rebuysOpen: false,
  waitingOnRebuys: false,
  handForHandRound: null,
  onBreak: false,
  breakRemainingMs: null,
  players: { entrants: 4, entries: 4, remaining: 3, paidPlaces: 3 },
  registration: { open: false, full: false, maxPlayers: null },
  costs: { entry: 13, rebuy: 12, addOn: null, reentry: null },
  startsAt: null,
  minPlayers: null,
  chipCounts: [],
  tables: [{ number: 1, roomId: 'room-1', players: [
    { seat: 2, userId: 'a', name: 'Alice' },
    { seat: 5, userId: 'b', name: 'Bob' },
    { seat: 8, userId: 'c', name: 'Cara' },
  ] }],
  canManage: true,
  entrants: [
    { userId: 'a', name: 'Alice', out: false },
    { userId: 'b', name: 'Bob', out: false },
    { userId: 'c', name: 'Cara', out: false },
    { userId: 'd', name: 'Dev', out: true },
  ],
  undo: null,
  cancelled: null,
  refunds: [],
  prizePool: 40,
  payouts: [],
  chipsInPlay: 80000,
  averageStack: 26667,
  bounty: { type: 'standard', amount: 2, total: 8, forfeited: 0, board: [] },
  finishers: [{ place: 4, userId: 'd', name: 'Dev', prize: 0, eliminatedBy: 'a', removed: false }],
  you: null,
  ...overrides,
});

let current: TournamentView;
let posts: { url: string; body: any }[];
beforeEach(() => {
  current = view();
  posts = [];
  localStorage.setItem('auth_token', 'token-1');
  (global as any).fetch = jest.fn(async (url: string, init?: any) => {
    if (init?.method === 'POST') {
      posts.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => current };
  });
  window.confirm = jest.fn(() => true);
});

const renderPage = async () => {
  render(<ManageTournamentPage />);
  await screen.findByText('Run Friday KO');
};

describe('Director screen', () => {
  test('runs the clock', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(posts).toEqual([{ url: '/api/tournaments/pause', body: { tournamentId: 't-1' } }]));
    // Buttons are disabled while an action is under way
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next level now' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Next level now' }));
    await waitFor(() => expect(posts[1]).toEqual({ url: '/api/tournaments/advance-level', body: { tournamentId: 't-1' } }));
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
  });

  test('starts a tournament once two players are registered', async () => {
    current = view({ status: 'setup', level: null, tables: [], players: { entrants: 1, remaining: 1, paidPlaces: 1 } });
    await renderPage();
    expect(screen.getByRole('button', { name: /Start tournament/ })).toBeDisabled();
  });

  test('eliminates a player, naming who made the knockout in a bounty tournament', async () => {
    await renderPage();
    const section = screen.getByRole('region', { name: 'Eliminate a player' });
    const eliminate = within(section).getByRole('button', { name: 'Eliminate' });
    fireEvent.change(within(section).getByLabelText('Player out'), { target: { value: 'c' } });
    expect(eliminate).toBeDisabled(); // the bounty needs a knocker
    // The player going out isn't offered as their own knocker
    expect(within(within(section).getByLabelText('Knocked out by')).queryByText(/Cara/)).not.toBeInTheDocument();
    fireEvent.change(within(section).getByLabelText('Knocked out by'), { target: { value: 'a' } });
    fireEvent.click(eliminate);
    expect(window.confirm).toHaveBeenCalledWith('Eliminate Cara by Alice?');
    await waitFor(() => expect(posts).toEqual([{ url: '/api/tournaments/eliminate', body: { tournamentId: 't-1', userId: 'c', eliminatedBy: 'a' } }]));
    expect(await screen.findByText('Cara is out')).toBeInTheDocument();
  });

  test('without bounties the knocker is optional, and cancelling the confirmation does nothing', async () => {
    current = view({ bounty: null });
    await renderPage();
    const section = screen.getByRole('region', { name: 'Eliminate a player' });
    expect(within(section).getByLabelText('Knocked out by (optional)')).toBeInTheDocument();
    fireEvent.change(within(section).getByLabelText('Player out'), { target: { value: 'b' } });
    (window.confirm as jest.Mock).mockReturnValueOnce(false);
    fireEvent.click(within(section).getByRole('button', { name: 'Eliminate' }));
    expect(posts).toEqual([]);
    fireEvent.click(within(section).getByRole('button', { name: 'Eliminate' }));
    await waitFor(() => expect(posts).toEqual([{ url: '/api/tournaments/eliminate', body: { tournamentId: 't-1', userId: 'b' } }]));
  });

  test('records a rebuy at the desk, including for a busted player', async () => {
    await renderPage();
    const desk = screen.getByRole('region', { name: 'Desk' });
    expect(within(within(desk).getByLabelText('Player')).getByText('Dev (out)')).toBeInTheDocument();
    fireEvent.change(within(desk).getByLabelText('Player'), { target: { value: 'd' } });
    fireEvent.click(within(desk).getByRole('button', { name: 'Rebuy ($12)' }));
    await waitFor(() => expect(posts).toEqual([{ url: '/api/tournaments/rebuy', body: { tournamentId: 't-1', forPlayer: 'd' } }]));
  });

  test('shows why an action was refused', async () => {
    (global as any).fetch = jest.fn(async (_url: string, init?: any) =>
      init?.method === 'POST'
        ? { ok: false, status: 400, json: async () => ({ error: 'Already at the last blind level' }) }
        : { ok: true, json: async () => current });
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Next level now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Already at the last blind level');
  });

  test('turns away people who do not run the tournament', async () => {
    current = view({ canManage: false });
    render(<ManageTournamentPage />);
    expect(await screen.findByText('Only the tournament director can run Friday KO.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
  });

  test('undoes the latest elimination', async () => {
    current = view({ undo: { userId: 'd', name: 'Dev' } });
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Undo: put Dev back' }));
    await waitFor(() => expect(posts).toEqual([{ url: '/api/tournaments/undo-elimination', body: { tournamentId: 't-1' } }]));
    expect(await screen.findByText('Dev is back in')).toBeInTheDocument();
  });

  test('removes a player after confirming', async () => {
    await renderPage();
    const section = screen.getByRole('region', { name: 'Remove a player' });
    expect(within(section).getByText(/disqualification/)).toBeInTheDocument();
    // Players already out aren't offered
    expect(within(within(section).getByLabelText('Player')).queryByText('Dev')).not.toBeInTheDocument();
    fireEvent.change(within(section).getByLabelText('Player'), { target: { value: 'b' } });
    fireEvent.click(within(section).getByRole('button', { name: 'Remove' }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Remove Bob?'));
    await waitFor(() => expect(posts).toEqual([{ url: '/api/tournaments/remove-player', body: { tournamentId: 't-1', userId: 'b' } }]));
  });

  test('cancels with a reason, or not at all if the prompt is dismissed', async () => {
    await renderPage();
    window.prompt = jest.fn(() => null);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel tournament' }));
    expect(posts).toEqual([]);
    window.prompt = jest.fn(() => 'Venue closed');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel tournament' }));
    await waitFor(() => expect(posts).toEqual([{ url: '/api/tournaments/cancel', body: { tournamentId: 't-1', reason: 'Venue closed' } }]));
  });

  test('a cancelled tournament shows what each player is owed', async () => {
    current = view({
      status: 'cancelled',
      cancelled: { at: 1, reason: 'Venue closed' },
      refunds: [{ userId: 'a', name: 'Alice', paid: 25 }, { userId: 'b', name: 'Bob', paid: 13 }],
    });
    await renderPage();
    const section = screen.getByRole('region', { name: 'Cancelled' });
    expect(within(section).getByText('Reason: Venue closed')).toBeInTheDocument();
    expect(within(section).getByText('$25')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel tournament' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Eliminate a player' })).not.toBeInTheDocument();
  });

  test('before the start the structure can be edited', async () => {
    current = view({ status: 'setup', level: null, tables: [] });
    await renderPage();
    expect(screen.getByRole('link', { name: 'Edit structure' })).toHaveAttribute('href', '/tournaments/t-1/edit');
    expect(within(screen.getByRole('region', { name: 'Remove a player' })).getByText(/registered by mistake/)).toBeInTheDocument();
  });

  test('with the director moving levels on, the buttons say what comes next', async () => {
    current = view({ directorControlsLevels: true, breakAfterLevelMinutes: 10 });
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Start the 10-minute break' }));
    await waitFor(() => expect(posts).toEqual([{ url: '/api/tournaments/advance-level', body: { tournamentId: 't-1' } }]));
  });

  test('with one player left and rebuys open, the director is told to close rebuys', async () => {
    current = view({ rebuysOpen: true, waitingOnRebuys: true });
    await renderPage();
    expect(screen.getByText(/One player is left/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close rebuys' }));
    await waitFor(() => expect(posts).toEqual([{ url: '/api/tournaments/close-rebuys', body: { tournamentId: 't-1' } }]));
  });

  test('a break waiting on the director has an End break button', async () => {
    current = view({ directorControlsLevels: true, status: 'on-break', onBreak: true, breakRemainingMs: 0, levelRemainingMs: null });
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'End break' }));
    await waitFor(() => expect(posts).toEqual([{ url: '/api/tournaments/end-break', body: { tournamentId: 't-1' } }]));
  });
});
