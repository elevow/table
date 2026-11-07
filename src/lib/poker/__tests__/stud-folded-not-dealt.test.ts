import { createPokerEngine } from '../engine-factory';
import { Player } from '../../../types/poker';

const P = (id: string, pos: number): Player => ({
  id,
  name: id,
  position: pos,
  stack: 500,
  currentBet: 0,
  hasActed: false,
  isFolded: false,
  isAllIn: false,
  timeBank: 30000,
});

function startHand(variant: 'seven-card-stud' | 'five-card-stud') {
  const engine = createPokerEngine({
    tableId: 'stud-folded',
    players: [P('a', 0), P('b', 1), P('c', 2)],
    smallBlind: 1,
    bigBlind: 2,
    state: { variant },
  });
  engine.startNewHand();
  const es = engine as any;
  const state = es.state as any;
  const cards = (id: string) => state.studState.playerCards[id];
  return { es, state, cards };
}

describe('stud streets skip folded players', () => {
  it.each(['seven-card-stud', 'five-card-stud'] as const)('deals no up card to a folded player in %s', variant => {
    const { es, state, cards } = startHand(variant);
    state.players[2].isFolded = true;
    const before = cards('c').upCards.length;

    es.dealStudUpCards(1);

    expect(cards('c').upCards).toHaveLength(before);
    expect(cards('a').upCards).toHaveLength(before + 1);
    expect(cards('b').upCards).toHaveLength(before + 1);
  });

  it('deals no seventh-street down card to a folded player', () => {
    const { es, state, cards } = startHand('seven-card-stud');
    state.players[2].isFolded = true;
    const before = cards('c').downCards.length;

    es.dealStudDownCards(1);

    expect(cards('c').downCards).toHaveLength(before);
    expect(cards('a').downCards).toHaveLength(before + 1);
    expect(cards('b').downCards).toHaveLength(before + 1);
  });

  it('still deals to a player who is all-in', () => {
    const { es, state, cards } = startHand('seven-card-stud');
    state.players[2].isAllIn = true;
    const before = cards('c').upCards.length;

    es.dealStudUpCards(1);

    expect(cards('c').upCards).toHaveLength(before + 1);
  });
});
