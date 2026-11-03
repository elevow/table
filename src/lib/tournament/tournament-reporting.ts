import type { TournamentState } from '../../types/tournament-management';
import type { TournamentReporting, PrizeDistribution } from '../../types/tournament-reporting';
import { bountyEnabled, bountyPool, payoutTable, prizePool as poolOf } from './tournament-money';

export function buildTournamentReport(state: TournamentState): TournamentReporting {
  const prizePool = poolOf(state);
  const totalRegs = state.registeredPlayers.length;
  const totalElims = state.eliminatedPlayers.length;
  const remaining = totalRegs - totalElims;
  const currentLevelIndex = state.currentLevelIndex;

  const distributions: PrizeDistribution[] = payoutTable(state).map(p => ({ place: p.place, amount: p.amount }));

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
    ...(bountyEnabled(state.config) ? {
      bounties: {
        type: state.config.bounty!.type,
        amount: state.config.bounty!.amount,
        total: bountyPool(state),
        winnings: { ...(state.bountyWinnings || {}) },
        outstanding: { ...(state.bounties || {}) },
      },
    } : {}),
    statistics: {
      totalRegistrations: totalRegs,
      totalEliminations: totalElims,
      remainingPlayers: remaining,
      currentLevelIndex,
    },
  };
}
