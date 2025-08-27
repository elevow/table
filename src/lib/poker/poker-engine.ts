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
  private debugEnabled: boolean;

  constructor(tableId: string, players: Player[], smallBlind: number, bigBlind: number) {
    this.debugEnabled = process.env.DEBUG_POKER === 'true';
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

  // Private logging methods that respect environment variables
  private log(message: string, ...args: any[]): void {
    if (this.debugEnabled) {
      // console.log(`[DEBUG] ${message}`, ...args);
    }
  }
  
  private error(message: string, ...args: any[]): void {
    // Only log errors in non-CI environments or when DEBUG_POKER is set
    if (!process.env.CI || this.debugEnabled) {
      console.error(`[ERROR] ${message}`, ...args);
    }
  }

  private addToPot(amount: number): void {
    this.log(`Adding ${amount} to pot (current: ${this.state.pot})`);
    this.state.pot += amount;
    this.log(`New pot total: ${this.state.pot}`);
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
    this.log(`-------- Posting Blinds --------`);
    this.log(`Before blinds:`, this.state.players.map(p => ({
      id: p.id,
      stack: p.stack,
      bet: p.currentBet
    })));
    
    const { pot, currentBet } = this.bettingManager.postBlinds(this.state.players);
    this.log(`Blind amounts: pot=${pot}, currentBet=${currentBet}`);
    
    // Add blind bets to pot
    if (pot > 0) {
      this.addToPot(pot);
    }
    this.state.currentBet = currentBet;
    this.state.minRaise = currentBet;
    
    this.log(`After blinds:`, this.state.players.map(p => ({
      id: p.id,
      stack: p.stack,
      bet: p.currentBet
    })));
    this.log(`Pot: ${this.state.pot}, Current bet: ${this.state.currentBet}, Min raise: ${this.state.minRaise}`);
  }

  public handleAction(action: PlayerAction): void {
    this.log(`Handling action ${action.type} from ${action.playerId} for amount ${action.amount}`);
    this.log(`Before action - pot: ${this.state.pot}, currentBet: ${this.state.currentBet}, minRaise: ${this.state.minRaise}`);
    this.log(`Player states:`, this.state.players.map(p => ({
      id: p.id,
      stack: p.stack,
      bet: p.currentBet,
      isFolded: p.isFolded
    })));

    const player = this.state.players.find(p => p.id === action.playerId);
    if (!player) {
      throw new Error('Player not found');
    }

    if (action.playerId !== this.state.activePlayer) {
      throw new Error('Invalid action: not player\'s turn');
    }

    // Save player's current bet amount before processing action
    const oldBet = player.currentBet;
    
    // Process the action
    const { pot, currentBet, minRaise } = this.bettingManager.processAction(
      player,
      action,
      this.state.currentBet,
      this.state.minRaise
    );

    // Update state and add new contribution to pot if any
    if ((action.type === 'call' || action.type === 'raise') && pot > 0) {
      // Only add the difference between new bet and old bet
      this.log(`Processing bet: oldBet=${oldBet}, newBet=${player.currentBet}, potContribution=${pot}`);
      if (pot > 0) {
        this.addToPot(pot);
        this.log(`Added ${pot} to pot from player ${player.id} (old bet: ${oldBet}, new bet: ${player.currentBet}, new total pot: ${this.state.pot})`);
      }
    } else if (action.type === 'fold') {
      // When folding, current bet stays in place (doesn't go to pot yet)
      this.log(`Player ${player.id} folded with current bet of ${player.currentBet}`);
    }

    this.state.currentBet = currentBet;
    this.state.minRaise = minRaise;

    // Find next player or move to next stage
    const nextPlayer = this.gameStateManager.findNextActivePlayer(player.position);
    
    if (nextPlayer) {
      this.state.activePlayer = nextPlayer.id;
    } else {
      // Check if only one player remains (win by fold)
      const activePlayers = this.state.players.filter(p => !p.isFolded);
      if (activePlayers.length === 1) {
        this.determineWinner();
        return;
      }

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
      this.log(`-------- Win by Fold --------`);
      this.log(`Initial state:`);
      this.log(`- Pot: ${this.state.pot}`);
      this.log(`- Current bets: ${this.state.players.map(p => `${p.id}: ${p.currentBet}`).join(', ')}`);
      this.log(`- Player stacks: ${this.state.players.map(p => `${p.id}: ${p.stack}`).join(', ')}`);

      // Winner gets the entire pot plus their own bet back
      const totalWinnings = this.state.pot;
      this.log(`Stack before winnings: ${winner.id} had ${winner.stack}`);
      winner.stack += totalWinnings;
      this.log(`Stack after winnings: ${winner.id} now has ${winner.stack}`);

      // Clear current bets and pot
      this.state.players.forEach(p => {
        this.log(`Clearing bet for player ${p.id}: ${p.currentBet} -> 0`);
        p.currentBet = 0;
      });
      this.log(`Clearing pot: ${this.state.pot} -> 0`);
      this.state.pot = 0;

      // Set stage to indicate hand is over
      this.state.stage = 'showdown';
      this.state.activePlayer = '';

      // Debug: verify total chips
      const totalChips = this.state.players.reduce((sum, p) => sum + p.stack, 0);
      this.log(`Win by fold - Awarded pot to winner ${winner.id} (final stack: ${winner.stack})`);
      this.log(`Total chips after win by fold: ${totalChips}`);
      return;
    }

    // Evaluate hands and determine winners
    const playerHands = activePlayers.map(player => ({
      playerId: player.id,
      evaluation: HandEvaluator.evaluateHand(player.holeCards || [], this.state.communityCards)
    }));

    this.log(`Player hands evaluated: ${JSON.stringify(playerHands.map(ph => ({
      playerId: ph.playerId,
      description: ph.evaluation.hand.description,
      rank: ph.evaluation.hand.rank
    })))}`);

    // Find the winning hand(s)
    const winners = playerHands.filter(ph => 
      !playerHands.some(other => 
        ph !== other && HandEvaluator.compareHands(other.evaluation.hand, ph.evaluation.hand) > 0
      )
    );

    this.log(`Winners determined: ${JSON.stringify(winners.map(w => w.playerId))}`);

    // Calculate winnings using pot calculator
    const results: HandResult[] = winners.map(w => ({
      playerId: w.playerId,
      hand: w.evaluation.cards,
      description: w.evaluation.hand.description,
      strength: w.evaluation.hand.rank,
      winAmount: 0
    }));

    this.log(`-------- Showdown --------`);
    this.log(`Initial state:`);
    this.log(`- Pot: ${this.state.pot}`);
    this.log(`- Current bets: ${this.state.players.map(p => `${p.id}: ${p.currentBet}`).join(', ')}`);
    this.log(`- Player stacks: ${this.state.players.map(p => `${p.id}: ${p.stack}`).join(', ')}`);

    // First verify total chips in play (pot already includes all bets, so only count stacks + pot)
    const initialTotal = this.state.players.reduce((sum, p) => sum + p.stack, 0) + this.state.pot;
    this.log(`Total chips before distribution: ${initialTotal}`);

    // The pot already contains all bets, so we just need to distribute it
    const totalPrizePool = this.state.pot;
    this.log(`Total prize pool: ${totalPrizePool}`);

    // Clear all current bets and pot
    this.state.players.forEach(p => {
        this.log(`Clearing bet for player ${p.id}: ${p.currentBet} -> 0`);
        p.currentBet = 0;
      });
      this.state.pot = 0;

      // Calculate prize per winner
      const prizePerWinner = Math.floor(totalPrizePool / winners.length);
      const remainder = totalPrizePool % winners.length;  // Handle any remainder chips

      this.log(`Total prize pool: ${totalPrizePool}, Winners: ${winners.length}`);
      this.log(`Each winner gets: ${prizePerWinner} + ${remainder} remainder to last winner`);

      results.forEach((result, index) => {
        const player = this.state.players.find(p => p.id === result.playerId);
        if (player) {
          // Last winner gets any remainder chips
          const winAmount = index === winners.length - 1 ? prizePerWinner + remainder : prizePerWinner;
          player.stack += winAmount;
          result.winAmount = winAmount;
          this.log(`Awarded ${winAmount} to winner ${player.id} (stack now: ${player.stack})`);
        }
      });

      // Check that pot was properly distributed
      const finalTotal = this.state.players.reduce((sum, p) => sum + p.stack, 0);
      this.log(`Total chips after distribution: ${finalTotal} (should equal initial ${initialTotal})`);

      if (finalTotal !== initialTotal) {
        this.error(`Chip count mismatch! Lost ${initialTotal - finalTotal} chips in distribution.`);
        // Fix: If there are no winners, give the pot to one player to maintain chip conservation
        if (winners.length === 0 && totalPrizePool > 0) {
          const firstActivePlayer = this.state.players.find(p => !p.isFolded);
          if (firstActivePlayer) {
            firstActivePlayer.stack += totalPrizePool;
            this.log(`No hand winner detected. Giving pot to player ${firstActivePlayer.id} to maintain chip count.`);
          }
        }
      }

      // Set stage to indicate hand is over
      this.state.activePlayer = '';
  }

  public getState(): TableState {
    return { ...this.state };
  }
}
