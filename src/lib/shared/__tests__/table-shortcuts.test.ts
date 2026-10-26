import { classifyShortcutTarget, resolveShortcut, type ShortcutTarget } from '../table-shortcuts';

const press = (key: string, target: ShortcutTarget = 'other', isMyTurn = true, mods: Record<string, boolean> = {}) =>
  resolveShortcut({ key, ...mods }, { isMyTurn, target });

describe('resolveShortcut', () => {
  it('maps the action keys on your turn', () => {
    expect(press('f')).toEqual({ type: 'fold' });
    expect(press('c')).toEqual({ type: 'check-or-call' });
    expect(press('r')).toEqual({ type: 'focus-amount' });
    expect(press('b')).toEqual({ type: 'focus-amount' });
    expect(press('a')).toEqual({ type: 'all-in' });
    expect(press('1')).toEqual({ type: 'preset', key: '1' });
    expect(press('4')).toEqual({ type: 'preset', key: '4' });
    expect(press('Enter')).toEqual({ type: 'submit' });
    expect(press('ArrowUp')).toEqual({ type: 'nudge', direction: 1 });
    expect(press('ArrowDown')).toEqual({ type: 'nudge', direction: -1 });
  });

  it('ignores letter case (caps lock)', () => {
    expect(press('F')).toEqual({ type: 'fold' });
  });

  it('ignores unmapped keys', () => {
    expect(press('5')).toBeNull();
    expect(press('x')).toBeNull();
    expect(press('Tab')).toBeNull();
  });

  it('does nothing for actions when it is not your turn', () => {
    expect(press('f', 'other', false)).toBeNull();
    expect(press('c', 'other', false)).toBeNull();
    expect(press('Enter', 'other', false)).toBeNull();
  });

  it('opens help and clears at any time', () => {
    expect(press('?', 'other', false)).toEqual({ type: 'help' });
    expect(press('Escape', 'other', false)).toEqual({ type: 'clear' });
  });

  it('stays out of the way while typing in chat or notes', () => {
    for (const key of ['f', 'c', 'a', '1', '?', 'Escape', 'Enter']) {
      expect(press(key, 'typing')).toBeNull();
    }
  });

  it('leaves browser shortcuts alone', () => {
    expect(press('c', 'other', true, { ctrlKey: true })).toBeNull();
    expect(press('r', 'other', true, { metaKey: true })).toBeNull();
    expect(press('f', 'other', true, { altKey: true })).toBeNull();
  });

  it('only handles submit, clear and nudges inside the amount box', () => {
    expect(press('Enter', 'amount')).toEqual({ type: 'submit' });
    expect(press('Escape', 'amount')).toEqual({ type: 'clear' });
    expect(press('ArrowUp', 'amount')).toEqual({ type: 'nudge', direction: 1 });
    expect(press('ArrowDown', 'amount')).toEqual({ type: 'nudge', direction: -1 });
    expect(press('1', 'amount')).toBeNull();
    expect(press('f', 'amount')).toBeNull();
    expect(press('Enter', 'amount', false)).toBeNull();
    expect(press('Escape', 'amount', false)).toEqual({ type: 'clear' });
  });

  it('lets a focused button or slider keep Enter and the arrows', () => {
    expect(press('Enter', 'control')).toBeNull();
    expect(press('ArrowUp', 'control')).toBeNull();
    expect(press('f', 'control')).toEqual({ type: 'fold' });
  });
});

describe('classifyShortcutTarget', () => {
  const make = (html: string) => {
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
    return wrap.firstElementChild as HTMLElement;
  };
  afterEach(() => { document.body.innerHTML = ''; });

  it('treats text fields, selects and editable areas as typing', () => {
    expect(classifyShortcutTarget(make('<input type="text" />'))).toBe('typing');
    expect(classifyShortcutTarget(make('<input />'))).toBe('typing');
    expect(classifyShortcutTarget(make('<textarea></textarea>'))).toBe('typing');
    expect(classifyShortcutTarget(make('<select><option>a</option></select>'))).toBe('typing');
    const editable = make('<div contenteditable="true"><span>x</span></div>');
    expect(classifyShortcutTarget(editable.querySelector('span'))).toBe('typing');
  });

  it('recognises the amount box', () => {
    expect(classifyShortcutTarget(make('<input type="number" data-shortcut-amount="true" />'))).toBe('amount');
  });

  it('treats buttons, links and sliders as controls', () => {
    expect(classifyShortcutTarget(make('<button>Fold</button>'))).toBe('control');
    expect(classifyShortcutTarget(make('<a href="/x">x</a>'))).toBe('control');
    expect(classifyShortcutTarget(make('<input type="range" />'))).toBe('control');
    expect(classifyShortcutTarget(make('<input type="checkbox" />'))).toBe('control');
  });

  it('treats everything else as the page', () => {
    expect(classifyShortcutTarget(null)).toBe('other');
    expect(classifyShortcutTarget(document.body)).toBe('other');
    expect(classifyShortcutTarget(make('<div>felt</div>'))).toBe('other');
  });
});
