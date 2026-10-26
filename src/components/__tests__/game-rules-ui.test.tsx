import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import FixedLimitControls from '../FixedLimitControls';
import GameRulesBadges, { SevenDeuceBountyBanner } from '../GameRulesBadges';
import MixedGameSetup from '../MixedGameSetup';
import { HORSE_GAMES } from '../../lib/poker/variant-rules';
import type { Player, TableState } from '../../types/poker';

const me = (overrides: Partial<Player> = {}): Player => ({
  id: 'me', name: 'Me', position: 1, stack: 100, currentBet: 0,
  hasActed: false, isFolded: false, isAllIn: false, timeBank: 30, ...overrides,
});

const state = (overrides: Partial<TableState> = {}): TableState => ({
  tableId: 't', stage: 'flop', players: [me()], activePlayer: 'me', pot: 10, communityCards: [],
  currentBet: 0, dealerPosition: 0, smallBlind: 1, bigBlind: 2, minRaise: 2, lastRaise: 0,
  bettingMode: 'fixed-limit', limitBets: 0, ...overrides,
});

describe('FixedLimitControls', () => {
  test('offers a bet of exactly one small bet on the flop', () => {
    const onBet = jest.fn();
    render(<FixedLimitControls state={state()} playerId="me" onBet={onBet} onRaise={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bet $2' }));
    expect(onBet).toHaveBeenCalledWith(2);
  });

  test('offers a raise to the next level on the turn', () => {
    const onRaise = jest.fn();
    render(<FixedLimitControls state={state({ stage: 'turn', currentBet: 4, limitBets: 1 })} playerId="me" onBet={jest.fn()} onRaise={onRaise} />);
    fireEvent.click(screen.getByRole('button', { name: 'Raise to $8' }));
    expect(onRaise).toHaveBeenCalledWith(8);
  });

  test('says when betting is capped', () => {
    render(<FixedLimitControls state={state({ currentBet: 8, limitBets: 4 })} playerId="me" onBet={jest.fn()} onRaise={jest.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/capped/)).toBeTruthy();
  });

  test('a short stack sees an all-in', () => {
    render(<FixedLimitControls state={state({ players: [me({ stack: 1 })] })} playerId="me" onBet={jest.fn()} onRaise={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'All-in $1' })).toBeTruthy();
  });
});

describe('GameRulesBadges', () => {
  test('shows antes, the bounty and fixed limit', () => {
    render(<GameRulesBadges state={state({ ante: 1, sevenDeuceBounty: 5 })} />);
    expect(screen.getByText('Fixed limit')).toBeTruthy();
    expect(screen.getByText('Ante $1')).toBeTruthy();
    expect(screen.getByText('7-2 bounty $5')).toBeTruthy();
  });

  test('shows the mixed-game rotation and hides rules that do not apply to the current game', () => {
    render(<GameRulesBadges state={state({ variant: 'razz', ante: 1, sevenDeuceBounty: 5, mixedGame: { games: HORSE_GAMES, handsPerGame: 3, index: 2, handsInGame: 1 } })} />);
    expect(screen.getByLabelText('Mixed game rotation').textContent).toBe('Now: Fixed Limit Razz · Next: Fixed Limit Seven-Card Stud in 2 hands');
    expect(screen.queryByText('Ante $1')).toBeNull();
    expect(screen.queryByText('7-2 bounty $5')).toBeNull();
  });

  test('announces a bounty at showdown', () => {
    render(<SevenDeuceBountyBanner state={state({ stage: 'showdown', sevenDeuceResult: { playerId: 'me', total: 10, payments: {} } })} />);
    expect(screen.getByRole('status').textContent).toContain('Me won with seven-deuce and collects $10');
  });
});

describe('MixedGameSetup', () => {
  test('adds and removes games and changes the hands per game', () => {
    const onChange = jest.fn();
    render(<MixedGameSetup games={HORSE_GAMES} handsPerGame={8} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '+ 5-Card Omaha' }));
    expect(onChange).toHaveBeenLastCalledWith([...HORSE_GAMES, { variant: 'omaha-5', bettingMode: 'pot-limit' }], 8);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    expect(onChange.mock.calls[1][0].map((g: any) => g.variant)).not.toContain('texas-holdem');
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '4' } });
    expect(onChange).toHaveBeenLastCalledWith(HORSE_GAMES, 4);
  });
});
