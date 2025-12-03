/**
 * GameSettings Component Tests
 *
 * Tests for the game settings component including admin-only
 * time between rounds setting functionality.
 */

// Mock fetch globally
global.fetch = jest.fn();

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import GameSettings from '../GameSettings';

describe('GameSettings', () => {
  const defaultProps = {
    gameId: 'test-game-123',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    (global.fetch as jest.Mock).mockReset();
  });

  it('should render basic settings for non-admin users', () => {
    render(<GameSettings {...defaultProps} />);

    expect(screen.getByText('Game Settings')).toBeInTheDocument();
    expect(screen.getByText('Audio Settings')).toBeInTheDocument();
    expect(screen.getByText('Chat Settings')).toBeInTheDocument();
    expect(screen.getByText('Gameplay Settings')).toBeInTheDocument();
    
    // Should NOT show admin settings
    expect(screen.queryByText('Admin Settings')).not.toBeInTheDocument();
    expect(screen.queryByText('Time between rounds (seconds):')).not.toBeInTheDocument();
  });

  it('should render admin settings when isAdmin is true', async () => {
    // Mock the room config fetch
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        configuration: {
          timeBetweenRounds: 10,
        },
      }),
    });

    render(<GameSettings {...defaultProps} isAdmin={true} />);

    // Wait for admin settings to appear
    await waitFor(() => {
      expect(screen.getByText('Admin Settings')).toBeInTheDocument();
    });

    expect(screen.getByText('Time between rounds (seconds):')).toBeInTheDocument();
    expect(screen.getByText('Save Admin Setting')).toBeInTheDocument();
  });

  it('should fetch and display configured timeBetweenRounds for admin', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        configuration: {
          timeBetweenRounds: 15,
        },
      }),
    });

    render(<GameSettings {...defaultProps} isAdmin={true} />);

    await waitFor(() => {
      // The slider should show the value 15
      expect(screen.getByText('15')).toBeInTheDocument();
    });
  });

  it('should update timeBetweenRounds when slider is changed', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        configuration: {
          timeBetweenRounds: 5,
        },
      }),
    });

    render(<GameSettings {...defaultProps} isAdmin={true} />);

    await waitFor(() => {
      expect(screen.getByText('Admin Settings')).toBeInTheDocument();
    });

    const slider = screen.getAllByRole('slider').find(el => 
      el.getAttribute('min') === '1' && el.getAttribute('max') === '60'
    );
    
    expect(slider).toBeInTheDocument();
    
    fireEvent.change(slider!, { target: { value: '20' } });
    
    await waitFor(() => {
      expect(screen.getByText('20')).toBeInTheDocument();
    });
  });

  it('should call API to save timeBetweenRounds when save button is clicked', async () => {
    // Mock initial fetch for room config
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        configuration: {
          timeBetweenRounds: 5,
        },
      }),
    });

    render(<GameSettings {...defaultProps} isAdmin={true} />);

    await waitFor(() => {
      expect(screen.getByText('Admin Settings')).toBeInTheDocument();
    });

    // Mock the update call
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        configuration: { timeBetweenRounds: 5 },
      }),
    });

    const saveButton = screen.getByText('Save Admin Setting');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/games/rooms/update-config',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            roomId: 'test-game-123',
            timeBetweenRounds: 5,
          }),
        })
      );
    });
  });

  it('should show success message after saving', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ configuration: { timeBetweenRounds: 5 } }),
    });

    render(<GameSettings {...defaultProps} isAdmin={true} />);

    await waitFor(() => {
      expect(screen.getByText('Save Admin Setting')).toBeInTheDocument();
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    fireEvent.click(screen.getByText('Save Admin Setting'));

    await waitFor(() => {
      expect(screen.getByText('✓ Saved successfully')).toBeInTheDocument();
    });
  });

  it('should show error message when save fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ configuration: { timeBetweenRounds: 5 } }),
    });

    render(<GameSettings {...defaultProps} isAdmin={true} />);

    await waitFor(() => {
      expect(screen.getByText('Save Admin Setting')).toBeInTheDocument();
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Unauthorized' }),
    });

    fireEvent.click(screen.getByText('Save Admin Setting'));

    await waitFor(() => {
      expect(screen.getByText('Unauthorized')).toBeInTheDocument();
    });
  });

  it('should not show admin settings for regular players', () => {
    render(<GameSettings {...defaultProps} isAdmin={false} />);

    expect(screen.queryByText('Admin Settings')).not.toBeInTheDocument();
    expect(screen.queryByText('Time between rounds (seconds):')).not.toBeInTheDocument();
  });

  it('should call onSettingsChange when settings change', () => {
    const onSettingsChange = jest.fn();
    render(<GameSettings {...defaultProps} onSettingsChange={onSettingsChange} />);

    // Change a setting
    const soundCheckbox = screen.getByLabelText(/Enable Sound Effects/i);
    fireEvent.click(soundCheckbox);

    expect(onSettingsChange).toHaveBeenCalled();
  });

  it('should persist settings to localStorage', async () => {
    render(<GameSettings {...defaultProps} />);

    const soundCheckbox = screen.getByLabelText(/Enable Sound Effects/i);
    fireEvent.click(soundCheckbox);

    await waitFor(() => {
      const saved = localStorage.getItem('game_settings_test-game-123');
      expect(saved).toBeTruthy();
      const parsed = JSON.parse(saved!);
      expect(parsed.soundEnabled).toBe(false);
    });
  });
});
