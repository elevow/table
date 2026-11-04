import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('next/router', () => ({ useRouter: () => ({ push: jest.fn(), query: {} }) }));

import TournamentLobbyPage from '../../../pages/tournaments/index';
import type { TournamentSummary } from '../../../src/lib/tournament/tournament-view';

const summary = (overrides: Partial<TournamentSummary> = {}): TournamentSummary => ({
  id: 't-1',
  name: 'Sunday PKO',
  status: 'setup',
  createdAt: 1,
  startingStack: 20000,
  seatsPerTable: 9,
  costs: { entry: 13, rebuy: null, addOn: null },
  bounty: 'progressive',
  entrants: 12,
  remaining: 12,
  maxPlayers: 60,
  level: null,
  registrationOpen: true,
  you: { registered: false, eliminated: false },
  canManage: false,
  ...overrides,
});

let lists: Record<string, TournamentSummary[]>;
let permissions: string[];
const fetchMock = jest.fn(async (url: string, init?: any) => {
  if (url === '/api/auth/check-admin') return { ok: true, json: async () => ({ permissions }) };
  if (url.startsWith('/api/tournaments/list')) {
    const filter = new URL(url, 'http://x').searchParams.get('filter')!;
    return { ok: true, json: async () => ({ tournaments: lists[filter] ?? [] }) };
  }
  if (init?.method === 'POST') return { ok: true, json: async () => ({}) };
  throw new Error(`unexpected ${url}`);
});

beforeEach(() => {
  permissions = ['tournament.view', 'tournament.register'];
  lists = { upcoming: [summary()], running: [], finished: [] };
  fetchMock.mockClear();
  (global as any).fetch = fetchMock;
  localStorage.setItem('auth_token', 'token-1');
});

describe('Tournament lobby', () => {
  test('lists upcoming tournaments with their buy-in, players and bounty type', async () => {
    render(<TournamentLobbyPage />);
    const row = (await screen.findByRole('link', { name: 'Sunday PKO' })).closest('tr')!;
    expect(row).toHaveTextContent('Registering');
    expect(row).toHaveTextContent('12 / 60');
    expect(row).toHaveTextContent('$13');
    expect(row).toHaveTextContent('PKO');
    expect(within(row).getByRole('link', { name: 'Sunday PKO' })).toHaveAttribute('href', '/tournaments/t-1');
  });

  test('registering posts and reloads the list', async () => {
    render(<TournamentLobbyPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Register for Sunday PKO' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/tournaments/register', expect.objectContaining({ method: 'POST' })));
    const post = fetchMock.mock.calls.find(([url]) => url === '/api/tournaments/register')!;
    expect(JSON.parse(post[1].body)).toEqual({ tournamentId: 't-1' });
  });

  test('a registered player can unregister before the start', async () => {
    lists.upcoming = [summary({ you: { registered: true, eliminated: false } })];
    render(<TournamentLobbyPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Unregister from Sunday PKO' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/tournaments/unregister', expect.anything()));
  });

  test('running tournaments show the level, late registration and a manage link for the director', async () => {
    lists.running = [summary({ status: 'on-break', level: 4, remaining: 7, canManage: true })];
    render(<TournamentLobbyPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Running' }));
    const row = (await screen.findByRole('link', { name: 'Sunday PKO' })).closest('tr')!;
    expect(row).toHaveTextContent('Level 4, on break');
    expect(row).toHaveTextContent('7 / 12');
    expect(within(row).getByRole('button', { name: 'Register for Sunday PKO' })).toHaveTextContent('Late register');
    expect(within(row).getByRole('link', { name: 'Manage' })).toHaveAttribute('href', '/tournaments/t-1/manage');
  });

  test('the create button shows only with tournament.create', async () => {
    render(<TournamentLobbyPage />);
    await screen.findByText('Sunday PKO');
    expect(screen.queryByRole('link', { name: 'Create tournament' })).not.toBeInTheDocument();
  });

  test('directors see the create button', async () => {
    permissions = ['tournament.create'];
    render(<TournamentLobbyPage />);
    expect(await screen.findByRole('link', { name: 'Create tournament' })).toHaveAttribute('href', '/tournaments/create');
  });

  test('says when there is nothing to show', async () => {
    lists.upcoming = [];
    render(<TournamentLobbyPage />);
    expect(await screen.findByText(/No upcoming tournaments/)).toBeInTheDocument();
  });
});
