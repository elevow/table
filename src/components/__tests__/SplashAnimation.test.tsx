import { act, render, screen } from '@testing-library/react';
import SplashAnimation from '../SplashAnimation';

describe('SplashAnimation', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('announces a fresh splash with chips, then clears', () => {
    const { container } = render(<SplashAnimation splash={{ playerId: 'a', amount: 40, at: Date.now() }} playerName="Alice" />);
    expect(screen.getByText('Alice splashes the pot! $40')).toBeTruthy();
    expect(container.querySelectorAll('.splash-chip').length).toBeGreaterThan(10);
    act(() => { jest.advanceTimersByTime(3_000); });
    expect(screen.queryByText(/splashes the pot/)).toBeNull();
  });

  it('does not replay an old splash, e.g. when the page reloads later in the session', () => {
    render(<SplashAnimation splash={{ playerId: 'a', amount: 40, at: Date.now() - 60_000 }} playerName="Alice" />);
    expect(screen.queryByText(/splashes the pot/)).toBeNull();
  });

  it('plays each splash once, however often the state arrives again', () => {
    const splash = { playerId: 'a', amount: 40, at: Date.now() };
    const { rerender } = render(<SplashAnimation splash={splash} playerName="Alice" />);
    act(() => { jest.advanceTimersByTime(3_000); });
    rerender(<SplashAnimation splash={{ ...splash }} playerName="Alice" />);
    expect(screen.queryByText(/splashes the pot/)).toBeNull();
  });
});
