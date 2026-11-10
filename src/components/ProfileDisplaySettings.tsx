import { useEffect, useState } from 'react';
import {
  DEFAULT_DISPLAY_SETTINGS, DISPLAY_SETTING_KEYS, pickDisplaySettings, type DisplaySettings,
} from '../lib/shared/display-settings';
import { authHeaders } from '../utils/auth-headers';

const LABELS: Record<keyof DisplaySettings, string> = {
  highContrastCards: 'High-contrast cards',
  showPotOdds: 'Show pot odds',
  showStackInBB: 'Show stacks in big blinds',
  showHandValue: 'Show hand value',
};

/** The profile's table display settings: every table starts from these, and each saves as it's changed. */
export default function ProfileDisplaySettings() {
  const [settings, setSettings] = useState<DisplaySettings>(DEFAULT_DISPLAY_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/profile/preferences', { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error())))
      .then(data => setSettings({ ...DEFAULT_DISPLAY_SETTINGS, ...pickDisplaySettings(data.display) }))
      .catch(() => setStatus({ ok: false, text: 'Couldn\'t load your table settings' }))
      .finally(() => setLoaded(true));
  }, []);

  const change = async (key: keyof DisplaySettings, value: boolean) => {
    const before = settings;
    setSettings({ ...settings, [key]: value });
    try {
      const res = await fetch('/api/profile/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ display: { [key]: value } }),
      });
      if (!res.ok) throw new Error();
      setSettings({ ...DEFAULT_DISPLAY_SETTINGS, ...pickDisplaySettings((await res.json()).display) });
      setStatus({ ok: true, text: 'Saved' });
    } catch {
      setSettings(before);
      setStatus({ ok: false, text: 'Couldn\'t save. Try again.' });
    }
  };

  return (
    <section>
      <div className="mb-2 flex items-center justify-between px-1">
        <h3 className="eyebrow">Table display</h3>
        {status && (
          <p role="status" className={`text-xs ${status.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {status.text}
          </p>
        )}
      </div>
      <div className="surface divide-y divide-gray-100 overflow-hidden dark:divide-white/5">
        {DISPLAY_SETTING_KEYS.map(key => (
          <label key={key} className="flex cursor-pointer items-center justify-between gap-4 px-5 py-3.5 text-sm font-medium text-gray-800 dark:text-gray-200">
            {LABELS[key]}
            <input type="checkbox" className="peer sr-only" checked={settings[key]} disabled={!loaded} onChange={e => change(key, e.target.checked)} />
            <span aria-hidden="true" className="relative h-5 w-9 shrink-0 rounded-full bg-gray-300 transition-colors peer-checked:bg-emerald-500 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500/60 peer-disabled:opacity-50 dark:bg-white/25 dark:peer-checked:bg-emerald-500 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-4" />
          </label>
        ))}
      </div>
      <p className="mt-2 px-1 text-xs text-gray-500 dark:text-gray-400">
        Every table starts with these. You can still change them at a table from Show Settings.
      </p>
    </section>
  );
}
