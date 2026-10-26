import React from 'react';
import { render, screen } from '@testing-library/react';
import HandActionLog from '../HandActionLog';
import HudBadge from '../HudBadge';
import { computeHudStats } from '../../lib/shared/hud-stats';
import type { HandActionEntry } from '../../types/poker';

const players = [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bob' }];

describe('HandActionLog', () => {
  it('shows a placeholder before anyone acts', () => {
    render(<HandActionLog actions={[]} players={players} handNumber={2} />);
    expect(screen.getByText('No actions yet this hand.')).toBeTruthy();
    expect(screen.getByText(/Hand #2/)).toBeTruthy();
  });

  it('lists actions in order with street separators', () => {
    const actions: HandActionEntry[] = [
      { playerId: 'a', action: 'small-blind', amount: 5, put: 5, stage: 'preflop' },
      { playerId: 'b', action: 'raise', amount: 40, put: 40, stage: 'preflop' },
      { playerId: 'a', action: 'call', amount: 40, put: 35, stage: 'preflop' },
      { playerId: 'b', action: 'bet', amount: 20, put: 20, stage: 'flop' },
      { playerId: 'x', action: 'fold', put: 0, stage: 'flop', auto: true },
    ];
    render(<HandActionLog actions={actions} players={players} />);
    const items = screen.getAllByRole('listitem').map(li => li.textContent);
    expect(items).toEqual([
      'Preflop',
      'Ann posts the small blind $5',
      'Bob raises to $40',
      'Ann calls $35',
      'Flop',
      'Bob bets $20',
      'Player folds (timed out)',
    ]);
  });
});

describe('HudBadge', () => {
  it('renders nothing without a sample', () => {
    const { container } = render(<HudBadge stats={computeHudStats([], 'a')} />);
    expect(container.textContent).toBe('');
  });

  it('shows VPIP/PFR and hands, with the rest in the tooltip', () => {
    const stats = computeHudStats([{ actions: [{ playerId: 'a', action: 'raise', amount: 30, put: 30, stage: 'preflop' }] }], 'a');
    render(<HudBadge stats={stats} />);
    const badge = screen.getByText('100/100 · 1');
    expect(badge.getAttribute('title')).toBe('VPIP 100%, PFR 100%, 3-bet –%, aggression –, over 1 hand you played together');
  });
});
