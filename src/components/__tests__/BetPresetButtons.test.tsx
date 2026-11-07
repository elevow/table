import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import BetPresetButtons from '../BetPresetButtons';

const props = { kind: 'bet' as const, pot: 30, currentBet: 0, myBet: 0, min: 2, max: 100, bigBlind: 2, value: 2 };

describe('BetPresetButtons last bet', () => {
  it('offers no last bet until the player has made one', () => {
    render(<BetPresetButtons {...props} onChange={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'Last' })).toBeNull();
  });

  it('picks the last bet', () => {
    const onChange = jest.fn();
    render(<BetPresetButtons {...props} lastBet={6} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Last' }));
    expect(onChange).toHaveBeenCalledWith(6);
  });

  it('keeps the last bet within the legal amounts', () => {
    const onChange = jest.fn();
    render(<BetPresetButtons {...props} max={4} lastBet={6} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Last' }));
    expect(onChange).toHaveBeenCalledWith(4);
  });
});
