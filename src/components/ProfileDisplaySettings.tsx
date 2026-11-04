import { useEffect, useState } from 'react';
import {
  DEFAULT_DISPLAY_SETTINGS, DISPLAY_SETTING_KEYS, pickDisplaySettings, type DisplaySettings,
} from '../lib/shared/display-settings';
import { authHeaders } from '../utils/auth-headers';

const LABELS: Record<keyof DisplaySettings, string> = {
  highContrastCards: 'High Contrast Cards',
  showPotOdds: 'Show Pot Odds',
  showStackInBB: 'Show Stack in Big Blinds',
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
    <div className="border-t dark:border-gray-700 pt-4">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Table Display</h3>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
        Every table starts with these. You can still change them at a table from Show Settings.
      </p>
      <div className="space-y-2">
        {DISPLAY_SETTING_KEYS.map(key => (
          <label key={key} className="flex items-center gap-2 text-gray-900 dark:text-gray-100">
            <input type="checkbox" checked={settings[key]} disabled={!loaded} onChange={e => change(key, e.target.checked)} />
            {LABELS[key]}
          </label>
        ))}
      </div>
      {status && (
        <p role="status" className={`mt-2 text-xs ${status.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {status.text}
        </p>
      )}
    </div>
  );
}
