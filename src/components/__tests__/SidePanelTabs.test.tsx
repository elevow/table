import { fireEvent, render, screen } from '@testing-library/react';
import SidePanelTabs from '../SidePanelTabs';

const tabs = [
  { id: 'stats', label: 'Stats', content: <p>stats body</p> },
  { id: 'session', label: 'Session', content: <p>session body</p> },
  { id: 'notes', label: 'Notes', content: <p>notes body</p> },
];

// Whether the panel holding this text is the one showing
const shown = (text: string) => !screen.getByText(text).closest('[role="tabpanel"]')!.hasAttribute('hidden');

describe('SidePanelTabs', () => {
  beforeEach(() => window.localStorage.clear());

  it('shows the first tab, keeping the others mounted but hidden', () => {
    render(<SidePanelTabs tabs={tabs} />);
    expect(screen.getByRole('tab', { name: 'Stats' }).getAttribute('aria-selected')).toBe('true');
    expect(shown('stats body')).toBe(true);
    expect(shown('session body')).toBe(false);
  });

  it('switches tabs by click and arrow keys, and remembers the choice', () => {
    const { unmount } = render(<SidePanelTabs tabs={tabs} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Session' }));
    expect(shown('session body')).toBe(true);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Session' }), { key: 'ArrowRight' });
    expect(shown('notes body')).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Notes' }));
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Notes' }), { key: 'ArrowRight' });
    expect(shown('stats body')).toBe(true);
    unmount();

    window.localStorage.setItem('table-side-panel-tab', 'notes');
    render(<SidePanelTabs tabs={tabs} />);
    expect(shown('notes body')).toBe(true);
  });

  it('falls back to the first tab when the remembered one is not offered', () => {
    window.localStorage.setItem('table-side-panel-tab', 'hand');
    render(<SidePanelTabs tabs={tabs} />);
    expect(shown('stats body')).toBe(true);
  });

  it('reports the tab showing, including the remembered one', () => {
    window.localStorage.setItem('table-side-panel-tab', 'notes');
    const onActiveChange = jest.fn();
    render(<SidePanelTabs tabs={tabs} onActiveChange={onActiveChange} />);
    expect(onActiveChange).toHaveBeenLastCalledWith('notes');
    fireEvent.click(screen.getByRole('tab', { name: 'Stats' }));
    expect(onActiveChange).toHaveBeenLastCalledWith('stats');
  });

  it('shows a count on a tab, but not a zero', () => {
    const { rerender } = render(<SidePanelTabs tabs={[...tabs, { id: 'chat', label: 'Chat', content: <p>chat body</p>, badge: 3 }]} />);
    expect(screen.getByRole('tab', { name: 'Chat 3 unread' })).toBeTruthy();
    rerender(<SidePanelTabs tabs={[...tabs, { id: 'chat', label: 'Chat', content: <p>chat body</p>, badge: 0 }]} />);
    expect(screen.getByRole('tab', { name: 'Chat' })).toBeTruthy();
  });

  it('marks a tab with something new until it is opened', () => {
    render(<SidePanelTabs tabs={[...tabs, { id: 'chat', label: 'Chat', content: <p>chat body</p>, badge: 2 }]} />);
    const chat = screen.getByRole('tab', { name: 'Chat 2 unread' });
    expect(chat.hasAttribute('data-unread')).toBe(true);
    expect(chat.className).toContain('font-bold');
    fireEvent.click(chat);
    expect(chat.hasAttribute('data-unread')).toBe(false);
    expect(chat.className).not.toContain('font-bold');
  });
});
