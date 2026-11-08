import { renderHook } from '@testing-library/react';
import { useRevealWhen } from '../useRevealWhen';

function setup() {
  const scrollIntoView = jest.fn();
  const view = renderHook(({ active }) => useRevealWhen<HTMLDivElement>(active), { initialProps: { active: false } });
  (view.result.current as { current: unknown }).current = { scrollIntoView };
  return { ...view, scrollIntoView };
}

describe('useRevealWhen', () => {
  it('scrolls when it turns on', () => {
    const { rerender, scrollIntoView } = setup();
    expect(scrollIntoView).not.toHaveBeenCalled();
    rerender({ active: true });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('does not pull the page back on later renders', () => {
    const { rerender, scrollIntoView } = setup();
    rerender({ active: true });
    rerender({ active: true });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('scrolls again the next time it turns on', () => {
    const { rerender, scrollIntoView } = setup();
    rerender({ active: true });
    rerender({ active: false });
    rerender({ active: true });
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });
});
