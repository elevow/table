import { PokerEngine } from './poker-engine';
import { Player, TableState } from '../../types/poker';
import { RunItTwiceOutcomeInput } from '../../types/game-history';

export interface EngineFactoryOptions {
  tableId: string;
  players: Player[];
  smallBlind: number;
  bigBlind: number;
  state?: Partial<TableState>;
  runItTwicePersistence?: { handId: string; onOutcome: (input: RunItTwiceOutcomeInput) => Promise<void> };
}

/**
 * Create a PokerEngine instance wired with production state/config:
 * - bettingMode from state (default 'no-limit')
 * - requireRunItTwiceUnanimous from state (default false)
 * - optional RIT per-run persistence hook
 */
export function createPokerEngine(opts: EngineFactoryOptions): PokerEngine {
  const variant = opts.state?.variant;
  const mode = opts.state?.bettingMode ?? (variant === 'omaha' || variant === 'omaha-hi-lo' ? 'pot-limit' : 'no-limit');
  const requireRit = !!opts.state?.requireRunItTwiceUnanimous;
  const persistence = opts.runItTwicePersistence
    ? { handId: opts.runItTwicePersistence.handId, onOutcome: opts.runItTwicePersistence.onOutcome }
    : undefined;

  const engine = new PokerEngine(
    opts.tableId,
    opts.players,
    opts.smallBlind,
    opts.bigBlind,
    {
      bettingMode: mode,
  variant: variant as any,
      requireRunItTwiceUnanimous: requireRit,
      runItTwicePersistence: persistence,
    }
  );
  return engine;
}
