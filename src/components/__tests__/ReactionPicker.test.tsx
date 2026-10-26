import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ReactionPicker from '../ReactionPicker';
import { TABLE_REACTIONS } from '../../lib/shared/reactions';

describe('ReactionPicker', () => {
  it('shows the reaction buttons and a button to hide them', () => {
    const onToggleMuted = jest.fn();
    render(<ReactionPicker onReact={jest.fn()} coolingDown={false} muted={false} onToggleMuted={onToggleMuted} />);
    expect(screen.getAllByRole('button', { name: /React with/ })).toHaveLength(TABLE_REACTIONS.length);
    fireEvent.click(screen.getByRole('button', { name: 'Hide reactions' }));
    expect(onToggleMuted).toHaveBeenCalledWith(true);
  });

  it('hides every reaction button when reactions are hidden, leaving only a way back', () => {
    const onToggleMuted = jest.fn();
    render(<ReactionPicker onReact={jest.fn()} coolingDown={false} muted onToggleMuted={onToggleMuted} />);
    expect(screen.queryAllByRole('button', { name: /React with/ })).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Show reactions' }));
    expect(onToggleMuted).toHaveBeenCalledWith(false);
  });
});
