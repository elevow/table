import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('next/router', () => ({ useRouter: () => ({ query: { id: 't-1' }, push: jest.fn() }) }));

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
  onBreak: false,
  breakRemainingMs: null,
  players: { entrants: 4, remaining: 3, paidPlaces: 3 },
  registration: { open: false, full: false, maxPlayers: null },
  costs: { entry: 13, rebuy: 12, addOn: null },
  tables: [{ number: 1, players: [
    { seat: 2, userId: 'a', name: 'Alice' },
    { seat: 5, userId: 'b', name: 'Bob' },
    { seat: 8, userId: 'c', name: 'Cara' },
  ] }],
  canManage: true,
  prizePool: 40,
  payouts: [],
  chipsInPlay: 80000,
  averageStack: 26667,
  bounty: { type: 'standard', amount: 2, total: 8, board: [] },
  finishers: [{ place: 4, userId: 'd', name: 'Dev', prize: 0, eliminatedBy: 'a' }],
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
});
