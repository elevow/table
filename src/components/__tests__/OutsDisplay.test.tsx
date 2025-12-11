import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import OutsDisplay from '../OutsDisplay';
import { Card } from '../../types/poker';

function createCard(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit };
}

describe('OutsDisplay', () => {
  it('should render outs and odds correctly', () => {
    const outs: Card[] = [
      createCard('A', 'hearts'),
      createCard('K', 'hearts'),
      createCard('Q', 'hearts')
    ];

    const outsByCategory = [
      {
        category: 'Flush',
        cards: outs,
        count: 3
      }
    ];

    const { container } = render(
      <OutsDisplay
        outs={outs}
        oddsNextCard={15.5}
        oddsByRiver={32.8}
        outsByCategory={outsByCategory}
        losingPlayerName="Alice"
        winningPlayerName="Bob"
      />
    );

    // Check that the component renders with expected structure
    expect(screen.getByText('OUTS')).toBeInTheDocument();
    expect(container.textContent).toContain('Alice');
    expect(container.textContent).toContain('Bob');
    expect(container.textContent).toContain('15.5');
    expect(container.textContent).toContain('32.8');
    expect(container.textContent).toContain('3');
    expect(container.textContent).toContain('outs');
    expect(container.textContent).toContain('Flush');
  });

  it('should not render when there are no outs', () => {
    const { container } = render(
      <OutsDisplay
        outs={[]}
        oddsNextCard={0}
        losingPlayerName="Alice"
        winningPlayerName="Bob"
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('should handle missing player names', () => {
    const outs: Card[] = [
      createCard('A', 'hearts')
    ];

    render(
      <OutsDisplay
        outs={outs}
        oddsNextCard={2.2}
      />
    );

    // Should still render with generic text
    expect(screen.getByText(/Outs to Win/i)).toBeInTheDocument();
    expect(screen.getByText(/Cards that would improve the losing hand/i)).toBeInTheDocument();
  });

  it('should not show "By River" when oddsByRiver is undefined', () => {
    const outs: Card[] = [
      createCard('A', 'hearts')
    ];

    const { container } = render(
      <OutsDisplay
        outs={outs}
        oddsNextCard={2.2}
      />
    );

    expect(container.textContent).toContain('2.2');
    expect(screen.queryByText('By River')).not.toBeInTheDocument();
  });

  it('should render multiple categories', () => {
    const outs: Card[] = [
      createCard('A', 'hearts'),
      createCard('K', 'hearts'),
      createCard('9', 'spades')
    ];

    const outsByCategory = [
      {
        category: 'Flush',
        cards: [createCard('A', 'hearts'), createCard('K', 'hearts')],
        count: 2
      },
      {
        category: 'Straight',
        cards: [createCard('9', 'spades')],
        count: 1
      }
    ];

    const { container } = render(
      <OutsDisplay
        outs={outs}
        oddsNextCard={6.7}
        outsByCategory={outsByCategory}
      />
    );

    expect(container.textContent).toContain('Flush');
    expect(container.textContent).toContain('Straight');
    expect(container.textContent).toContain('2');
    expect(container.textContent).toContain('1');
  });
});
