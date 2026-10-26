import React from 'react';
import { act, render, screen } from '@testing-library/react';
import TableAnnouncer, { ANNOUNCE_DEBOUNCE_MS } from '../TableAnnouncer';

const base = {
  handId: 'h1',
  stage: 'preflop',
  activePlayer: 'amy',
  turnSeq: 1,
  currentBet: 2,
  communityCards: [],
  handActions: [] as any[],
  players: [{ id: 'me', currentBet: 0 }, { id: 'amy', currentBet: 2 }, { id: 'bob', currentBet: 0 }],
};

const props = { viewerId: 'me', nameOf: (id: string) => id.toUpperCase(), formatAmount: (n: number) => `$${n}` };

describe('TableAnnouncer', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('merges a burst of updates into one polite announcement', () => {
    const { rerender } = render(<TableAnnouncer gameState={base} {...props} />);
    const region = screen.getByTestId('table-announcer');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');

    const s1 = { ...base, activePlayer: 'bob', turnSeq: 2, handActions: [{ playerId: 'amy', action: 'raise', amount: 6, put: 4 }] };
    rerender(<TableAnnouncer gameState={s1} {...props} />);
    const s2 = { ...s1, activePlayer: 'me', turnSeq: 3, currentBet: 6, handActions: [...s1.handActions, { playerId: 'bob', action: 'fold', put: 0 }] };
    rerender(<TableAnnouncer gameState={s2} {...props} />);

    // Nothing is read until the burst settles
    expect(region.textContent).toBe('');
    act(() => { jest.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS + 100); });
    expect(region.textContent).toBe('AMY raises to $6. BOB folds. Your turn. $6 to call.');
  });
});
