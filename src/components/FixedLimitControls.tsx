import React from 'react';
import type { TableState } from '../types/poker';
import { FIXED_LIMIT_CAP, fixedLimitOptions } from '../lib/poker/fixed-limit';
import { formatChips } from '../utils/chip-display';

interface Props {
  state: TableState;
  playerId: string;
  onBet: (amount: number) => void;
  onRaise: (amount: number) => void;
  showStackInBB?: boolean;
}

/**
 * Fixed-limit betting: one button for the only bet or raise allowed, with its exact size, in
 * place of the slider and amount box of no-limit and pot-limit. The engine decides the size; the
 * amount sent is the same so the button and the result agree. Its pieces join the row holding
 * Fold and Call, so the three actions sit together.
 */
export default function FixedLimitControls({ state, playerId, onBet, onRaise, showStackInBB }: Props) {
  const me = state.players?.find(p => p.id === playerId);
  if (!me) return null;
  const opts = fixedLimitOptions(state, me);
  const money = (n: number) => (showStackInBB ? formatChips(n, state.bigBlind || null, true) : `$${n}`);
  const allIn = (to: number) => to >= me.currentBet + me.stack;

  return (
    <div className="contents" aria-label="Fixed-limit betting">
      <div className="order-first w-full text-sm text-gray-700 dark:text-gray-300 font-medium">
        Fixed limit: bets are {money(opts.unit)} this round
        <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">({opts.bets} of {FIXED_LIMIT_CAP} bets made)</span>
      </div>
      {opts.betTo !== null && (
        <button
          onClick={() => onBet(opts.betTo as number)}
          // Enter presses it, as the submit button does in the other betting modes
          data-shortcut-submit
          className="btn btn-lg act-raise max-sm:flex-1 max-sm:min-h-[48px] max-sm:text-base sm:w-[calc(30%-0.375rem)]"
        >
          {allIn(opts.betTo) ? `All-in ${money(opts.betTo)}` : `Bet ${money(opts.betTo)}`}
        </button>
      )}
      {opts.raiseTo !== null && (
        <button
          onClick={() => onRaise(opts.raiseTo as number)}
          // Enter presses it, as the submit button does in the other betting modes
          data-shortcut-submit
          className="btn btn-lg act-raise max-sm:flex-1 max-sm:min-h-[48px] max-sm:text-base sm:w-[calc(30%-0.375rem)]"
        >
          {allIn(opts.raiseTo) ? `All-in ${money(opts.raiseTo)}` : `Raise to ${money(opts.raiseTo)}`}
        </button>
      )}
      {opts.capped && (
        <span className="w-full text-sm text-gray-600 dark:text-gray-300">Betting is capped this round: call or fold.</span>
      )}
    </div>
  );
}
