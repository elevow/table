import { act, render, screen } from '@testing-library/react';
import SplashAnimation, { splashInPlay } from '../SplashAnimation';

const chipsIn = (container: HTMLElement) => container.querySelectorAll('.splash-chip');

describe('SplashAnimation', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('announces a fresh splash, then leaves its chips on the table', () => {
    const { container } = render(<SplashAnimation splash={{ playerId: 'a', amount: 40, at: Date.now(), ageMs: 0 }} playerName="Alice" />);
    expect(screen.getByText('Alice splashes the pot! $40')).toBeTruthy();
    expect(chipsIn(container).length).toBeGreaterThan(10);
    expect(container.querySelector('.splash-falling')).toBeTruthy();
    act(() => { jest.advanceTimersByTime(3_000); });
    expect(screen.queryByText(/splashes the pot/)).toBeNull();
    expect(chipsIn(container).length).toBeGreaterThan(10);
  });

  it("judges freshness by the server's age, not this browser's clock", () => {
    // This browser's clock is a minute ahead of the server's
    render(<SplashAnimation splash={{ playerId: 'a', amount: 40, at: Date.now() - 60_000, ageMs: 500 }} playerName="Alice" />);
    expect(screen.getByText('Alice splashes the pot! $40')).toBeTruthy();
  });

  it('shows the chips already landed, without the announcement, for an older splash in this hand', () => {
    const { container } = render(<SplashAnimation splash={{ playerId: 'a', amount: 40, at: Date.now() - 60_000, ageMs: 60_000 }} playerName="Alice" />);
    expect(screen.queryByText(/splashes the pot/)).toBeNull();
    expect(chipsIn(container).length).toBeGreaterThan(10);
    expect(container.querySelector('.splash-falling')).toBeNull();
  });

  it('plays each splash once, however often the state arrives again, and clears the chips when it goes', () => {
    const splash = { playerId: 'a', amount: 40, at: Date.now(), ageMs: 0 };
    const { container, rerender } = render(<SplashAnimation splash={splash} playerName="Alice" />);
    act(() => { jest.advanceTimersByTime(3_000); });
    rerender(<SplashAnimation splash={{ ...splash, ageMs: 3_000 }} playerName="Alice" />);
    expect(screen.queryByText(/splashes the pot/)).toBeNull();
    rerender(<SplashAnimation splash={null} playerName="Alice" />);
    expect(chipsIn(container).length).toBe(0);
  });
});

describe('splashInPlay', () => {
  const splash = { playerId: 'a', amount: 40, at: 5_000 };

  it('keeps a splash from this hand while the hand is being played', () => {
    expect(splashInPlay({ lastSplash: splash, handStartedAt: 4_000, stage: 'turn' })).toBe(splash);
  });

  it('clears it once the hand is over', () => {
    expect(splashInPlay({ lastSplash: splash, handStartedAt: 4_000, stage: 'showdown' })).toBeNull();
  });

  it('ignores a splash from an earlier hand', () => {
    expect(splashInPlay({ lastSplash: splash, handStartedAt: 6_000, stage: 'preflop' })).toBeNull();
    expect(splashInPlay(null)).toBeNull();
  });
});
