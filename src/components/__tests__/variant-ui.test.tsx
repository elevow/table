import React from 'react';
import { render, screen } from '@testing-library/react';
import VariantControls from '../VariantControls';
import VariantHelpPanel from '../VariantHelpPanel';
import type { GameStage } from '../../types/poker';

const stage: GameStage = 'river' as GameStage;

describe('Variant-specific UI (US-056)', () => {
  test('renders declaration controls for stud hi-lo when declarations enabled', () => {
    render(<VariantControls variant={'seven-card-stud-hi-lo'} stage={stage} declarationsEnabled onAction={() => {}} />);
    expect(screen.getByRole('button', { name: /High/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Low/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Both/i })).toBeTruthy();
  });

  test('hides declaration controls for stud hi-lo when declarations disabled', () => {
    render(<VariantControls variant={'seven-card-stud-hi-lo'} stage={stage} declarationsEnabled={false} />);
    expect(screen.queryByRole('button', { name: /High/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Low/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Both/i })).toBeNull();
  });

  test('help panel shows variant-specific info', () => {
    render(<VariantHelpPanel variant={'seven-card-stud-hi-lo'} />);
    expect(screen.getByRole('heading', { level: 3, name: /Seven‑Card Stud Hi‑Lo/i })).toBeTruthy();
    expect(screen.getByText(/High and qualifying low/i)).toBeTruthy();
  });
});
