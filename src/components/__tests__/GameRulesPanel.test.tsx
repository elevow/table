import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import GameRulesPanel from '../GameRulesPanel';
import { ALL_VARIANTS, VARIANT_LABELS } from '../../lib/poker/variant-rules';
import { GAME_RULES } from '../../lib/ui/game-rules';

describe('GameRulesPanel', () => {
  test('every game has a summary, how a hand plays, and how it is won', () => {
    for (const v of ALL_VARIANTS) {
      const rules = GAME_RULES[v];
      expect(rules.summary).toBeTruthy();
      expect(rules.howToPlay.length).toBeGreaterThan(0);
      expect(rules.winning.length).toBeGreaterThan(0);
    }
  });

  test('shows the game, its steps, and the table’s betting and wild cards', () => {
    render(<GameRulesPanel variant="texas-holdem" bettingMode="no-limit" wildRule="deuces" tableGame="texas-holdem" />);
    expect(screen.getByRole('heading', { name: "No Limit Texas Hold'em" })).toBeInTheDocument();
    expect(screen.getByText(/The flop: three cards/)).toBeInTheDocument();
    expect(screen.getByText(/you can bet or raise any amount/)).toBeInTheDocument();
    expect(screen.getByText(/every 2 counts as whatever card/)).toBeInTheDocument();
    expect(screen.getByText('Hand rankings, best first')).toBeInTheDocument();
  });

  test('a lowball game explains its own ranking instead of the high-hand chart', () => {
    render(<GameRulesPanel variant="razz" bettingMode="fixed-limit" />);
    expect(screen.getByText(/The best hand is 5-4-3-2-A/)).toBeInTheDocument();
    expect(screen.queryByText('Hand rankings, best first')).not.toBeInTheDocument();
  });

  test("a game's own wild cards are part of its rules, not repeated as a table option", () => {
    render(<GameRulesPanel variant="baseball" wildRule="baseball" />);
    expect(screen.getByText('3s and 9s are wild')).toBeInTheDocument();
    expect(screen.queryByText('At this table')).not.toBeInTheDocument();
  });

  test("Dealer's Choice before a game is chosen, and while the next one is", () => {
    const { rerender } = render(<GameRulesPanel variant="dealers-choice" tableGame="dealers-choice" />);
    expect(screen.getByText(/This table plays Dealer's Choice/)).toBeInTheDocument();
    expect(screen.getByText(/once a game is chosen/)).toBeInTheDocument();
    rerender(<GameRulesPanel variant="razz" tableGame="dealers-choice" choosing />);
    expect(screen.getByText(/The next game is being chosen/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: VARIANT_LABELS.razz })).toBeInTheDocument();
  });
});
