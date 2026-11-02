import { buildPayouts } from './tournament-utils';
import type { TournamentConfig } from '../../types/tournament';
import type { TournamentState } from '../../types/tournament-management';

/*
 * Money and chips in a tournament. Each entry puts its buy-in into the prize pool (the entry fee
 * goes to the house), each rebuy and add-on its cost less its fee percentage. In a knockout,
 * each entry and rebuy also puts the bounty amount on the player's head, kept apart from the
 * prize pool and paid out as players are knocked out.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

function countOf(t: TournamentState, type: 'rebuy' | 'addOn'): number {
  return (t.registrationTimeline || []).filter(e => e.type === type).length;
}

/** What a rebuy or add-on adds to the prize pool: its cost less the house's percentage. */
function poolShare(extra: { cost: number; feePercent?: number } | undefined): number {
  return extra ? extra.cost * (1 - (extra.feePercent ?? 0) / 100) : 0;
}

export function prizePool(t: TournamentState): number {
  const { config } = t;
  return round2(
    t.registeredPlayers.length * (config.buyIn ?? 0) +
      countOf(t, 'rebuy') * poolShare(config.rebuys) +
      countOf(t, 'addOn') * poolShare(config.addOn)
  );
}

/** Every chip handed out: starting stacks, rebuys and add-ons. */
export function chipsInPlay(t: TournamentState): number {
  const { config } = t;
  return (
    t.registeredPlayers.length * config.startingStack +
    countOf(t, 'rebuy') * (config.rebuys?.stack ?? 0) +
    countOf(t, 'addOn') * (config.addOn?.stack ?? 0)
  );
}

export function remainingPlayers(t: TournamentState): string[] {
  return t.registeredPlayers.filter(p => !t.eliminatedPlayers.includes(p));
}

/** Prize for each paid place. With fewer entrants than paid places, the places that can't be reached share out their percentage. */
export function payoutTable(t: TournamentState): { place: number; percentage: number; amount: number }[] {
  const reachable = t.config.payoutStructure.filter(p => p.place <= Math.max(1, t.registeredPlayers.length));
  if (reachable.length === 0) return [];
  const amounts = buildPayouts(prizePool(t), reachable);
  return amounts.map(a => ({ ...a, percentage: reachable.find(p => p.place === a.place)!.percentage }));
}

export function bountyEnabled(config: TournamentConfig): boolean {
  return !!config.bounty && config.bounty.amount > 0;
}

/** Put a bounty on a player who entered or rebought; a rebuy while still in adds to their bounty. */
export function postBounty(t: TournamentState, userId: string): void {
  if (!bountyEnabled(t.config)) return;
  const bounties = (t.bounties = t.bounties || {});
  bounties[userId] = round2((bounties[userId] ?? 0) + t.config.bounty!.amount);
}

/**
 * Pay out the bounty on a knocked-out player. Standard: the player who knocked them out wins all
 * of it. Progressive: they win half in cash and the other half goes onto their own bounty.
 * Returns the cash won.
 */
export function settleKnockout(t: TournamentState, eliminated: string, by: string): number {
  if (!bountyEnabled(t.config)) return 0;
  const bounties = (t.bounties = t.bounties || {});
  const winnings = (t.bountyWinnings = t.bountyWinnings || {});
  const bounty = bounties[eliminated] ?? 0;
  delete bounties[eliminated];
  const cash = t.config.bounty!.type === 'progressive' ? round2(bounty / 2) : bounty;
  winnings[by] = round2((winnings[by] ?? 0) + cash);
  if (cash < bounty) bounties[by] = round2((bounties[by] ?? 0) + bounty - cash);
  return cash;
}

/** The winner collects the bounty on their own head. */
export function collectWinnerBounty(t: TournamentState, winner: string): void {
  if (!bountyEnabled(t.config)) return;
  const bounties = (t.bounties = t.bounties || {});
  const winnings = (t.bountyWinnings = t.bountyWinnings || {});
  const own = bounties[winner] ?? 0;
  delete bounties[winner];
  if (own > 0) winnings[winner] = round2((winnings[winner] ?? 0) + own);
}

/** All bounty money put up so far: one bounty per entry and per rebuy. */
export function bountyPool(t: TournamentState): number {
  if (!bountyEnabled(t.config)) return 0;
  return round2((t.registeredPlayers.length + countOf(t, 'rebuy')) * t.config.bounty!.amount);
}
