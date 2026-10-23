import { useCallback, useEffect, useRef, useState } from 'react';
import { LOW_TIME_WARNING_MS } from '../lib/shared/turn-clock';

const SOUND_KEY = 'table_turnSound';
const NOTIFY_KEY = 'table_turnNotify';

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === 'true';
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Storage may be unavailable (private mode); the setting just won't persist
  }
}

let audioCtx: AudioContext | null = null;

/** Play a short sequence of tones; no audio files needed. */
function playTones(freqs: number[], durationMs = 140) {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    const ctx = audioCtx!;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    freqs.forEach((freq, i) => {
      const start = ctx.currentTime + (i * durationMs) / 1000;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + durationMs / 1000);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + durationMs / 1000 + 0.02);
    });
  } catch {
    // Audio is a nicety; never let it break the table
  }
}

export interface TurnAlertSettings {
  soundEnabled: boolean;
  setSoundEnabled: (on: boolean) => void;
  /** 'unsupported' when the browser has no notifications; 'default' until the player decides. */
  notifyPermission: NotificationPermission | 'unsupported';
  notifyEnabled: boolean;
  setNotifyEnabled: (on: boolean) => void;
}

/**
 * Alerts the player when it becomes their turn (a chime, plus a browser notification if the tab
 * is in the background) and once more when their time is running low.
 */
export function useTurnAlerts(isMyTurn: boolean, remainingMs: number | null, turnKey: string | null): TurnAlertSettings {
  const [soundEnabled, setSoundState] = useState(true);
  const [notifyEnabled, setNotifyState] = useState(false);
  const [notifyPermission, setNotifyPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');

  useEffect(() => {
    setSoundState(readFlag(SOUND_KEY, true));
    const supported = typeof window !== 'undefined' && 'Notification' in window;
    setNotifyPermission(supported ? Notification.permission : 'unsupported');
    setNotifyState(supported && Notification.permission === 'granted' && readFlag(NOTIFY_KEY, true));
  }, []);

  const setSoundEnabled = useCallback((on: boolean) => {
    setSoundState(on);
    writeFlag(SOUND_KEY, on);
    // Browsers only allow audio after a user gesture; this click is one
    if (on) playTones([660]);
  }, []);

  const setNotifyEnabled = useCallback((on: boolean) => {
    if (!on) {
      setNotifyState(false);
      writeFlag(NOTIFY_KEY, false);
      return;
    }
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    Notification.requestPermission().then(permission => {
      setNotifyPermission(permission);
      const granted = permission === 'granted';
      setNotifyState(granted);
      writeFlag(NOTIFY_KEY, granted);
    }).catch(() => {});
  }, []);

  // Your turn: chime, and notify if the player is looking at another tab
  const wasMyTurnRef = useRef(false);
  useEffect(() => {
    const started = isMyTurn && !wasMyTurnRef.current;
    wasMyTurnRef.current = isMyTurn;
    if (!started) return;
    if (soundEnabled) playTones([523, 784]);
    if (notifyEnabled && typeof document !== 'undefined' && document.hidden) {
      try {
        const n = new Notification("It's your turn", { body: 'Your poker table is waiting for you.', tag: 'table-turn' });
        n.onclick = () => { window.focus(); n.close(); };
      } catch {
        // Some browsers only allow notifications from a service worker
      }
    }
  }, [isMyTurn, soundEnabled, notifyEnabled]);

  // Time running low: warn once per turn
  const warnedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isMyTurn || !turnKey || remainingMs === null) return;
    if (remainingMs > LOW_TIME_WARNING_MS || remainingMs <= 0) return;
    if (warnedKeyRef.current === turnKey) return;
    warnedKeyRef.current = turnKey;
    if (soundEnabled) playTones([880, 880, 880], 110);
  }, [isMyTurn, remainingMs, turnKey, soundEnabled]);

  return { soundEnabled, setSoundEnabled, notifyPermission, notifyEnabled, setNotifyEnabled };
}
