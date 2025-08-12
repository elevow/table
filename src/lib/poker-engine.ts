import { TableState, Player, Card, GameStage, PlayerAction, HandResult, BettingRound } from '../types/poker';
import { HandEvaluator } from './hand-evaluator';

export class PokerEngine {
  private state: TableState;
  private deck: Card[];
  private bettingRound: BettingRound | null;

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
    this.deck = [];
    this.bettingRound = null;
  }

  public startNewHand(): void {
    this.resetDeck();
    this.resetPlayerStates();
    this.rotateDealerButton();
    this.dealHoleCards();
    this.postBlinds();
    this.startBettingRound('preflop');
  }

  private resetDeck(): void {
    const suits = ['hearts', 'diamonds', 'clubs', 'spades'] as const;
    const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;
    this.deck = [];

    for (const suit of suits) {
      for (const rank of ranks) {
        this.deck.push({ suit, rank });
      }
    }

    this.shuffleDeck();
  }

  private shuffleDeck(): void {
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  private resetPlayerStates(): void {
    this.state.players.forEach(player => {
      player.holeCards = undefined;
      player.currentBet = 0;
      player.hasActed = false;
      player.isFolded = false;
      player.isAllIn = false;
    });
    this.state.pot = 0;
    this.state.currentBet = 0;
    this.state.communityCards = [];
  }

  private rotateDealerButton(): void {
    this.state.dealerPosition = (this.state.dealerPosition + 1) % this.state.players.length;
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
        const card = this.deck.pop();
        if (card) {
          player.holeCards.push(card);
        }
      }
    }
  }

  private postBlinds(): void {
    // Find players by position
    const smallBlindPlayer = this.state.players.find(p => p.position === 1);  // SB is always position 1
    if (!smallBlindPlayer) throw new Error('Could not find small blind player');
    this.placeBet(smallBlindPlayer, this.state.smallBlind);

    // Post big blind
    const bigBlindPlayer = this.state.players.find(p => p.position === 2);  // BB is always position 2
    if (!bigBlindPlayer) throw new Error('Could not find big blind player');
    this.placeBet(bigBlindPlayer, this.state.bigBlind);

    this.state.currentBet = this.state.bigBlind;
    this.state.minRaise = this.state.bigBlind;
  }

  private placeBet(player: Player, amount: number): void {
    const actualBet = Math.min(amount, player.stack);
    player.stack -= actualBet;
    player.currentBet += actualBet;
    this.state.pot += actualBet;

    if (player.stack === 0) {
      player.isAllIn = true;
    }
  }

  private startBettingRound(stage: GameStage): void {
    this.state.stage = stage;
    const startPosition = stage === 'preflop' ? 
      0 : // UTG starts after dealer in preflop
      1;  // SB starts in other rounds

    this.bettingRound = {
      stage,
      startPosition,
      activePosition: startPosition,
      minBet: this.state.bigBlind,
      currentBet: this.state.currentBet,
      lastRaise: 0
    };

    const activePlayer = this.state.players.find(p => p.position === startPosition);
    if (!activePlayer) throw new Error('Could not find active player');
    this.state.activePlayer = activePlayer.id;
  }

  private dealCommunityCards(count: number): void {
    for (let i = 0; i < count; i++) {
      const card = this.deck.pop();
      if (card) {
        this.state.communityCards.push(card);
      }
    }
  }

  public handleAction(action: PlayerAction): void {
    if (!this.bettingRound || action.playerId !== this.state.activePlayer) {
      throw new Error('Invalid action: not player\'s turn');
    }

    const player = this.state.players.find(p => p.id === action.playerId);
    if (!player) {
      throw new Error('Player not found');
    }

    this.processAction(player, action);
    this.moveToNextPlayer();
  }

  private processAction(player: Player, action: PlayerAction): void {
    switch (action.type) {
      case 'fold':
        player.isFolded = true;
        player.hasActed = true;
        break;

      case 'call':
        const callAmount = this.state.currentBet - player.currentBet;
        this.placeBet(player, callAmount);
        player.hasActed = true;
        break;

      case 'raise':
        if (!action.amount) {
          throw new Error('Raise amount is required');
        }
        const raiseAmount = action.amount - this.state.currentBet;
        if (raiseAmount < this.state.minRaise) {
          throw new Error('Invalid raise amount');
        }
        this.placeBet(player, action.amount);
        this.state.currentBet = player.currentBet;
        this.state.lastRaise = raiseAmount;
        this.state.minRaise = raiseAmount;
        player.hasActed = true;
        break;

      case 'check':
        if (this.state.currentBet > player.currentBet) {
          throw new Error('Cannot check when there is a bet');
        }
        player.hasActed = true;
        break;
    }
  }

  private moveToNextPlayer(): void {
    if (!this.bettingRound) return;

    do {
      this.bettingRound.activePosition = 
        (this.bettingRound.activePosition + 1) % this.state.players.length;
      
      const nextPlayer = this.state.players.find(p => p.position === this.bettingRound!.activePosition);
      if (!nextPlayer) throw new Error('Could not find next player');

      if (!nextPlayer.isFolded && !nextPlayer.isAllIn && 
          (!nextPlayer.hasActed || nextPlayer.currentBet < this.state.currentBet)) {
        this.state.activePlayer = nextPlayer.id;
        return;
      }

      // If we've gone around the table and everyone has acted, move to next stage
      if (this.bettingRound.activePosition === this.bettingRound.startPosition) {
        this.moveToNextStage();
        return;
      }
    } while (true);
  }

  private moveToNextStage(): void {
    const stages: GameStage[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];
    const currentIndex = stages.indexOf(this.state.stage);
    
    if (currentIndex < stages.length - 1) {
      const nextStage = stages[currentIndex + 1];
      
      // Deal community cards based on the stage
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

      this.startBettingRound(nextStage);
    }
  }

  private determineWinner(): void {
    const activePlayers = this.state.players.filter(p => !p.isFolded);
    
    // If only one player remains, they win
    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      this.distributeWinnings([{
        playerId: winner.id,
        hand: winner.holeCards || [],
        description: 'Win by fold',
        strength: 0,
        winAmount: this.state.pot
      }]);
      return;
    }

    // Get winners using hand evaluator
    const winners = HandEvaluator.determineWinners(
      activePlayers.map(p => ({ id: p.id, holeCards: p.holeCards || [] })),
      this.state.communityCards
    );

    // Split pot evenly among winners
    const winAmount = Math.floor(this.state.pot / winners.length);
    winners.forEach(w => w.winAmount = winAmount);

    this.distributeWinnings(winners);
  }

  private distributeWinnings(results: HandResult[]): void {
    // Update player stacks with winnings
    results.forEach(result => {
      const player = this.state.players.find(p => p.id === result.playerId);
      if (player) {
        player.stack += result.winAmount;
      }
    });

    // Reset pot
    this.state.pot = 0;
  }

  public getState(): TableState {
    return { ...this.state };
  }
}
