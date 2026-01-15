import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock next/router
jest.mock('next/router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
}));

// Mock the tournament-utils module to avoid complex dependencies
jest.mock('../../../src/lib/tournament/tournament-utils', () => ({
  tournamentPresets: {
    freezeout_default: {
      name: 'Freezeout',
      description: 'Standard freezeout tournament',
      build: () => ({
        type: 'freezeout',
        startingStack: 10000,
        blindLevels: [{ sb: 25, bb: 50, durationMinutes: 15 }],
        lateRegistration: { enabled: false, endLevel: 0 },
      }),
    },
  },
}));

// Import the component after mocks
import CreateGameRoomPage from '../../../pages/game/create';

describe('CreateGameRoomPage', () => {
  beforeEach(() => {
    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn(() => 'test-token'),
        setItem: jest.fn(),
        removeItem: jest.fn(),
      },
      writable: true,
    });
  });

  it('should not display Table name field', () => {
    render(<CreateGameRoomPage />);
    
    // Verify that "Table name" label does not exist in the document
    const tableNameLabel = screen.queryByText('Table name');
    expect(tableNameLabel).toBeNull();
  });
});

describe('CreateGameRoomPage - Big Blind auto-update', () => {
  beforeEach(() => {
    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn(() => 'test-token'),
        setItem: jest.fn(),
        removeItem: jest.fn(),
      },
      writable: true,
    });
  });

  const getSmallBlindInput = () => {
    const labels = screen.getAllByText('Small blind');
    const label = labels[0];
    return label.parentElement?.querySelector('input') as HTMLInputElement;
  };

  const getBigBlindInput = () => {
    const labels = screen.getAllByText('Big blind');
    const label = labels[0];
    return label.parentElement?.querySelector('input') as HTMLInputElement;
  };

  it('should initialize with small blind 1 and big blind 2', () => {
    render(<CreateGameRoomPage />);
    
    const smallBlindInput = getSmallBlindInput();
    const bigBlindInput = getBigBlindInput();
    
    expect(smallBlindInput.value).toBe('1');
    expect(bigBlindInput.value).toBe('2');
  });

  it('should auto-update big blind to 2x small blind when small blind changes', () => {
    render(<CreateGameRoomPage />);
    
    const smallBlindInput = getSmallBlindInput();
    const bigBlindInput = getBigBlindInput();
    
    // Change small blind to 5
    fireEvent.change(smallBlindInput, { target: { value: '5' } });
    
    // Big blind should auto-update to 10 (5 * 2)
    expect(bigBlindInput.value).toBe('10');
  });

  it('should not auto-update big blind when it has been manually changed', () => {
    render(<CreateGameRoomPage />);
    
    const smallBlindInput = getSmallBlindInput();
    const bigBlindInput = getBigBlindInput();
    
    // Manually change big blind first
    fireEvent.change(bigBlindInput, { target: { value: '5' } });
    expect(bigBlindInput.value).toBe('5');
    
    // Now change small blind to 10
    fireEvent.change(smallBlindInput, { target: { value: '10' } });
    
    // Big blind should NOT auto-update because it was manually set
    expect(bigBlindInput.value).toBe('5');
  });

  it('should update big blind to 2x small blind for multiple changes when not manually updated', () => {
    render(<CreateGameRoomPage />);
    
    const smallBlindInput = getSmallBlindInput();
    const bigBlindInput = getBigBlindInput();
    
    // Change small blind to 3
    fireEvent.change(smallBlindInput, { target: { value: '3' } });
    expect(bigBlindInput.value).toBe('6');
    
    // Change small blind to 10
    fireEvent.change(smallBlindInput, { target: { value: '10' } });
    expect(bigBlindInput.value).toBe('20');
    
    // Change small blind to 0.5
    fireEvent.change(smallBlindInput, { target: { value: '0.5' } });
    expect(bigBlindInput.value).toBe('1');
  });

  it('should have a buy-in field with default value of 1000', () => {
    render(<CreateGameRoomPage />);
    
    // Find the Buy-In input by looking for the label text and then finding the input in the same container
    const buyInLabel = screen.getByText('Buy-In');
    const buyInContainer = buyInLabel.parentElement;
    const buyInInput = buyInContainer?.querySelector('input[type="number"]') as HTMLInputElement;
    
    expect(buyInInput).toBeTruthy();
    expect(buyInInput.value).toBe('1000');
  });

  it('should allow changing the buy-in value', () => {
    render(<CreateGameRoomPage />);
    
    const buyInLabel = screen.getByText('Buy-In');
    const buyInContainer = buyInLabel.parentElement;
    const buyInInput = buyInContainer?.querySelector('input[type="number"]') as HTMLInputElement;
    
    // Change buy-in to 2000
    fireEvent.change(buyInInput, { target: { value: '2000' } });
    expect(buyInInput.value).toBe('2000');
    
    // Change buy-in to 500
    fireEvent.change(buyInInput, { target: { value: '500' } });
    expect(buyInInput.value).toBe('500');
  });
});
