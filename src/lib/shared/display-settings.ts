// How a player likes the table drawn. Their profile holds their usual choice; changing one at a
// table overrides it for that table only, in that browser.
export interface DisplaySettings {
  highContrastCards: boolean;
  showPotOdds: boolean;
  showStackInBB: boolean;
  showHandValue: boolean;
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  highContrastCards: false,
  showPotOdds: true,
  showStackInBB: false,
  showHandValue: true,
};

export const DISPLAY_SETTING_KEYS = Object.keys(DEFAULT_DISPLAY_SETTINGS) as (keyof DisplaySettings)[];

/** Only the known settings, and only true/false values, from anything saved or sent. */
export function pickDisplaySettings(raw: unknown): Partial<DisplaySettings> {
  const out: Partial<DisplaySettings> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of DISPLAY_SETTING_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === 'boolean') out[key] = value;
  }
  return out;
}

/** Where a table's own overrides are kept in the browser. */
export const tableDisplayKey = (tableId: string) => `game_settings_${tableId}`;

export function readTableOverrides(tableId: string): Partial<DisplaySettings> {
  try {
    return pickDisplaySettings(JSON.parse(localStorage.getItem(tableDisplayKey(tableId)) || '{}'));
  } catch {
    return {};
  }
}

export function writeTableOverrides(tableId: string, overrides: Partial<DisplaySettings>): void {
  try {
    if (Object.keys(overrides).length === 0) localStorage.removeItem(tableDisplayKey(tableId));
    else localStorage.setItem(tableDisplayKey(tableId), JSON.stringify(overrides));
  } catch {}
}

/**
 * Text colour for a card's suit. High-contrast cards give each suit its own colour (hearts red,
 * diamonds yellow, clubs blue, spades black); otherwise red suits are red and black suits near-black.
 */
export function suitColorClass(suit: string, highContrast: boolean): string {
  if (highContrast) {
    if (suit === 'hearts') return 'text-red-500';
    if (suit === 'diamonds') return 'text-yellow-500';
    if (suit === 'clubs') return 'text-blue-600';
    return 'text-black';
  }
  return suit === 'hearts' || suit === 'diamonds' ? 'text-red-600' : 'text-gray-900';
}
