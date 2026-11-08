import { runItVoters, tallyRunItVotes } from '../run-it-vote';

describe('runItVoters', () => {
  it('is everyone still in the hand', () => {
    expect(runItVoters({ playerId: 'a', eligiblePlayerIds: ['a', 'b', 'c'] })).toEqual(['a', 'b', 'c']);
  });

  it('is the one chooser for prompts saved before votes', () => {
    expect(runItVoters({ playerId: 'a', eligiblePlayerIds: [] })).toEqual(['a']);
    expect(runItVoters({ playerId: 'a' } as any)).toEqual(['a']);
  });
});

describe('tallyRunItVotes', () => {
  const voters = ['a', 'b', 'c'];

  it('waits until everyone has voted', () => {
    expect(tallyRunItVotes(voters, { a: 2, b: 2 })).toEqual({ runs: null, waitingFor: ['c'] });
  });

  it('runs it more than once only when everyone agrees, as many times as the fewest chose', () => {
    expect(tallyRunItVotes(voters, { a: 2, b: 2, c: 2 }).runs).toBe(2);
    expect(tallyRunItVotes(voters, { a: 3, b: 2, c: 3 }).runs).toBe(2);
  });

  it('runs it once as soon as anyone votes for one run, without waiting for the rest', () => {
    expect(tallyRunItVotes(voters, { a: 2, b: 1 })).toEqual({ runs: 1, waitingFor: ['c'] });
  });

  it('ignores votes from players who are not in the vote', () => {
    expect(tallyRunItVotes(['a', 'b'], { a: 2, b: 2, z: 1 }).runs).toBe(2);
  });
});
