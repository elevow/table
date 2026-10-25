import { act, renderHook } from '@testing-library/react';
import { LOW_TIME_WARNING_MS } from '../../lib/shared/turn-clock';
import { useTurnAlerts } from '../useTurnAlerts';

const makeAudio = () => {
  const oscillators: any[] = [];
  const ctx: any = {
    state: 'suspended',
    currentTime: 0,
    destination: {},
    resume: jest.fn().mockResolvedValue(undefined),
    createOscillator: jest.fn(() => {
      const osc = { type: '', frequency: { value: 0 }, connect: jest.fn((g: any) => g), start: jest.fn(), stop: jest.fn() };
      oscillators.push(osc);
      return osc;
    }),
    createGain: jest.fn(() => ({
      gain: { setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() },
      connect: jest.fn(),
    })),
  };
  return { ctx, oscillators };
};

describe('useTurnAlerts', () => {
  // The hook keeps one AudioContext for the page, so every test shares this one
  const audio = makeAudio();
  let NotificationMock: jest.Mock & { permission?: string; requestPermission?: jest.Mock };

  const tones = () => audio.oscillators.map(o => o.frequency.value);

  beforeEach(() => {
    localStorage.clear();
    audio.oscillators.length = 0;
    (window as any).AudioContext = jest.fn(() => audio.ctx);
    NotificationMock = Object.assign(jest.fn(function (this: any) { this.close = jest.fn(); }), {
      permission: 'default',
      requestPermission: jest.fn().mockResolvedValue('granted'),
    });
    (window as any).Notification = NotificationMock;
  });

  afterEach(() => {
    delete (window as any).AudioContext;
    delete (window as any).webkitAudioContext;
    delete (window as any).Notification;
    jest.restoreAllMocks();
  });

  it('starts with sound on and notifications off until permitted', () => {
    const { result } = renderHook(() => useTurnAlerts(false, null, null));
    expect(result.current.soundEnabled).toBe(true);
    expect(result.current.notifyEnabled).toBe(false);
    expect(result.current.notifyPermission).toBe('default');
  });

  it('restores saved settings when notifications are granted', () => {
    localStorage.setItem('table_turnSound', 'false');
    NotificationMock.permission = 'granted';
    const { result } = renderHook(() => useTurnAlerts(false, null, null));
    expect(result.current.soundEnabled).toBe(false);
    expect(result.current.notifyEnabled).toBe(true);
    expect(result.current.notifyPermission).toBe('granted');
  });

  it('reports notifications as unsupported when the browser has none', () => {
    delete (window as any).Notification;
    const { result } = renderHook(() => useTurnAlerts(false, null, null));
    expect(result.current.notifyPermission).toBe('unsupported');
    act(() => result.current.setNotifyEnabled(true));
    expect(result.current.notifyEnabled).toBe(false);
  });

  it('falls back to defaults when storage is unavailable', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const { result } = renderHook(() => useTurnAlerts(false, null, null));
    expect(result.current.soundEnabled).toBe(true);
    act(() => result.current.setSoundEnabled(false));
    expect(result.current.soundEnabled).toBe(false);
  });

  it('saves the sound setting and plays a test tone when turned on', () => {
    const { result } = renderHook(() => useTurnAlerts(false, null, null));
    act(() => result.current.setSoundEnabled(false));
    expect(localStorage.getItem('table_turnSound')).toBe('false');
    expect(tones()).toEqual([]);
    act(() => result.current.setSoundEnabled(true));
    expect(localStorage.getItem('table_turnSound')).toBe('true');
    expect(tones()).toEqual([660]);
    expect(audio.ctx.resume).toHaveBeenCalled();
  });

  it('asks for notification permission and saves the answer', async () => {
    const { result } = renderHook(() => useTurnAlerts(false, null, null));
    await act(async () => { result.current.setNotifyEnabled(true); });
    expect(result.current.notifyEnabled).toBe(true);
    expect(result.current.notifyPermission).toBe('granted');
    expect(localStorage.getItem('table_turnNotify')).toBe('true');

    act(() => result.current.setNotifyEnabled(false));
    expect(result.current.notifyEnabled).toBe(false);
    expect(localStorage.getItem('table_turnNotify')).toBe('false');

    NotificationMock.requestPermission!.mockResolvedValueOnce('denied');
    await act(async () => { result.current.setNotifyEnabled(true); });
    expect(result.current.notifyEnabled).toBe(false);
    expect(result.current.notifyPermission).toBe('denied');

    NotificationMock.requestPermission!.mockRejectedValueOnce(new Error('nope'));
    await act(async () => { result.current.setNotifyEnabled(true); });
    expect(result.current.notifyEnabled).toBe(false);
  });

  it('chimes once when the turn starts', () => {
    let myTurn = false;
    const { rerender } = renderHook(() => useTurnAlerts(myTurn, null, 'k1'));
    expect(tones()).toEqual([]);
    myTurn = true;
    rerender();
    expect(tones()).toEqual([523, 784]);
    rerender();
    expect(tones()).toEqual([523, 784]);
  });

  it('notifies when the tab is hidden, and focuses the table on click', () => {
    NotificationMock.permission = 'granted';
    jest.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const focus = jest.spyOn(window, 'focus').mockImplementation(() => {});
    let myTurn = false;
    const { rerender } = renderHook(() => useTurnAlerts(myTurn, null, 'k1'));
    myTurn = true;
    rerender();
    expect(NotificationMock).toHaveBeenCalledWith("It's your turn", expect.objectContaining({ tag: 'table-turn' }));
    const n = NotificationMock.mock.instances[0] as any;
    n.onclick();
    expect(focus).toHaveBeenCalled();
    expect(n.close).toHaveBeenCalled();
  });

  it('survives browsers that refuse page notifications', () => {
    NotificationMock.permission = 'granted';
    NotificationMock.mockImplementation(() => { throw new Error('service worker only'); });
    jest.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    let myTurn = false;
    const { rerender } = renderHook(() => useTurnAlerts(myTurn, null, 'k1'));
    myTurn = true;
    expect(() => rerender()).not.toThrow();
  });

  it('warns once per turn when time runs low', () => {
    localStorage.setItem('table_turnSound', 'false');
    let remaining: number | null = LOW_TIME_WARNING_MS + 1000;
    let key = 'k1';
    const { result, rerender } = renderHook(() => useTurnAlerts(true, remaining, key));
    act(() => result.current.setSoundEnabled(true));
    audio.oscillators.length = 0;

    rerender();
    expect(tones()).toEqual([]);
    remaining = LOW_TIME_WARNING_MS - 1000;
    rerender();
    expect(tones()).toEqual([880, 880, 880]);
    remaining = LOW_TIME_WARNING_MS - 2000;
    rerender();
    expect(tones()).toHaveLength(3);
    remaining = 0;
    key = 'k2';
    rerender();
    expect(tones()).toHaveLength(3);
    remaining = 1000;
    rerender();
    expect(tones()).toHaveLength(6);
  });

  it('stays quiet without audio support or when audio fails', () => {
    delete (window as any).AudioContext;
    const { result } = renderHook(() => useTurnAlerts(false, null, null));
    expect(() => act(() => result.current.setSoundEnabled(true))).not.toThrow();

    (window as any).AudioContext = jest.fn(() => audio.ctx);
    audio.ctx.createOscillator.mockImplementationOnce(() => { throw new Error('no audio'); });
    expect(() => act(() => result.current.setSoundEnabled(true))).not.toThrow();
  });
});
