import { GameState, Player, Card, PlayerAction } from '../types/poker';

export class PokerEngine {
  private state: GameState;
  private deck: Card[];

  constructor(tableId: string, players: Player[]) {
    this.state = {
      tableId,
      stage: 'preflop',
      players,
      activePlayer: players[0].id,
      pot: 0,
      communityCards: [],
      currentBet: 0,
      dealerPosition: 0
    };
    this.deck = this.createDeck();
  }

  private createDeck(): Card[] {
    const suits = ['hearts', 'diamonds', 'clubs', 'spades'] as const;
    const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;
    const deck: Card[] = [];

    for (const suit of suits) {
      for (const rank of ranks) {
        deck.push({ suit, rank });
      }
    }

    return this.shuffle(deck);
  }

  private shuffle(deck: Card[]): Card[] {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  public dealHoleCards(): void {
    this.state.players.forEach(player => {
      if (!player.isFolded) {
        player.holeCards = [this.deck.pop()!, this.deck.pop()!];
      }
    });
  }

  public dealCommunityCards(count: number): void {
    for (let i = 0; i < count; i++) {
      this.state.communityCards.push(this.deck.pop()!);
    }
  }

  public handleAction(action: PlayerAction): void {
    // Validate action
    if (!this.isValidAction(action)) {
      throw new Error('Invalid action');
    }

    // Update game state
    this.updateGameState(action);

    // Move to next player or stage
    this.progressGame();
  }

  private isValidAction(action: PlayerAction): boolean {
    // Add action validation logic
    return true;
  }

  private updateGameState(action: PlayerAction): void {
    // Add state update logic
  }

  private progressGame(): void {
    // Add game progression logic
  }

  public getState(): GameState {
    return { ...this.state };
  }
}
