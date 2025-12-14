/**
 * GameSettings Component Tests
 *
 * Tests for the game settings component, focusing on pot odds toggle functionality
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import GameSettings from '../GameSettings';

describe('GameSettings', () => {
  const defaultProps = {
    gameId: 'test-game-123',
  };

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should render game settings', () => {
    render(<GameSettings {...defaultProps} />);
    expect(screen.getByText('Game Settings')).toBeInTheDocument();
  });

  it('should show pot odds toggle', () => {
    render(<GameSettings {...defaultProps} />);
    expect(screen.getByText('Show Pot Odds')).toBeInTheDocument();
  });

  it('should have pot odds enabled by default', () => {
    render(<GameSettings {...defaultProps} />);
    const checkbox = screen.getByLabelText(/Show Pot Odds/i) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('should toggle pot odds setting when checkbox is clicked', () => {
    render(<GameSettings {...defaultProps} />);
    const checkbox = screen.getByLabelText(/Show Pot Odds/i) as HTMLInputElement;
    
    expect(checkbox.checked).toBe(true);
    
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
    
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
  });

  it('should persist pot odds setting to localStorage', async () => {
    render(<GameSettings {...defaultProps} />);
    const checkbox = screen.getByLabelText(/Show Pot Odds/i) as HTMLInputElement;
    
    fireEvent.click(checkbox);
    
    await waitFor(() => {
      const saved = localStorage.getItem(`game_settings_${defaultProps.gameId}`);
      expect(saved).toBeTruthy();
      const parsed = JSON.parse(saved!);
      expect(parsed.showPotOdds).toBe(false);
    });
  });

  it('should load pot odds setting from localStorage', () => {
    const savedSettings = {
      showPotOdds: false,
      soundEnabled: true,
      chatEnabled: true,
    };
    localStorage.setItem(
      `game_settings_${defaultProps.gameId}`,
      JSON.stringify(savedSettings)
    );
    
    render(<GameSettings {...defaultProps} />);
    const checkbox = screen.getByLabelText(/Show Pot Odds/i) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it('should call onSettingsChange callback with pot odds setting', async () => {
    const mockCallback = jest.fn();
    render(<GameSettings {...defaultProps} onSettingsChange={mockCallback} />);
    
    const checkbox = screen.getByLabelText(/Show Pot Odds/i) as HTMLInputElement;
    fireEvent.click(checkbox);
    
    await waitFor(() => {
      expect(mockCallback).toHaveBeenCalled();
      const lastCall = mockCallback.mock.calls[mockCallback.mock.calls.length - 1][0];
      expect(lastCall.showPotOdds).toBe(false);
    });
  });

  it('should display pot odds description', () => {
    render(<GameSettings {...defaultProps} />);
    expect(
      screen.getByText(/Display the ratio between the pot size and the bet you are facing/i)
    ).toBeInTheDocument();
  });
});
