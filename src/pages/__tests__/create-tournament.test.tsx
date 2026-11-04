import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockPush = jest.fn();
jest.mock('next/router', () => ({ useRouter: () => ({ push: mockPush }) }));

import CreateTournamentPage from '../../../pages/tournaments/create';

let permissions: string[];
let createResponse: { ok: boolean; status: number; body: any };
const fetchMock = jest.fn(async (url: string, init?: any) => {
  if (url === '/api/auth/check-admin') return { ok: true, json: async () => ({ permissions }) };
  if (url === '/api/tournaments/create') return { ok: createResponse.ok, status: createResponse.status, json: async () => createResponse.body };
  throw new Error(`unexpected fetch ${url}`);
});

beforeEach(() => {
  permissions = ['tournament.create'];
  createResponse = { ok: true, status: 201, body: {} };
  fetchMock.mockClear();
  (global as any).fetch = fetchMock;
  localStorage.setItem('auth_token', 'token-1');
});

const levelRows = () => screen.getAllByLabelText(/^Level \d+ small blind$/);
const submit = () => screen.getByRole('button', { name: 'Create tournament' });

describe('Create tournament page', () => {
  test('starts from the standard freezeout and shows when each level starts', () => {
    render(<CreateTournamentPage />);
    expect(levelRows()).toHaveLength(4);
    expect(screen.getByLabelText('Level 3 ante')).toHaveValue(75);
    expect(screen.getByLabelText('Break after level 2 minutes')).toHaveValue(10);
    // 12-minute levels, 10-minute break after level 2: level 3 starts at 0:34
    expect(screen.getByText('0:34')).toBeInTheDocument();
  });

  test('levels, antes, timers and breaks can be edited', () => {
    render(<CreateTournamentPage />);
    fireEvent.change(screen.getByLabelText('Level 1 ante'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Level 1 minutes'), { target: { value: '20' } });
    expect(screen.getByText('0:20')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add level' }));
    expect(levelRows()).toHaveLength(5);

    fireEvent.click(screen.getByRole('button', { name: 'Remove break after level 2' }));
    expect(screen.queryByLabelText('Break after level 2 minutes')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Add break after' })[0]);
    expect(screen.getByLabelText('Break after level 1 minutes')).toHaveValue(10);

    fireEvent.click(screen.getByRole('button', { name: 'Remove level 5' }));
    expect(levelRows()).toHaveLength(4);
  });

  test('problems are listed and block creating', () => {
    render(<CreateTournamentPage />);
    expect(within(screen.getByLabelText('Problems')).getByText('Give the tournament a name')).toBeInTheDocument();
    expect(submit()).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('Friday Night Freezeout'), { target: { value: 'Weekly' } });
    expect(screen.queryByLabelText('Problems')).not.toBeInTheDocument();
    expect(submit()).toBeEnabled();

    fireEvent.change(screen.getByLabelText('Level 2 big blind'), { target: { value: '100' } }); // below the 200 small blind
    expect(within(screen.getByLabelText('Problems')).getByText('Level 2 big blind < small blind')).toBeInTheDocument();
    expect(submit()).toBeDisabled();
  });

  test('creates the tournament with the edited structure', async () => {
    createResponse = {
      ok: true,
      status: 201,
      body: { id: 't-1', name: 'Weekly', config: { blindLevels: [{}, {}, {}, {}], startingStack: 25000, seatsPerTable: 6 } },
    };
    render(<CreateTournamentPage />);
    fireEvent.change(screen.getByPlaceholderText('Friday Night Freezeout'), { target: { value: 'Weekly' } });
    fireEvent.change(screen.getByLabelText('Starting stack'), { target: { value: '25000' } });
    fireEvent.change(screen.getByLabelText('Seats per table'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Level 4 minutes'), { target: { value: '30' } });
    fireEvent.click(submit());

    await screen.findByText('Tournament created');
    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/tournaments/create')!;
    expect(init.headers.Authorization).toBe('Bearer token-1');
    const body = JSON.parse(init.body);
    expect(body.name).toBe('Weekly');
    expect(body.config).toMatchObject({ startingStack: 25000, seatsPerTable: 6 });
    expect(body.config.blindLevels[3].durationMinutes).toBe(30);
    expect(screen.getByText(/t-1/)).toBeInTheDocument();
  });

  test('shows the error when the server refuses', async () => {
    createResponse = { ok: false, status: 400, body: { error: 'Invalid tournament config: nope' } };
    render(<CreateTournamentPage />);
    fireEvent.change(screen.getByPlaceholderText('Friday Night Freezeout'), { target: { value: 'Weekly' } });
    fireEvent.click(submit());
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid tournament config: nope');
  });

  test('without tournament.create the page says so and cannot submit', async () => {
    permissions = [];
    render(<CreateTournamentPage />);
    expect(await screen.findByText(/don't have permission to create tournaments/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Friday Night Freezeout'), { target: { value: 'Weekly' } });
    expect(submit()).toBeDisabled();
  });

  test('rebuys can run until a chosen level or every level', async () => {
    createResponse = { ok: true, status: 201, body: { id: 't-2', name: 'Weekly', config: { blindLevels: [], startingStack: 1 } } };
    render(<CreateTournamentPage />);
    fireEvent.change(screen.getByPlaceholderText('Friday Night Freezeout'), { target: { value: 'Weekly' } });
    fireEvent.click(screen.getByLabelText('Allow rebuys'));
    expect(screen.getByLabelText('Until level')).toHaveValue('4');
    fireEvent.change(screen.getByLabelText('Until level'), { target: { value: '' } });
    expect(screen.getByLabelText('Until level')).toHaveValue('');
    fireEvent.click(submit());
    await screen.findByText('Tournament created');
    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/tournaments/create')!;
    const { rebuys } = JSON.parse(init.body).config;
    expect(rebuys.enabled).toBe(true);
    expect(rebuys.availableUntilLevel).toBeUndefined();
  });

  test('buy-in, fee and bounty set what players pay and go to the server', async () => {
    createResponse = { ok: true, status: 201, body: { id: 't-3', name: 'KO', config: { blindLevels: [], startingStack: 1 } } };
    render(<CreateTournamentPage />);
    fireEvent.change(screen.getByPlaceholderText('Friday Night Freezeout'), { target: { value: 'KO' } });
    fireEvent.change(screen.getByLabelText(/Buy-in \(\$\)/), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/Entry fee/), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Bounty'), { target: { value: 'progressive' } });
    fireEvent.change(screen.getByLabelText('Bounty ($)'), { target: { value: '2' } });
    expect(screen.getByText(/Players pay \$13 to enter/)).toBeInTheDocument();
    expect(screen.getByText(/wins half their bounty/)).toBeInTheDocument();

    fireEvent.click(submit());
    await screen.findByText('Tournament created');
    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/tournaments/create')!;
    expect(JSON.parse(init.body).config).toMatchObject({ buyIn: 10, entryFee: 1, bounty: { amount: 2, type: 'progressive' } });

    fireEvent.click(screen.getByRole('button', { name: 'View tournament' }));
    expect(mockPush).toHaveBeenCalledWith('/tournaments/t-3');
  });

  test('turning the bounty off removes it', () => {
    render(<CreateTournamentPage />);
    fireEvent.change(screen.getByLabelText('Bounty'), { target: { value: 'standard' } });
    expect(screen.getByLabelText('Bounty ($)')).toHaveValue(2);
    fireEvent.change(screen.getByLabelText('Bounty'), { target: { value: 'none' } });
    expect(screen.queryByLabelText('Bounty ($)')).not.toBeInTheDocument();
  });

  test('start time, a share of the field, late registration and re-entry go to the server', async () => {
    createResponse = { ok: true, status: 201, body: { id: 't-4', name: 'Sched', config: { blindLevels: [], startingStack: 1 } } };
    render(<CreateTournamentPage />);
    fireEvent.change(screen.getByPlaceholderText('Friday Night Freezeout'), { target: { value: 'Sched' } });

    fireEvent.change(screen.getByLabelText(/Start time/), { target: { value: '2030-01-05T20:00' } });
    fireEvent.change(screen.getByLabelText(/Minimum players/), { target: { value: '6' } });

    fireEvent.click(screen.getByLabelText('A share of the field'));
    fireEvent.change(screen.getByLabelText('Share of entries paid (%)'), { target: { value: '20' } });
    expect(screen.getByText(/30 entries: 6 paid/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Until the end of level'), { target: { value: '3' } });
    fireEvent.click(screen.getByLabelText(/Let busted players buy a new entry/));
    fireEvent.change(screen.getByLabelText('Up to (per player)'), { target: { value: '1' } });

    fireEvent.click(submit());
    await screen.findByText('Tournament created');
    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/tournaments/create')!;
    const config = JSON.parse(init.body).config;
    expect(config.startsAt).toBe(new Date('2030-01-05T20:00').getTime());
    expect(config.minPlayers).toBe(6);
    expect(config.payoutScaling).toEqual({ paidPercent: 20 });
    expect(config.lateRegistration).toMatchObject({ enabled: true, endLevel: 3 });
    expect(config.reentry).toEqual({ enabled: true, maxPerPlayer: 1 });
  });

  test('levels change when the director says; automatic levels aren\'t offered', async () => {
    createResponse = { ok: true, status: 201, body: { id: 't-5', name: 'Director', config: { blindLevels: [], startingStack: 1 } } };
    render(<CreateTournamentPage />);
    expect(screen.getByText(/The minutes are a guide/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Automatically when time runs out')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Friday Night Freezeout'), { target: { value: 'Director' } });
    fireEvent.click(submit());
    await screen.findByText('Tournament created');
    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/tournaments/create')!;
    expect(JSON.parse(init.body).config.levelControl).toBe('director');
  });

  test('turning late registration off turns re-entry off with it', () => {
    render(<CreateTournamentPage />);
    fireEvent.click(screen.getByLabelText(/Let busted players buy a new entry/));
    fireEvent.click(screen.getByLabelText('Late registration'));
    expect(screen.getByLabelText(/Let busted players buy a new entry/)).not.toBeChecked();
    expect(screen.getByLabelText(/Let busted players buy a new entry/)).toBeDisabled();
  });

  test('choosing the rebuy preset shows its rebuy and add-on settings', async () => {
    render(<CreateTournamentPage />);
    fireEvent.change(screen.getByLabelText(/Start from/), { target: { value: 'rebuy_addon' } });
    expect(levelRows()).toHaveLength(5);
    expect(screen.getByLabelText('Allow rebuys')).toBeChecked();
    expect(screen.getByLabelText('At the break after level')).toHaveValue('3');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });
});
