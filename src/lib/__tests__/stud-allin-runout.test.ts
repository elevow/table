import { createPokerEngine } from '../poker/engine-factory';
import { runSupabaseAutoRunoutSync } from '../poker/supabase-auto-runout';
import { Player } from '../../types/poker';

const P = (id: string, pos: number, stack: number): Player => ({
  id, name: id, position: pos, stack, currentBet: 0,
  hasActed: false, isFolded: false, isAllIn: false, timeBank: 30000,
});

describe('Stud all-in runout', () => {
  it('broadcasts each remaining street separately, waiting between them, then the showdown', async () => {
    const engine = createPokerEngine({ tableId: 'stud-runout', players: [P('a', 1, 5), P('b', 2, 100)], smallBlind: 1, bigBlind: 2, state: { variant: 'seven-card-stud' } });
    engine.startNewHand();
    // Both players commit everything on third street
    const st = (engine as any).state;
    st.players.forEach((p: Player) => { p.stack = 0; p.isAllIn = true; p.currentBet = 5; p.hasActed = true; });
    st.pot = 10;
    st.currentBet = 5;
    st.handStartStacks = { a: 5, b: 5 };

    // Record what each broadcast showed at the moment it was sent
    const upCounts: number[] = [];
    const broadcast = jest.fn(async (state: any) => { upCounts.push(state.studState.playerCards.a.upCards.length); });
    jest.useFakeTimers();
    try {
      const run = runSupabaseAutoRunoutSync('stud-runout', engine as any, broadcast, 3000);
      await jest.advanceTimersByTimeAsync(2999);
      expect(broadcast).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      expect(broadcast).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(3000 * 4);
      expect(await run).toBe(true);
    } finally {
      jest.useRealTimers();
    }

    expect(broadcast.mock.calls.map((c: any[]) => c[1].action)).toEqual([
      'auto_runout_fourth', 'auto_runout_fifth', 'auto_runout_sixth', 'auto_runout_seventh', 'auto_runout_showdown',
    ]);
    expect(upCounts.slice(0, 4)).toEqual([2, 3, 4, 4]);
    const final = engine.getState();
    expect(final.stage).toBe('showdown');
    expect(final.players.reduce((sum, p) => sum + p.stack, 0)).toBe(10);
  });
});
