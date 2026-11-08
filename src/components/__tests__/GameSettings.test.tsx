import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import GameSettings from '../GameSettings';
import { DEFAULT_DISPLAY_SETTINGS } from '../../lib/shared/display-settings';

describe('GameSettings', () => {
  test('offers only the settings the table uses, showing the current values', () => {
    render(<GameSettings settings={{ ...DEFAULT_DISPLAY_SETTINGS, showStackInBB: true }} onChange={jest.fn()} />);
    expect(screen.getAllByRole('checkbox').map(c => c.parentElement?.textContent?.trim())).toEqual([
      'High Contrast Cards', 'Show Pot Odds', 'Show Stack in Big Blinds', 'Show Hand Value',
    ]);
    expect(screen.getByLabelText('Show Hand Value')).toBeChecked();
    expect(screen.getByLabelText('High Contrast Cards')).not.toBeChecked();
    expect(screen.getByLabelText('Show Pot Odds')).toBeChecked();
    expect(screen.getByLabelText('Show Stack in Big Blinds')).toBeChecked();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(screen.getByText(/These are your profile settings/)).toBeInTheDocument();
  });

  test('reports each change', () => {
    const onChange = jest.fn();
    render(<GameSettings settings={DEFAULT_DISPLAY_SETTINGS} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Show Pot Odds'));
    expect(onChange).toHaveBeenCalledWith('showPotOdds', false);
    fireEvent.click(screen.getByLabelText('High Contrast Cards'));
    expect(onChange).toHaveBeenCalledWith('highContrastCards', true);
  });

  test('a table with its own changes can go back to the profile settings', () => {
    const onReset = jest.fn();
    render(<GameSettings settings={DEFAULT_DISPLAY_SETTINGS} onChange={jest.fn()} hasOverrides onReset={onReset} />);
    expect(screen.getByText(/Changed for this table only/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use my profile settings' }));
    expect(onReset).toHaveBeenCalled();
  });
});
