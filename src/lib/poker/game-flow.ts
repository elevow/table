import { TableState } from '../../types/poker';

// US-025: Basic Game Flow interface per docs
export interface GameFlow {
  stage: 'setup' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
  positions: Map<string, number>;
  blinds: { small: number; big: number };
  button: number;
  activePlayer: string;
  pot: number;
  currentBet: number;
}

/**
 * Build a GameFlow snapshot from the internal TableState without mutating it.
 * This satisfies US-025 requirements for visibility into positions, blinds, button, and stage.
 */
export function buildGameFlow(state: TableState): GameFlow {
  const positions = new Map<string, number>();
  state.players.forEach(p => positions.set(p.id, p.position));

  return {
    stage: state.stage as GameFlow['stage'],
    positions,
    blinds: { small: state.smallBlind, big: state.bigBlind },
    button: state.dealerPosition,
    activePlayer: state.activePlayer,
    pot: state.pot,
    currentBet: state.currentBet,
  };
}
