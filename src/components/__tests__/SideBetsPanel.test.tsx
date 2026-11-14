import { act, fireEvent, render, screen } from '@testing-library/react';
import SideBetsPanel from '../SideBetsPanel';

jest.mock('../../utils/auth-headers', () => ({ authHeaders: () => ({}) }));

const view = (overrides: Record<string, unknown> = {}) => ({
  bets: [
    { bet: 'best-suit', stake: 1, players: ['Bo'], joined: false, pick: null },
    { bet: 'high-card-bingo', stake: 0.5, players: ['Bo', 'Me'], joined: true, pick: 'Q', pot: 3 },
  ],
  stakes: { 'best-suit': 1, 'high-card-bingo': 0.5 },
  canConfigure: false,
  seated: true,
  ...overrides,
});

let fetchMock: jest.Mock;
const serve = (getBody: unknown, postBody: unknown = { ok: true }) => {
  fetchMock = jest.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => (init?.method === 'POST' ? postBody : getBody),
  }));
  (global as any).fetch = fetchMock;
};
const load = async () => {
  await act(async () => { jest.advanceTimersByTime(1600); });
  await act(async () => {});
};
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(init.body));

describe('SideBetsPanel', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('shows each side bet with its stake, who is in, the pot and this hand\'s suit', async () => {
    serve(view());
    render(<SideBetsPanel tableId="t1" handNumber={1} refreshKey={0} />);
    await load();
    expect(screen.getByText('Best suit')).toBeTruthy();
    expect(screen.getByText('This hand: ♥ hearts')).toBeTruthy();
    expect(screen.getByText(/Pot:/).textContent).toContain('$3');
    expect(screen.getByText('You\'re in')).toBeTruthy();
    expect(screen.getByText(/In: Bo, Me/)).toBeTruthy();
  });

  it('joins, picks and leaves, and says when a change waits for the next hand', async () => {
    serve(view(), { ok: true, nextHand: true });
    render(<SideBetsPanel tableId="t1" handNumber={1} refreshKey={0} />);
    await load();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Join' })); });
    await act(async () => { fireEvent.change(screen.getByRole('combobox'), { target: { value: 'K' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Leave' })); });
    expect(posts()).toEqual([
      { tableId: 't1', action: 'join', bet: 'best-suit' },
      { tableId: 't1', action: 'join', bet: 'high-card-bingo', pick: 'K' },
      { tableId: 't1', action: 'leave', bet: 'high-card-bingo' },
    ]);
    expect(screen.getByText('Counts from the next hand.')).toBeTruthy();
  });

  it('asks players who are not seated to take a seat', async () => {
    serve(view({ seated: false }));
    render(<SideBetsPanel tableId="t1" refreshKey={0} />);
    await load();
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull();
    expect(screen.getByText('Take a seat to join side bets.')).toBeTruthy();
  });

  it('lets the host turn side bets on and set stakes', async () => {
    serve(view({ bets: [], stakes: {}, canConfigure: true }));
    render(<SideBetsPanel tableId="t1" refreshKey={0} />);
    await load();
    expect(screen.getByText(/No side bets are on yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Choose side bets and stakes' }));
    fireEvent.change(screen.getByLabelText('Flop color stake'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Bad beat jackpot stake'), { target: { value: '0.25' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    expect(posts()).toEqual([{ tableId: 't1', action: 'configure', stakes: { 'flop-color': 2, 'bad-beat': 0.25 } }]);
  });
});

describe('SideBetsPanel picks and challenges', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const players = [{ id: 'me', name: 'Me' }, { id: 'bo', name: 'Bo' }, { id: 'cy', name: 'Cy' }];

  it('picks the next hand winner from the players at the table', async () => {
    serve(view({
      bets: [{ bet: 'next-hand-winner', stake: 1, players: [], joined: false, pick: null }],
      players,
      me: 'me',
    }));
    render(<SideBetsPanel tableId="t1" refreshKey={0} />);
    await load();
    expect(screen.getByRole('option', { name: 'Me (you)' })).toBeTruthy();
    await act(async () => { fireEvent.change(screen.getByRole('combobox'), { target: { value: 'bo' } }); });
    expect(posts()).toEqual([{ tableId: 't1', action: 'join', bet: 'next-hand-winner', pick: 'bo' }]);
  });

  it('challenges a player, and answers and withdraws challenges', async () => {
    serve(view({
      bets: [{ bet: 'head-to-head', stake: 20, players: [], joined: false, pick: null }],
      players,
      me: 'me',
      challenges: [
        { id: 'c1', challengerId: 'bo', challengerName: 'Bo', opponentId: 'me', opponentName: 'Me', stake: 20, status: 'pending' },
      ],
    }));
    render(<SideBetsPanel tableId="t1" refreshKey={0} />);
    await load();
    expect(screen.getByText('$20 a challenge')).toBeTruthy();
    expect(screen.getByText(/Bo vs Me · \$20 · challenged you/)).toBeTruthy();
    // Bo already has a challenge with me, so only Cy can be challenged
    expect(screen.queryByRole('option', { name: 'Bo' })).toBeNull();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Accept' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Decline' })); });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'cy' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send challenge' })); });
    expect(posts()).toEqual([
      { tableId: 't1', action: 'accept', challengeId: 'c1' },
      { tableId: 't1', action: 'cancel', challengeId: 'c1' },
      { tableId: 't1', action: 'challenge', opponentId: 'cy' },
    ]);
  });
});
