import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_DISPLAY_SETTINGS, pickDisplaySettings, readTableOverrides, writeTableOverrides, type DisplaySettings,
} from '../lib/shared/display-settings';
import { authHeaders } from '../utils/auth-headers';

/**
 * A table's display settings: the player's profile settings, with any changes they made at this
 * table on top. Changes made here are kept for this table only, in this browser.
 */
export function useDisplaySettings(tableId: string | null) {
  const [profile, setProfile] = useState<DisplaySettings>(DEFAULT_DISPLAY_SETTINGS);
  const [overrides, setOverrides] = useState<Partial<DisplaySettings>>({});

  useEffect(() => {
    let cancelled = false;
    fetch('/api/profile/preferences', { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (!cancelled && data) setProfile({ ...DEFAULT_DISPLAY_SETTINGS, ...pickDisplaySettings(data.display) }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setOverrides(tableId ? readTableOverrides(tableId) : {});
  }, [tableId]);

  const change = useCallback((key: keyof DisplaySettings, value: boolean) => {
    if (!tableId) return;
    setOverrides(prev => {
      const next = { ...prev, [key]: value };
      // Back to the profile's setting means no change at this table
      if (value === profile[key]) delete next[key];
      writeTableOverrides(tableId, next);
      return next;
    });
  }, [tableId, profile]);

  const reset = useCallback(() => {
    if (tableId) writeTableOverrides(tableId, {});
    setOverrides({});
  }, [tableId]);

  const settings: DisplaySettings = { ...profile, ...overrides };
  const hasOverrides = Object.keys(overrides).some(k => overrides[k as keyof DisplaySettings] !== profile[k as keyof DisplaySettings]);
  return { settings, hasOverrides, change, reset };
}
