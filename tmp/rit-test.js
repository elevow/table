require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { determineRunItTwicePrompt, normalizeHandForComparison } = require('../src/lib/poker/run-it-twice-manager.ts');
const { HandEvaluator } = require('../src/lib/poker/hand-evaluator.ts');

const makeState = (p1, p2) => ({
  communityCards: [],
  variant: 'texas-holdem',
  players: [p1, p2],
});

const scenarios = [
  makeState(
    { id: 'p1', holeCards: [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'hearts' }], isFolded: false },
    { id: 'p2', holeCards: [{ rank: 'Q', suit: 'clubs' }, { rank: 'Q', suit: 'diamonds' }], isFolded: false }
  ),
  makeState(
    { id: 'p1', holeCards: [{ rank: 'Q', suit: 'clubs' }, { rank: 'Q', suit: 'diamonds' }], isFolded: false },
    { id: 'p2', holeCards: [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'hearts' }], isFolded: false }
  ),
];

scenarios.forEach((state, idx) => {
  console.log('\nScenario', idx + 1);
  state.players.forEach((p) => {
  const evalResult = HandEvaluator.evaluateHand(p.holeCards, state.communityCards);
  const normalized = normalizeHandForComparison(evalResult);
  console.log(p.id, normalized.description, normalized.cards);
  });

  const prompt = determineRunItTwicePrompt(state);
  console.log('prompt', prompt);
});
