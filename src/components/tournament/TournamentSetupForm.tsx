import { useMemo, useState } from 'react';
import { scaledPayoutStructure, tournamentPresets, validateTournamentConfig } from '../../lib/tournament/tournament-utils';
import {
  addLevel, addPayoutPlace, formatMinutes, levelStartMinutes, normalizeLevels, removeLastPayoutPlace,
  removeLevel, setBreak, setPayoutPercentage, updateLevel,
} from '../../lib/tournament/structure-editor';
import { formatMoney } from '../../lib/tournament/format';
import type { TournamentConfig } from '../../types/tournament';

const DEFAULT_PRESET = 'freezeout_default';
const DEFAULT_BREAK_MINUTES = 10;

const inputClass =
  'border border-gray-300 dark:border-gray-600 rounded-sm p-1.5 w-full bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500';
const linkButton = 'text-sm text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-40 disabled:no-underline';

/** A number from an input, with empty meaning undefined. */
const optionalNumber = (value: string) => (value.trim() === '' ? undefined : Number(value));

/** An epoch-ms time as the value of a datetime-local input, in the viewer's time zone. */
function toLocalInput(ms: number | undefined): string {
  if (ms === undefined) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "30 entries: 5 paid, 1st gets 34.17%" for a few field sizes */
function scalingExamples(paidPercent: number): string {
  return [10, 30, 100]
    .map(n => {
      const tiers = scaledPayoutStructure(n, paidPercent);
      return `${n} entries: ${tiers.length} paid, 1st gets ${tiers[0].percentage}%`;
    })
    .join(' · ');
}

/**
 * The tournament structure form, for creating a tournament or editing one before it starts.
 * Problems are listed as the director types, and submitting is blocked until there are none.
 */
// A new tournament's levels change when the director says, unless they choose the clock
const fromPreset = (key: string): TournamentConfig => ({ levelControl: 'director', ...normalizeLevels(tournamentPresets[key].build()) });

export default function TournamentSetupForm({
  initialName = '',
  initialConfig,
  submitLabel,
  submittingLabel,
  submitting,
  error,
  blocked = false,
  onSubmit,
}: {
  initialName?: string;
  initialConfig?: TournamentConfig; // editing; otherwise the form starts from the standard preset
  submitLabel: string;
  submittingLabel: string;
  submitting: boolean;
  error: string | null;
  blocked?: boolean; // e.g. signed out or without permission
  onSubmit: (name: string, config: TournamentConfig) => void;
}) {
  const [name, setName] = useState(initialName);
  const [presetKey, setPresetKey] = useState(initialConfig ? '' : DEFAULT_PRESET);
  const [config, setConfig] = useState<TournamentConfig>(() => initialConfig ?? fromPreset(DEFAULT_PRESET));

  const problems = useMemo(() => {
    const list = validateTournamentConfig(config).errors;
    return name.trim() ? list : ['Give the tournament a name', ...list];
  }, [config, name]);
  const startTimes = useMemo(() => levelStartMinutes(config), [config]);
  const payoutTotal = config.payoutStructure.reduce((sum, p) => sum + (p.percentage || 0), 0);
  const lastLevel = config.blindLevels.length;

  const choosePreset = (key: string) => {
    setPresetKey(key);
    setConfig(key ? fromPreset(key) : initialConfig!);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (problems.length === 0) onSubmit(name.trim(), config);
  };

  return (
    <form className="space-y-6" onSubmit={submit}>
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block text-sm font-medium">
          Name
          <input className={inputClass} value={name} onChange={e => setName(e.target.value)} placeholder="Friday Night Freezeout" />
        </label>
        <label className="block text-sm font-medium">
          Start from
          <select className={inputClass} value={presetKey} onChange={e => choosePreset(e.target.value)}>
            {initialConfig && <option value="">Current structure</option>}
            {Object.entries(tournamentPresets).map(([key, p]) => (
              <option key={key} value={key}>{p.name}</option>
            ))}
          </select>
          <span className="block text-xs font-normal text-gray-600 dark:text-gray-400 mt-1">
            {presetKey ? `${tournamentPresets[presetKey]?.description}. ` : ''}Changing this replaces the structure below.
          </span>
        </label>
        <label className="block text-sm font-medium">
          Starting stack
          <input type="number" min={1} className={inputClass} value={config.startingStack}
            onChange={e => setConfig({ ...config, startingStack: Number(e.target.value) })} />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block text-sm font-medium">
            Seats per table
            <select className={inputClass} value={config.seatsPerTable ?? 9}
              onChange={e => setConfig({ ...config, seatsPerTable: Number(e.target.value) })}>
              {[2, 3, 4, 5, 6, 7, 8, 9].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Max players
            <input type="number" min={2} className={inputClass} value={config.maxPlayers ?? ''} placeholder="No limit"
              onChange={e => setConfig({ ...config, maxPlayers: optionalNumber(e.target.value) })} />
          </label>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Start and late registration</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block text-sm font-medium">
            Start time
            <input type="datetime-local" className={inputClass} value={toLocalInput(config.startsAt)}
              onChange={e => setConfig(e.target.value
                ? { ...config, startsAt: new Date(e.target.value).getTime() }
                : { ...config, startsAt: undefined, minPlayers: undefined })} />
            <span className="block text-xs font-normal text-gray-600 dark:text-gray-400 mt-1">
              {config.startsAt === undefined ? 'Leave empty to start it yourself.' : 'It starts by itself at this time.'}
            </span>
          </label>
          {config.startsAt !== undefined && (
            <label className="block text-sm font-medium">
              Minimum players
              <input type="number" min={2} className={inputClass} value={config.minPlayers ?? ''} placeholder="2"
                onChange={e => setConfig({ ...config, minPlayers: optionalNumber(e.target.value) })} />
              <span className="block text-xs font-normal text-gray-600 dark:text-gray-400 mt-1">With fewer registered by the start time, it&apos;s cancelled.</span>
            </label>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-4 text-sm">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={config.lateRegistration.enabled}
              onChange={e => setConfig({
                ...config,
                lateRegistration: e.target.checked
                  ? { enabled: true, endLevel: Math.min(Math.max(config.lateRegistration.endLevel, 1), lastLevel), endTime: config.lateRegistration.endTime > 0 ? config.lateRegistration.endTime : 60 }
                  : { ...config.lateRegistration, enabled: false },
                ...(e.target.checked ? {} : { reentry: config.reentry ? { ...config.reentry, enabled: false } : undefined }),
              })} />
            Late registration
          </label>
          {config.lateRegistration.enabled && (
            <>
              <label className="block">
                Until the end of level
                <select className={inputClass} value={config.lateRegistration.endLevel}
                  onChange={e => setConfig({ ...config, lateRegistration: { ...config.lateRegistration, endLevel: Number(e.target.value) } })}>
                  {config.blindLevels.map(l => <option key={l.level} value={l.level}>{l.level}</option>)}
                </select>
              </label>
              <label className="block">
                And at most (minutes)
                <input type="number" min={1} className={inputClass} value={config.lateRegistration.endTime}
                  onChange={e => setConfig({ ...config, lateRegistration: { ...config.lateRegistration, endTime: Number(e.target.value) } })} />
              </label>
            </>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Buy-in</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <label className="block text-sm font-medium">
            Buy-in ($)
            <input type="number" min={0} step="0.01" className={inputClass} value={config.buyIn ?? ''} placeholder="Free"
              onChange={e => setConfig({ ...config, buyIn: optionalNumber(e.target.value) })} />
            <span className="block text-xs font-normal text-gray-600 dark:text-gray-400 mt-1">Goes into the prize pool</span>
          </label>
          <label className="block text-sm font-medium">
            Entry fee ($)
            <input type="number" min={0} step="0.01" className={inputClass} value={config.entryFee ?? ''} placeholder="None"
              onChange={e => setConfig({ ...config, entryFee: optionalNumber(e.target.value) })} />
            <span className="block text-xs font-normal text-gray-600 dark:text-gray-400 mt-1">Kept by the house</span>
          </label>
          <label className="block text-sm font-medium">
            Bounty
            <select className={inputClass} value={config.bounty?.type ?? 'none'}
              onChange={e => {
                const type = e.target.value;
                setConfig(type === 'none'
                  ? { ...config, bounty: undefined }
                  : { ...config, bounty: { amount: config.bounty?.amount ?? 2, type: type as 'standard' | 'progressive' } });
              }}>
              <option value="none">None</option>
              <option value="standard">Standard knockout</option>
              <option value="progressive">Progressive knockout</option>
            </select>
          </label>
          {config.bounty && (
            <label className="block text-sm font-medium">
              Bounty ($)
              <input type="number" min={0} step="0.01" className={inputClass} value={config.bounty.amount}
                onChange={e => setConfig({ ...config, bounty: { ...config.bounty!, amount: Number(e.target.value) } })} />
            </label>
          )}
        </div>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Players pay {formatMoney((config.buyIn ?? 0) + (config.entryFee ?? 0) + (config.bounty?.amount ?? 0))} to enter
          {config.bounty?.type === 'standard' && `. Knocking a player out wins their ${formatMoney(config.bounty.amount)} bounty`}
          {config.bounty?.type === 'progressive' && '. Knocking a player out wins half their bounty; the other half is added to yours'}
          .
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Blind levels</h2>
        {/* Levels only move on when the director says so; automatic levels aren't offered for now.
            The server still runs them for any tournament already set up that way. */}
        <p className="mb-3 text-xs text-gray-600 dark:text-gray-400">
          {config.levelControl === 'clock'
            ? 'Levels and breaks move on by themselves when their time runs out.'
            : 'The minutes are a guide: the clock counts down, then waits for you to start the next level or break, and to end each break.'}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600 dark:text-gray-400">
                <th className="py-1 pr-2">Level</th>
                <th className="py-1 pr-2">Small blind</th>
                <th className="py-1 pr-2">Big blind</th>
                <th className="py-1 pr-2">Ante</th>
                <th className="py-1 pr-2">Minutes</th>
                <th className="py-1 pr-2">Starts</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {config.blindLevels.map((lvl, i) => {
                const brk = config.breaks.find(b => b.afterLevel === lvl.level);
                return [
                  <tr key={`level-${lvl.level}`}>
                    <td className="py-1 pr-2 font-medium">{lvl.level}</td>
                    <td className="py-1 pr-2">
                      <input type="number" min={0} aria-label={`Level ${lvl.level} small blind`} className={inputClass}
                        value={lvl.smallBlind} onChange={e => setConfig(updateLevel(config, i, { smallBlind: Number(e.target.value) }))} />
                    </td>
                    <td className="py-1 pr-2">
                      <input type="number" min={0} aria-label={`Level ${lvl.level} big blind`} className={inputClass}
                        value={lvl.bigBlind} onChange={e => setConfig(updateLevel(config, i, { bigBlind: Number(e.target.value) }))} />
                    </td>
                    <td className="py-1 pr-2">
                      <input type="number" min={0} aria-label={`Level ${lvl.level} ante`} className={inputClass} placeholder="None"
                        value={lvl.ante ?? ''} onChange={e => setConfig(updateLevel(config, i, { ante: optionalNumber(e.target.value) }))} />
                    </td>
                    <td className="py-1 pr-2">
                      <input type="number" min={1} aria-label={`Level ${lvl.level} minutes`} className={inputClass}
                        value={lvl.durationMinutes} onChange={e => setConfig(updateLevel(config, i, { durationMinutes: Number(e.target.value) }))} />
                    </td>
                    <td className="py-1 pr-2 tabular-nums text-gray-600 dark:text-gray-400">{formatMinutes(startTimes[i])}</td>
                    <td className="py-1 whitespace-nowrap space-x-3">
                      {!brk && lvl.level < lastLevel && (
                        <button type="button" className={linkButton} onClick={() => setConfig(setBreak(config, lvl.level, DEFAULT_BREAK_MINUTES))}>
                          Add break after
                        </button>
                      )}
                      <button type="button" className={linkButton} disabled={lastLevel <= 1}
                        aria-label={`Remove level ${lvl.level}`} onClick={() => setConfig(removeLevel(config, i))}>
                        Remove
                      </button>
                    </td>
                  </tr>,
                  brk && (
                    <tr key={`break-${lvl.level}`} className="bg-amber-50 dark:bg-amber-900/20">
                      <td className="py-1 pr-2 text-amber-800 dark:text-amber-300" colSpan={4}>Break after level {lvl.level}</td>
                      <td className="py-1 pr-2">
                        <input type="number" min={1} aria-label={`Break after level ${lvl.level} minutes`} className={inputClass}
                          value={brk.durationMinutes} onChange={e => setConfig(setBreak(config, lvl.level, Number(e.target.value)))} />
                      </td>
                      <td />
                      <td className="py-1">
                        <button type="button" className={linkButton} aria-label={`Remove break after level ${lvl.level}`}
                          onClick={() => setConfig(setBreak(config, lvl.level, null))}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex items-center gap-4">
          <button type="button" className={linkButton} onClick={() => setConfig(addLevel(config))}>Add level</button>
          <span className="text-xs text-gray-600 dark:text-gray-400">
            Levels move on by themselves when their time is up; the last level plays until there&apos;s a winner.
          </span>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Payouts</h2>
        <div role="radiogroup" aria-label="How places are paid" className="flex flex-wrap gap-4 text-sm mb-2">
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="payout-mode" checked={!config.payoutScaling}
              onChange={() => setConfig({ ...config, payoutScaling: undefined })} />
            Fixed places
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="payout-mode" checked={!!config.payoutScaling}
              onChange={() => setConfig({ ...config, payoutScaling: { paidPercent: 15 } })} />
            A share of the field
          </label>
        </div>
        {config.payoutScaling ? (
          <div className="text-sm space-y-1">
            <label className="inline-flex items-center gap-2">
              Pay the top
              <input type="number" min={1} max={100} className={`${inputClass} w-20`} aria-label="Share of entries paid (%)"
                value={config.payoutScaling.paidPercent}
                onChange={e => setConfig({ ...config, payoutScaling: { paidPercent: Number(e.target.value) } })} />
              % of entries
            </label>
            <p className="text-xs text-gray-600 dark:text-gray-400">{scalingExamples(config.payoutScaling.paidPercent)}</p>
          </div>
        ) : (<>
        <div className="space-y-1 max-w-xs">
          {config.payoutStructure.map(p => (
            <label key={p.place} className="flex items-center gap-2 text-sm">
              <span className="w-16">Place {p.place}</span>
              <input type="number" min={0} max={100} step="0.5" aria-label={`Place ${p.place} percentage`} className={inputClass}
                value={p.percentage} onChange={e => setConfig(setPayoutPercentage(config, p.place, Number(e.target.value)))} />
              <span>%</span>
            </label>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-4 text-sm">
          <button type="button" className={linkButton} onClick={() => setConfig(addPayoutPlace(config))}>Add place</button>
          <button type="button" className={linkButton} disabled={config.payoutStructure.length <= 1}
            onClick={() => setConfig(removeLastPayoutPlace(config))}>Remove last place</button>
          <span className={payoutTotal === 100 ? 'text-gray-600 dark:text-gray-400' : 'text-amber-700 dark:text-amber-400'}>
            Total {payoutTotal}%
          </span>
        </div>
        </>)}
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <fieldset className="space-y-2">
          <legend className="text-lg font-semibold mb-1">Rebuys</legend>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!config.rebuys?.enabled}
              onChange={e => setConfig({
                ...config,
                rebuys: { cost: 0, stack: config.startingStack, availableUntilLevel: Math.min(4, lastLevel), ...config.rebuys, enabled: e.target.checked },
              })} />
            Allow rebuys
          </label>
          {config.rebuys?.enabled && (
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Players who bust can buy back in through the end of the chosen level and the break right after it.
              {config.bounty ? ` Each rebuy also buys a new ${formatMoney(config.bounty.amount)} bounty.` : ''}
            </p>
          )}
          {config.rebuys?.enabled && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end text-sm">
              <label className="block">
                Cost ($)
                <input type="number" min={0} step="0.01" className={inputClass} value={config.rebuys.cost}
                  onChange={e => setConfig({ ...config, rebuys: { ...config.rebuys!, cost: Number(e.target.value) } })} />
              </label>
              <label className="block">
                House %
                <input type="number" min={0} max={100} step="0.5" className={inputClass} value={config.rebuys.feePercent ?? ''} placeholder="0"
                  onChange={e => setConfig({ ...config, rebuys: { ...config.rebuys!, feePercent: optionalNumber(e.target.value) } })} />
              </label>
              <label className="block">
                Up to
                <input type="number" min={0} className={inputClass} value={config.rebuys.maxPerPlayer ?? ''} placeholder="No limit"
                  onChange={e => setConfig({ ...config, rebuys: { ...config.rebuys!, maxPerPlayer: optionalNumber(e.target.value) } })} />
              </label>
              <label className="block">
                Until level
                <select className={inputClass} value={config.rebuys.availableUntilLevel ?? ''}
                  onChange={e => setConfig({ ...config, rebuys: { ...config.rebuys!, availableUntilLevel: optionalNumber(e.target.value) } })}>
                  {config.blindLevels.map(l => <option key={l.level} value={l.level}>{l.level}</option>)}
                  <option value="">Every level</option>
                </select>
              </label>
              <label className="block">
                Chips
                <input type="number" min={1} className={inputClass} value={config.rebuys.stack}
                  onChange={e => setConfig({ ...config, rebuys: { ...config.rebuys!, stack: Number(e.target.value) } })} />
              </label>
            </div>
          )}
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-lg font-semibold mb-1">Add-on</legend>
          <label className={`inline-flex items-center gap-2 text-sm ${config.breaks.length === 0 ? 'opacity-50' : ''}`}>
            <input type="checkbox" checked={!!config.addOn?.enabled} disabled={config.breaks.length === 0 && !config.addOn?.enabled}
              onChange={e => setConfig({
                ...config,
                addOn: { cost: 0, stack: config.startingStack, ...config.addOn, availableAtBreakAfterLevel: config.addOn?.availableAtBreakAfterLevel ?? config.breaks[0]?.afterLevel, enabled: e.target.checked },
              })} />
            Offer an add-on at a break
          </label>
          {config.breaks.length === 0 && <p className="text-xs text-gray-600 dark:text-gray-400">Add a break to offer an add-on.</p>}
          {config.addOn?.enabled && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end text-sm">
              <label className="block">
                Cost ($)
                <input type="number" min={0} step="0.01" className={inputClass} value={config.addOn.cost}
                  onChange={e => setConfig({ ...config, addOn: { ...config.addOn!, cost: Number(e.target.value) } })} />
              </label>
              <label className="block">
                House %
                <input type="number" min={0} max={100} step="0.5" className={inputClass} value={config.addOn.feePercent ?? ''} placeholder="0"
                  onChange={e => setConfig({ ...config, addOn: { ...config.addOn!, feePercent: optionalNumber(e.target.value) } })} />
              </label>
              <label className="block">
                At the break after level
                <select className={inputClass} value={config.addOn.availableAtBreakAfterLevel ?? ''}
                  onChange={e => setConfig({ ...config, addOn: { ...config.addOn!, availableAtBreakAfterLevel: optionalNumber(e.target.value) } })}>
                  <option value="">Choose…</option>
                  {config.breaks.map(b => <option key={b.afterLevel} value={b.afterLevel}>{b.afterLevel}</option>)}
                </select>
              </label>
              <label className="block">
                Chips
                <input type="number" min={1} className={inputClass} value={config.addOn.stack}
                  onChange={e => setConfig({ ...config, addOn: { ...config.addOn!, stack: Number(e.target.value) } })} />
              </label>
            </div>
          )}
        </fieldset>
      </section>

      <section>
        <fieldset className="space-y-2">
          <legend className="text-lg font-semibold mb-1">Re-entry</legend>
          <label className={`inline-flex items-center gap-2 text-sm ${config.lateRegistration.enabled ? '' : 'opacity-50'}`}>
            <input type="checkbox" checked={!!config.reentry?.enabled} disabled={!config.lateRegistration.enabled && !config.reentry?.enabled}
              onChange={e => setConfig({ ...config, reentry: { ...config.reentry, enabled: e.target.checked } })} />
            Let busted players buy a new entry while late registration is open
          </label>
          {!config.lateRegistration.enabled && <p className="text-xs text-gray-600 dark:text-gray-400">Turn on late registration to allow re-entry.</p>}
          {config.reentry?.enabled && (
            <label className="block text-sm max-w-xs">
              Up to (per player)
              <input type="number" min={0} className={inputClass} value={config.reentry.maxPerPlayer ?? ''} placeholder="No limit"
                onChange={e => setConfig({ ...config, reentry: { ...config.reentry!, maxPerPlayer: optionalNumber(e.target.value) } })} />
            </label>
          )}
        </fieldset>
      </section>

      {problems.length > 0 && (
        <ul aria-label="Problems" className="text-sm text-amber-800 dark:text-amber-300 list-disc pl-5 space-y-0.5">
          {problems.map((p, i) => <li key={i}>{p}</li>)}
        </ul>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-sm disabled:opacity-50"
        disabled={submitting || problems.length > 0 || blocked}>
        {submitting ? submittingLabel : submitLabel}
      </button>
    </form>
  );
}
