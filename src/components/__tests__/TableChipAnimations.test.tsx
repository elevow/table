import React from 'react';
import { act, render } from '@testing-library/react';
import TableChipAnimations from '../TableChipAnimations';

const anchors = [
  { playerId: 'a', left: '10%', top: '20%' },
  { playerId: 'b', left: '90%', top: '20%' },
];
const s1 = { handId: 'h1', handActions: [{ playerId: 'a', put: 1 }, { playerId: 'b', put: 2 }] };
const s2 = { ...s1, handActions: [...s1.handActions, { playerId: 'a', put: 4 }] };

const setReducedMotion = (reduce: boolean) => {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({ matches: reduce && query.includes('reduce') })) as any;
};

describe('TableChipAnimations', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('flies a chip from the seat to the pot, then removes it', () => {
    setReducedMotion(false);
    const { container, rerender } = render(<TableChipAnimations anchors={anchors} gameState={s1} />);
    expect(container.querySelector('.table-chip-fly')).toBeNull();
    rerender(<TableChipAnimations anchors={anchors} gameState={s2} />);
    const chip = container.querySelector('.table-chip-fly') as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.style.getPropertyValue('--chip-from-x')).toBe('10%');
    expect(chip.style.getPropertyValue('--chip-to-x')).toBe('50%');
    act(() => { jest.advanceTimersByTime(2000); });
    expect(container.querySelector('.table-chip-fly')).toBeNull();
  });

  it('shows nothing when reduced motion is requested', () => {
    setReducedMotion(true);
    const { container, rerender } = render(<TableChipAnimations anchors={anchors} gameState={s1} />);
    rerender(<TableChipAnimations anchors={anchors} gameState={s2} />);
    expect(container.querySelector('.table-chip-fly')).toBeNull();
  });
});
