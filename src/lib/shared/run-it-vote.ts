/**
 * Run it twice is a vote among everyone still in the hand: the board runs more than once only if
 * all of them agree, and then as many times as the fewest anyone chose. Any vote for one run
 * settles it at once.
 */
import type { RunItTwicePrompt } from '../../types/poker';

/** Who votes: everyone still in. Prompts saved before votes had only the one chooser. */
export function runItVoters(prompt: Pick<RunItTwicePrompt, 'playerId' | 'eligiblePlayerIds'>): string[] {
  return Array.isArray(prompt.eligiblePlayerIds) && prompt.eligiblePlayerIds.length > 0
    ? prompt.eligiblePlayerIds
    : [prompt.playerId];
}

/** The number of runs once it's decided (null while votes are missing), and who hasn't voted. */
export function tallyRunItVotes(voters: string[], votes: Record<string, number>): { runs: number | null; waitingFor: string[] } {
  const waitingFor = voters.filter(id => typeof votes[id] !== 'number');
  const cast = voters.map(id => votes[id]).filter((n): n is number => typeof n === 'number');
  if (cast.some(n => n <= 1)) return { runs: 1, waitingFor };
  if (waitingFor.length > 0) return { runs: null, waitingFor };
  return { runs: Math.min(...cast), waitingFor };
}
