// The table's display settings. Each player's usual choice is in their profile; changing one here
// applies to this table only. Sound is the table's own Sound on/off button, and time banks are set
// by the host when the table is created.
import { memo } from 'react';
import type { DisplaySettings } from '../lib/shared/display-settings';

export type GameSettings = DisplaySettings;

interface GameSettingsProps {
  settings: DisplaySettings;
  onChange: (setting: keyof DisplaySettings, value: boolean) => void;
  /** Whether this table has changes from the profile settings, which onReset undoes */
  hasOverrides?: boolean;
  onReset?: () => void;
}

const OPTIONS: { key: keyof DisplaySettings; label: string; help: string }[] = [
  { key: 'highContrastCards', label: 'High Contrast Cards', help: 'When enabled: Hearts = Red, Diamonds = Yellow, Spades = Black, Clubs = Blue.' },
  { key: 'showPotOdds', label: 'Show Pot Odds', help: 'Display the ratio between the pot size and the bet you are facing.' },
  { key: 'showStackInBB', label: 'Show Stack in Big Blinds', help: 'Display chip stacks in Big Blinds (BB) instead of raw chip counts.' },
  { key: 'showHandValue', label: 'Show Hand Value', help: 'Name the hand your cards make, such as "Two Pair", while you play.' },
];

function GameSettings({ settings, onChange, hasOverrides = false, onReset }: GameSettingsProps) {
  return (
    <div className="game-settings">
      <h2>Game Settings</h2>

      <div className="settings-group">
        <h3>Display Settings</h3>
        {OPTIONS.map(({ key, label, help }) => (
          <div className="setting-item" key={key}>
            <label>
              <input
                type="checkbox"
                checked={settings[key]}
                onChange={(e) => onChange(key, e.target.checked)}
              />
              {label}
            </label>
            <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">{help}</div>
          </div>
        ))}
      </div>

      <div className="text-xs text-gray-600 dark:text-gray-300 mt-2">
        {hasOverrides ? (
          <>
            Changed for this table only.{' '}
            {onReset && (
              <button type="button" onClick={onReset} className="text-blue-600 hover:underline dark:text-blue-400">
                Use my profile settings
              </button>
            )}
          </>
        ) : (
          'These are your profile settings. Changes here apply to this table only.'
        )}
      </div>
    </div>
  );
}

export default memo(GameSettings);
