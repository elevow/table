import React from 'react';
import type { BettingMode, GameVariant, MixedGameEntry } from '../types/poker';
import {
  ALL_VARIANTS,
  BETTING_MODE_LABELS,
  MIXED_GAME_PRESETS,
  VARIANT_LABELS,
} from '../lib/poker/variant-rules';
import { defaultBettingModeForVariant } from '../lib/game/variant-mapping';

interface Props {
  games: MixedGameEntry[];
  handsPerGame: number;
  onChange: (games: MixedGameEntry[], handsPerGame: number) => void;
}

const inputClass = 'border border-gray-300 dark:border-gray-600 rounded p-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500';

/**
 * Room creation: pick the games of a mixed-game rotation (a preset such as HORSE, or any list),
 * the betting for each, and how many hands each game lasts.
 */
export default function MixedGameSetup({ games, handsPerGame, onChange }: Props) {
  const presetKey = Object.entries(MIXED_GAME_PRESETS).find(([, p]) =>
    p.games.length === games.length && p.games.every((g, i) => g.variant === games[i]?.variant && g.bettingMode === games[i]?.bettingMode)
  )?.[0] || 'custom';

  const toggle = (variant: GameVariant) => {
    const included = games.some(g => g.variant === variant);
    const next = included
      ? games.filter(g => g.variant !== variant)
      : [...games, { variant, bettingMode: defaultBettingModeForVariant(variant) }];
    onChange(next, handsPerGame);
  };
  const setMode = (variant: GameVariant, bettingMode: BettingMode) =>
    onChange(games.map(g => (g.variant === variant ? { ...g, bettingMode } : g)), handsPerGame);
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= games.length) return;
    const next = [...games];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next, handsPerGame);
  };

  return (
    <div className="space-y-3 border border-gray-200 dark:border-gray-700 rounded p-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium">Mix</label>
          <select
            className={`${inputClass} w-full`}
            value={presetKey}
            onChange={e => {
              const preset = MIXED_GAME_PRESETS[e.target.value];
              if (preset) onChange(preset.games.map(g => ({ ...g })), handsPerGame);
            }}
          >
            {Object.entries(MIXED_GAME_PRESETS).map(([key, p]) => (
              <option key={key} value={key}>{p.name}</option>
            ))}
            <option value="custom">Custom</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium">Hands per game</label>
          <input
            type="number"
            min={1}
            max={100}
            step={1}
            className={`${inputClass} w-full`}
            value={handsPerGame}
            onChange={e => onChange(games, Math.max(1, Math.min(100, parseInt(e.target.value || '1', 10) || 1)))}
          />
        </div>
      </div>
      <div>
        <div className="text-sm font-medium mb-1">Games, in the order they are played</div>
        <ol className="space-y-1">
          {games.map((g, i) => (
            <li key={g.variant} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-6 text-right text-gray-500">{i + 1}.</span>
              <span className="min-w-[10rem]">{VARIANT_LABELS[g.variant]}</span>
              <select
                aria-label={`Betting for ${VARIANT_LABELS[g.variant]}`}
                className={`${inputClass} py-1`}
                value={g.bettingMode}
                onChange={e => setMode(g.variant, e.target.value as BettingMode)}
              >
                {(Object.keys(BETTING_MODE_LABELS) as BettingMode[]).map(m => (
                  <option key={m} value={m}>{BETTING_MODE_LABELS[m]}</option>
                ))}
              </select>
              <button type="button" className="px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-700" onClick={() => move(i, -1)} aria-label="Move up">↑</button>
              <button type="button" className="px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-700" onClick={() => move(i, 1)} aria-label="Move down">↓</button>
              <button type="button" className="px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-700" onClick={() => toggle(g.variant)} aria-label="Remove">✕</button>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2 mt-2">
          {ALL_VARIANTS.filter(v => !games.some(g => g.variant === v)).map(v => (
            <button key={v} type="button" className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600" onClick={() => toggle(v)}>
              + {VARIANT_LABELS[v]}
            </button>
          ))}
        </div>
        {games.length < 2 && (
          <p className="mt-1 text-xs text-red-600">Choose at least two games.</p>
        )}
      </div>
    </div>
  );
}
