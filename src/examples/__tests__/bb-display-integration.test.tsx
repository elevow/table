/**
 * Tests for BB display integration example
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PlayerStackDisplay, GameTableDisplay } from '../bb-display-integration';
import type { Player } from '../../types/poker';
import type { GameSettings } from '../../components/GameSettings';

const mockPlayer: Player = {
  id: 'player-1',
  name: 'John Doe',
  position: 1,
  stack: 10000,
  currentBet: 0,
  hasActed: false,
  isFolded: false,
  isAllIn: false,
  timeBank: 30,
};

const mockSettings: GameSettings = {
  soundEnabled: true,
  chatEnabled: true,
  notificationsEnabled: true,
  autoFoldEnabled: false,
  rabbitHuntEnabled: false,
  timeBank: 30,
  highContrastCards: false,
  showPotOdds: true,
  showStackInBB: false,
};

describe('PlayerStackDisplay', () => {
  it('should display stack in chips when showStackInBB is false', () => {
    render(
      <PlayerStackDisplay
        player={mockPlayer}
        bigBlind={100}
        settings={mockSettings}
      />
    );
    
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('10,000')).toBeInTheDocument();
  });

  it('should display stack in BB when showStackInBB is true', () => {
    const bbSettings = { ...mockSettings, showStackInBB: true };
    
    render(
      <PlayerStackDisplay
        player={mockPlayer}
        bigBlind={100}
        settings={bbSettings}
      />
    );
    
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('100.0 BB')).toBeInTheDocument();
  });

  it('should handle different big blind values', () => {
    const bbSettings = { ...mockSettings, showStackInBB: true };
    
    render(
      <PlayerStackDisplay
        player={mockPlayer}
        bigBlind={200}
        settings={bbSettings}
      />
    );
    
    expect(screen.getByText('50.0 BB')).toBeInTheDocument();
  });

  it('should fall back to chips when big blind is invalid', () => {
    const bbSettings = { ...mockSettings, showStackInBB: true };
    
    render(
      <PlayerStackDisplay
        player={mockPlayer}
        bigBlind={0}
        settings={bbSettings}
      />
    );
    
    expect(screen.getByText('10,000')).toBeInTheDocument();
  });
});

describe('GameTableDisplay', () => {
  const mockPlayers: Player[] = [
    { ...mockPlayer, id: 'p1', name: 'Player 1', stack: 5000 },
    { ...mockPlayer, id: 'p2', name: 'Player 2', stack: 12000 },
    { ...mockPlayer, id: 'p3', name: 'Player 3', stack: 8500 },
  ];

  it('should display all players with chip stacks', () => {
    render(
      <GameTableDisplay
        players={mockPlayers}
        bigBlind={100}
        settings={mockSettings}
      />
    );
    
    expect(screen.getByText('Player 1')).toBeInTheDocument();
    expect(screen.getByText('5,000')).toBeInTheDocument();
    expect(screen.getByText('Player 2')).toBeInTheDocument();
    expect(screen.getByText('12,000')).toBeInTheDocument();
    expect(screen.getByText('Player 3')).toBeInTheDocument();
    expect(screen.getByText('8,500')).toBeInTheDocument();
  });

  it('should display all players with BB stacks', () => {
    const bbSettings = { ...mockSettings, showStackInBB: true };
    
    render(
      <GameTableDisplay
        players={mockPlayers}
        bigBlind={100}
        settings={bbSettings}
      />
    );
    
    expect(screen.getByText('Player 1')).toBeInTheDocument();
    expect(screen.getByText('50.0 BB')).toBeInTheDocument();
    expect(screen.getByText('Player 2')).toBeInTheDocument();
    expect(screen.getByText('120.0 BB')).toBeInTheDocument();
    expect(screen.getByText('Player 3')).toBeInTheDocument();
    expect(screen.getByText('85.0 BB')).toBeInTheDocument();
  });
});
