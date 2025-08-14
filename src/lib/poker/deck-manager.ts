import { Card } from '../../types/poker';

export class DeckManager {
  private deck: Card[] = [];

  public resetDeck(): void {
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

  public dealCard(): Card | undefined {
    return this.deck.pop();
  }

  public dealCards(count: number): Card[] {
    const cards: Card[] = [];
    for (let i = 0; i < count; i++) {
      const card = this.dealCard();
      if (card) {
        cards.push(card);
      }
    }
    return cards;
  }
}
