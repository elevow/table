import type { TournamentState } from '../../types/tournament-management';
import type { TournamentReporting, PrizeDistribution } from '../../types/tournament-reporting';
import { buildPayouts } from './tournament-utils';

export function buildTournamentReport(state: TournamentState, prizePool: number): TournamentReporting {
  const totalRegs = state.registeredPlayers.length;
  const totalElims = state.eliminatedPlayers.length;
  const remaining = totalRegs - totalElims;
  const currentLevelIndex = state.currentLevelIndex;

  const distributions: PrizeDistribution[] = buildPayouts(prizePool, state.config.payoutStructure)
    .map(p => ({ place: p.place, amount: p.amount }));

  const rebuys = (state.registrationTimeline || []).filter(e => e.type === 'rebuy').length;

  return {
    registration: {
      total: totalRegs,
      timeline: [...(state.registrationTimeline || [])].sort((a, b) => a.at - b.at),
      rebuys,
    },
    eliminations: [...(state.eliminationRecords || [])].sort((a, b) => a.at - b.at),
    prizePool: {
      total: prizePool,
      distributions,
    },
    statistics: {
      totalRegistrations: totalRegs,
      totalEliminations: totalElims,
      remainingPlayers: remaining,
      currentLevelIndex,
    },
  };
}
