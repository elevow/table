import { HandEvaluator } from '../src/lib/poker/hand-evaluator';
import { Card } from '../src/types/poker';

const card = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

const h1 = HandEvaluator.evaluateHand([card('A','spades'), card('K','spades')], [card('2','hearts'), card('3','hearts'), card('4','clubs')]).hand;
const h2 = HandEvaluator.evaluateHand([card('Q','hearts'), card('Q','clubs')], [card('2','diamonds'), card('3','clubs'), card('4','hearts')]).hand;

console.log('cmp h1 vs h2', HandEvaluator.compareHands(h1, h2));
console.log('cmp h2 vs h1', HandEvaluator.compareHands(h2, h1));
