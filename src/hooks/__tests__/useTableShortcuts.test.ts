import { act, renderHook } from '@testing-library/react';
import { ALL_IN_CONFIRM_MS, useTableShortcuts } from '../useTableShortcuts';

const key = (k: string, target: EventTarget = document.body) => {
  const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  act(() => { target.dispatchEvent(event); });
  return event;
};

describe('useTableShortcuts', () => {
  let clicks: string[];

  beforeEach(() => {
    jest.useFakeTimers();
    clicks = [];
    document.body.innerHTML = `
      <input type="number" data-shortcut-amount="true" />
      <button data-shortcut-preset="1">Min</button>
      <button data-shortcut-preset="2">Half</button>
      <button data-shortcut-preset="allin">All-in</button>
      <button data-shortcut-nudge="up">+BB</button>
      <button data-shortcut-nudge="down">-BB</button>
      <button data-shortcut-submit="true">Bet</button>
      <textarea id="chat"></textarea>
    `;
    document.querySelectorAll('button').forEach(b => b.addEventListener('click', () => clicks.push(b.textContent || '')));
  });
  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = '';
  });

  const setup = (enabled = true) => {
    const onFold = jest.fn();
    const onCheckOrCall = jest.fn();
    const hook = renderHook(props => useTableShortcuts(props), { initialProps: { enabled, onFold, onCheckOrCall } });
    return { ...hook, onFold, onCheckOrCall };
  };

  it('folds and checks/calls on your turn', () => {
    const { onFold, onCheckOrCall } = setup();
    expect(key('f').defaultPrevented).toBe(true);
    key('c');
    expect(onFold).toHaveBeenCalledTimes(1);
    expect(onCheckOrCall).toHaveBeenCalledTimes(1);
  });

  it('ignores action keys when it is not your turn', () => {
    const { onFold } = setup(false);
    key('f');
    expect(onFold).not.toHaveBeenCalled();
  });

  it('ignores keys typed into chat', () => {
    const { onFold } = setup();
    key('f', document.getElementById('chat')!);
    expect(onFold).not.toHaveBeenCalled();
  });

  it('presses the preset, nudge and submit buttons', () => {
    setup();
    key('2');
    key('ArrowUp');
    key('ArrowDown');
    key('Enter');
    expect(clicks).toEqual(['Half', '+BB', '-BB', 'Bet']);
  });

  it('focuses the amount box, then Enter submits and Esc leaves it', () => {
    setup();
    key('r');
    const input = document.querySelector('input')!;
    expect(document.activeElement).toBe(input);
    key('1', input);
    expect(clicks).toEqual([]);
    key('Enter', input);
    expect(clicks).toEqual(['Bet']);
    key('Escape', input);
    expect(document.activeElement).not.toBe(input);
  });

  it('needs a second press of A to go all-in', () => {
    const { result } = setup();
    key('a');
    expect(clicks).toEqual(['All-in']);
    expect(result.current.allInArmed).toBe(true);
    key('a');
    act(() => { jest.runOnlyPendingTimers(); });
    expect(clicks).toEqual(['All-in', 'All-in', 'Bet']);
    expect(result.current.allInArmed).toBe(false);
  });

  it('forgets an armed all-in after a while, on Esc, or when the turn ends', () => {
    const { result, rerender, onFold, onCheckOrCall } = setup();
    key('a');
    act(() => { jest.advanceTimersByTime(ALL_IN_CONFIRM_MS + 1); });
    expect(result.current.allInArmed).toBe(false);

    key('a');
    key('Escape');
    expect(result.current.allInArmed).toBe(false);

    key('a');
    rerender({ enabled: false, onFold, onCheckOrCall });
    expect(result.current.allInArmed).toBe(false);
  });

  it('toggles the help with ? at any time', () => {
    const { result } = setup(false);
    key('?');
    expect(result.current.helpOpen).toBe(true);
    key('Escape');
    expect(result.current.helpOpen).toBe(false);
  });

  it('does not swallow Esc when there is nothing to clear', () => {
    setup();
    expect(key('Escape').defaultPrevented).toBe(false);
  });
});
