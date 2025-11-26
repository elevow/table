/**
 * CombinedTimerStats Component Tests
 *
 * Tests for the combined timer and session statistics component,
 * with Supabase-only transport support.
 */

// Mock Supabase before any imports to prevent ESM parsing issues
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    channel: jest.fn(() => ({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
    })),
  })),
}));

// Mock the Supabase client module
jest.mock('../../lib/realtime/supabaseClient', () => ({
  getSupabaseBrowser: jest.fn(() => null),
}));

// Mock transport module - Supabase is now the only supported transport
jest.mock('../../utils/transport', () => ({
  getTransportMode: jest.fn(() => 'supabase'),
}));

import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import CombinedTimerStats from '../CombinedTimerStats';

describe('CombinedTimerStats', () => {
  const defaultProps = {
    tableId: 'test-table-123',
    playerId: 'player-1',
    gameId: 'game-123',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should render session statistics after loading', async () => {
    render(<CombinedTimerStats {...defaultProps} />);

    // Wait for stats to load
    await act(async () => {
      jest.advanceTimersByTime(100);
    });

    await waitFor(() => {
      expect(screen.getByText('Session Statistics')).toBeInTheDocument();
    });
  });

  it('should display initial statistics with zero values', async () => {
    render(<CombinedTimerStats {...defaultProps} />);

    await act(async () => {
      jest.advanceTimersByTime(100);
    });

    await waitFor(() => {
      expect(screen.getByText('Hands')).toBeInTheDocument();
      expect(screen.getByText('Win Rate')).toBeInTheDocument();
      expect(screen.getByText('Net')).toBeInTheDocument();
      expect(screen.getByText('Biggest Pot Won')).toBeInTheDocument();
    });
  });

  it('should load saved stats from localStorage', async () => {
    // Pre-populate localStorage with session stats
    const existingStats = {
      handsPlayed: 10,
      handsWon: 4,
      totalWinnings: 50,
      totalLosses: 30,
      biggestPotWon: 25,
      foldRate: 30,
      sessionStartTime: new Date().toISOString(),
      timeInSession: '15m',
    };
    localStorage.setItem(`session_stats_${defaultProps.gameId}`, JSON.stringify(existingStats));

    render(<CombinedTimerStats {...defaultProps} />);

    await act(async () => {
      jest.advanceTimersByTime(100);
    });

    await waitFor(() => {
      expect(screen.getByText('10')).toBeInTheDocument(); // handsPlayed
      expect(screen.getByText('40%')).toBeInTheDocument(); // win rate (4/10 = 40%)
    });
  });

  it('should call onShowSettings when settings button is clicked', async () => {
    const onShowSettings = jest.fn();

    render(<CombinedTimerStats {...defaultProps} onShowSettings={onShowSettings} />);

    await act(async () => {
      jest.advanceTimersByTime(100);
    });

    await waitFor(() => {
      expect(screen.getByText('Show Settings')).toBeInTheDocument();
    });

    const settingsButton = screen.getByText('Show Settings');
    settingsButton.click();

    expect(onShowSettings).toHaveBeenCalledTimes(1);
  });
});
