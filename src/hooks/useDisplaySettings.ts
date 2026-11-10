import { useCallback, useEffect, useMemo, useState } from 'react';
import { useHydrated } from './useHydrated';
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
  // Changes made at this table in this visit, else the ones saved for it (read once hydrated)
  const hydrated = useHydrated();
  const [edited, setEdited] = useState<{ tableId: string; overrides: Partial<DisplaySettings> } | null>(null);
  const saved = useMemo(() => (hydrated && tableId ? readTableOverrides(tableId) : {}), [hydrated, tableId]);
  const overrides = edited && edited.tableId === tableId ? edited.overrides : saved;

  useEffect(() => {
    let cancelled = false;
    fetch('/api/profile/preferences', { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (!cancelled && data) setProfile({ ...DEFAULT_DISPLAY_SETTINGS, ...pickDisplaySettings(data.display) }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const change = useCallback((key: keyof DisplaySettings, value: boolean) => {
    if (!tableId) return;
    const next = { ...overrides, [key]: value };
    // Back to the profile's setting means no change at this table
    if (value === profile[key]) delete next[key];
    writeTableOverrides(tableId, next);
    setEdited({ tableId, overrides: next });
  }, [tableId, profile, overrides]);

  const reset = useCallback(() => {
    if (!tableId) return;
    writeTableOverrides(tableId, {});
    setEdited({ tableId, overrides: {} });
  }, [tableId]);

  const settings: DisplaySettings = { ...profile, ...overrides };
  const hasOverrides = Object.keys(overrides).some(k => overrides[k as keyof DisplaySettings] !== profile[k as keyof DisplaySettings]);
  return { settings, hasOverrides, change, reset };
}
