import {
  clearRunItState,
  determineRunItTwicePrompt,
  enrichStateWithRunIt,
  getRunItState,
  isAutoRunoutEligible,
  maybeCreateRunItPrompt,
  normalizeHandForComparison,
} from '../poker/run-it-twice-manager';
import { TableState, Player, Card } from '../../types/poker';

describe('run-it-twice-manager', () => {
  const tableId = 'rit-test';

  const flop: Card[] = [
    { rank: 'A', suit: 'hearts' },
    { rank: 'K', suit: 'spades' },
    { rank: 'Q', suit: 'diamonds' },
  ];
  const turn: Card = { rank: '2', suit: 'clubs' };

  const makePlayer = (overrides: Partial<Player>): Player => ({
    id: 'player',
    name: 'player',
    position: 0,
    stack: 1000,
    currentBet: 0,
    hasActed: true,
    isFolded: false,
    isAllIn: true,
    timeBank: 30000,
    ...overrides,
  });

  const makeState = (): TableState => ({
    tableId,
    stage: 'turn',
    players: [
      makePlayer({
        id: 'weak',
        holeCards: [
          { rank: '2', suit: 'hearts' },
          { rank: '7', suit: 'diamonds' },
        ],
      }),
      makePlayer({
        id: 'strong',
        position: 1,
        holeCards: [
          { rank: 'A', suit: 'clubs' },
          { rank: 'K', suit: 'clubs' },
        ],
      }),
    ],
    activePlayer: 'weak',
    pot: 500,
    communityCards: [...flop, turn],
    currentBet: 0,
    dealerPosition: 0,
    smallBlind: 5,
    bigBlind: 10,
    minRaise: 10,
    lastRaise: 0,
  });

  beforeEach(() => {
    clearRunItState(tableId);
  });

  it('locks community cards and stage when override is supplied', () => {
    const state = makeState();
    const prompt = maybeCreateRunItPrompt(tableId, state, {
      communityOverride: flop,
      boardVisibleCount: flop.length,
      stageOverride: 'flop',
    });

    expect(prompt).toBeTruthy();
    expect(prompt!.playerId).toBe('weak');
    expect(prompt!.boardCardsCount).toBe(flop.length);

    const meta = getRunItState(tableId);
    expect(meta.lockedCommunityCount).toBe(flop.length);
    expect(meta.lockedStage).toBe('flop');

    const enriched = enrichStateWithRunIt(tableId, state);
    expect(enriched.communityCards).toEqual(flop);
    expect(enriched.stage).toBe('flop');
    expect(enriched.activePlayer).toBe('weak');
  });

  it('includes highestHandDescription for the strongest hand player', () => {
    const state = makeState();
    const prompt = maybeCreateRunItPrompt(tableId, state, {
      communityOverride: flop,
      boardVisibleCount: flop.length,
      stageOverride: 'flop',
    });

    expect(prompt).toBeTruthy();
    // The weak player should make the decision (lowest hand)
    expect(prompt!.playerId).toBe('weak');
    // The handDescription should be the weak player's hand (lowest hand)
    expect(prompt!.handDescription).toBeDefined();
    // The highestHandDescription should be the strong player's hand
    expect(prompt!.highestHandDescription).toBeDefined();
    // The highest hand should be different from the lowest hand
    expect(prompt!.highestHandDescription).not.toBe(prompt!.handDescription);
    // Verify both players' hands are in handDescriptionsByPlayer
    expect(prompt!.handDescriptionsByPlayer?.['weak']).toBe(prompt!.handDescription);
    expect(prompt!.handDescriptionsByPlayer?.['strong']).toBe(prompt!.highestHandDescription);
  });

  it('does not mask board when no prompt exists', () => {
    const state = makeState();
    const enriched = enrichStateWithRunIt(tableId, state);
    expect(enriched.communityCards).toEqual(state.communityCards);
    expect(enriched.stage).toBe(state.stage);
  });

  it('normalizes short hand evaluations by padding cards', () => {
    const normalized = normalizeHandForComparison({
      hand: { rank: 2, description: 'Pair', cards: [{ value: 'A', suit: 'h' }] } as any,
      cards: [
        { rank: 'A', suit: 'hearts' },
        { rank: 'K', suit: 'hearts' },
      ],
    });

    expect(normalized.description).toBe('Pair');
    expect(normalized.cards).toHaveLength(5);
    const uniqueKeys = new Set(normalized.cards.map((c) => `${c.value}${c.suit}`));
    expect(uniqueKeys.size).toBe(normalized.cards.length);
  });

  it('evaluates auto-runout eligibility based on player state', () => {
    const state = makeState();
    state.players = state.players.map((p) => ({ ...p, isAllIn: false }));
    expect(isAutoRunoutEligible(state)).toBe(false); // no all-in yet

    state.players[0].isAllIn = true;
    state.players[1].isAllIn = true;
    expect(isAutoRunoutEligible(state)).toBe(true);

    state.players[1].isAllIn = false;
    state.players.push(makePlayer({ id: 'live', position: 2, isAllIn: false }));
    expect(isAutoRunoutEligible(state)).toBe(false); // betting still open (>1 non-all-in)
  });

  it('correctly identifies highest hand when comparing pair vs high card preflop', () => {
    // Bug: when no community cards, filler cards could corrupt hand comparison
    // causing pair to be incorrectly identified as weaker than high card
    const preflopState: TableState = {
      tableId,
      stage: 'preflop',
      players: [
        makePlayer({
          id: 'player-9high',
          holeCards: [
            { rank: '9', suit: 'hearts' },
            { rank: '3', suit: 'spades' },
          ],
        }),
        makePlayer({
          id: 'player-pair4s',
          position: 1,
          holeCards: [
            { rank: '4', suit: 'clubs' },
            { rank: '4', suit: 'diamonds' },
          ],
        }),
      ],
      activePlayer: 'player-9high',
      pot: 500,
      communityCards: [], // No community cards (preflop all-in)
      currentBet: 0,
      dealerPosition: 0,
      smallBlind: 5,
      bigBlind: 10,
      minRaise: 10,
      lastRaise: 0,
    };

    const prompt = determineRunItTwicePrompt(preflopState, []);
    expect(prompt).toBeTruthy();
    // Player with 9-high should be the weakest (gets the decision)
    expect(prompt!.playerId).toBe('player-9high');
    // The highest hand should be the pair, not the 9-high
    expect(prompt!.highestHandDescription).toMatch(/pair/i);
    expect(prompt!.handDescriptionsByPlayer?.['player-pair4s']).toMatch(/pair/i);
    expect(prompt!.handDescriptionsByPlayer?.['player-9high']).toMatch(/nine.*high/i);
  });

  it('correctly identifies 10 high as stronger than 6 high preflop', () => {
    // Bug: when comparing two high cards (same rank), filler cards corrupt comparison
    const preflopState: TableState = {
      tableId,
      stage: 'preflop',
      players: [
        makePlayer({
          id: 'player21-6high',
          holeCards: [
            { rank: '6', suit: 'diamonds' },
            { rank: '2', suit: 'spades' },
          ],
        }),
        makePlayer({
          id: 'player55-10high',
          position: 1,
          holeCards: [
            { rank: '10', suit: 'clubs' },
            { rank: '4', suit: 'hearts' },
          ],
        }),
      ],
      activePlayer: 'player21-6high',
      pot: 500,
      communityCards: [], // No community cards (preflop all-in)
      currentBet: 0,
      dealerPosition: 0,
      smallBlind: 5,
      bigBlind: 10,
      minRaise: 10,
      lastRaise: 0,
    };

    const prompt = determineRunItTwicePrompt(preflopState, []);
    expect(prompt).toBeTruthy();
    // Player with 6-high should be the weakest (gets the decision)
    expect(prompt!.playerId).toBe('player21-6high');
    // The highest hand should be 10 high, not 6 high
    expect(prompt!.highestHandDescription).toMatch(/ten.*high/i);
    expect(prompt!.handDescriptionsByPlayer?.['player55-10high']).toMatch(/ten.*high/i);
    expect(prompt!.handDescriptionsByPlayer?.['player21-6high']).toMatch(/six.*high/i);
  });
});
