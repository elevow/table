import { TableState, Player, Card, GameStage, PlayerAction, HandResult } from '../../types/poker';
import { HandEvaluator } from './hand-evaluator';
import { PotCalculator } from './pot-calculator';
import { DeckManager } from './deck-manager';
import { BettingManager } from './betting-manager';
import { GameStateManager } from './game-state-manager';

export class PokerEngine {
  private state: TableState;
  private deckManager: DeckManager;
  private bettingManager: BettingManager;
  private gameStateManager: GameStateManager;

  constructor(tableId: string, players: Player[], smallBlind: number, bigBlind: number) {
    this.state = {
      tableId,
      stage: 'preflop',
      players,
      activePlayer: '',
      pot: 0,
      communityCards: [],
      currentBet: 0,
      dealerPosition: 0,
      smallBlind,
      bigBlind,
      minRaise: bigBlind,
      lastRaise: 0
    };

    this.deckManager = new DeckManager();
    this.bettingManager = new BettingManager(smallBlind, bigBlind);
    this.gameStateManager = new GameStateManager(this.state);
  }

  public startNewHand(): void {
    this.deckManager.resetDeck();
    this.gameStateManager.resetPlayerStates();
    this.gameStateManager.rotateDealerButton();
    this.dealHoleCards();
    this.postBlinds();
    this.gameStateManager.startBettingRound('preflop');
  }

  private dealHoleCards(): void {
    // Deal 2 cards to each player in order
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < this.state.players.length; i++) {
        const playerPosition = (this.state.dealerPosition + 1 + i) % this.state.players.length;
        const player = this.state.players[playerPosition];
        
        if (!player.holeCards) {
          player.holeCards = [];
        }
        const card = this.deckManager.dealCard();
        if (card) {
          player.holeCards.push(card);
        }
      }
    }
  }

  private postBlinds(): void {
    const { pot, currentBet } = this.bettingManager.postBlinds(this.state.players);
    this.state.pot = pot;
    this.state.currentBet = currentBet;
    this.state.minRaise = currentBet;
  }

  public handleAction(action: PlayerAction): void {
    const player = this.state.players.find(p => p.id === action.playerId);
    if (!player) {
      throw new Error('Player not found');
    }

    if (action.playerId !== this.state.activePlayer) {
      throw new Error('Invalid action: not player\'s turn');
    }

    // Process the action and update bets
    const { pot, currentBet, minRaise } = this.bettingManager.processAction(
      player,
      action,
      this.state.currentBet,
      this.state.minRaise
    );

    // Update state with action results
    this.state.pot += pot;
    this.state.currentBet = currentBet;
    this.state.minRaise = minRaise;

    // Find next player or move to next stage
    const nextPlayer = this.gameStateManager.findNextActivePlayer(player.position);
    
    if (nextPlayer) {
      this.state.activePlayer = nextPlayer.id;
    } else {
      const nextStage = this.gameStateManager.moveToNextStage();
      
      switch (nextStage) {
        case 'flop':
          this.dealCommunityCards(3);
          break;
        case 'turn':
        case 'river':
          this.dealCommunityCards(1);
          break;
        case 'showdown':
          this.determineWinner();
          return;
      }

      this.gameStateManager.startBettingRound(nextStage);
    }
  }

  private dealCommunityCards(count: number): void {
    const cards = this.deckManager.dealCards(count);
    this.state.communityCards.push(...cards);
  }

  private determineWinner(): void {
    const activePlayers = this.state.players.filter(p => !p.isFolded);
    
    // If only one player remains, they win
    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      // Calculate total pot including all current bets
      const totalPot = this.state.pot + this.state.players.reduce((sum, p) => sum + p.currentBet, 0);
      winner.stack += totalPot;
      // Reset bets and pot
      this.state.players.forEach(p => p.currentBet = 0);
      this.state.pot = 0;
      return;
    }

    // Evaluate hands and determine winners
    const playerHands = activePlayers.map(player => ({
      playerId: player.id,
      evaluation: HandEvaluator.evaluateHand(player.holeCards || [], this.state.communityCards)
    }));

    // Find the winning hand(s)
    const winners = playerHands.filter(ph => 
      !playerHands.some(other => 
        ph !== other && HandEvaluator.compareHands(other.evaluation.hand, ph.evaluation.hand) > 0
      )
    );

    // Calculate winnings using pot calculator
    const results: HandResult[] = winners.map(w => ({
      playerId: w.playerId,
      hand: w.evaluation.cards,
      description: w.evaluation.hand.description,
      strength: w.evaluation.hand.rank,
      winAmount: 0
    }));

    // Calculate side pots and distribute
    const sidePots = PotCalculator.calculateSidePots(this.state.players);
    PotCalculator.distributePots(sidePots, results);

    // Add remaining bets to winners
    const remainingPot = this.state.pot + this.state.players.reduce((sum, p) => sum + p.currentBet, 0);
    const winnerShare = Math.floor(remainingPot / results.length);
    results.forEach(result => {
      const player = this.state.players.find(p => p.id === result.playerId);
      if (player) {
        player.stack += winnerShare;
      }
    });

    // Reset state
    this.state.players.forEach(p => p.currentBet = 0);
    this.state.pot = 0;
  }

  public getState(): TableState {
    return { ...this.state };
  }
}
