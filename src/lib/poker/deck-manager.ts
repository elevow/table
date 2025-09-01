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

  // US-031: Snapshot the remaining deck (top of deck is at the end, since we pop())
  public getRemainingDeck(): Card[] {
    return [...this.deck];
  }

  // US-029: Helper to create an ad-hoc deck excluding given cards (e.g., for run-it-twice)
  public static fromExcluding(exclude: Card[], seed?: number): DeckManager {
    const dm = new DeckManager();
    const suits = ['hearts', 'diamonds', 'clubs', 'spades'] as const;
    const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;
    const excluded = new Set(exclude.map(c => `${c.rank}-${c.suit}`));
    const full: Card[] = [];
    for (const suit of suits) {
      for (const rank of ranks) {
        const key = `${rank}-${suit}`;
        if (!excluded.has(key)) full.push({ suit, rank });
      }
    }
    // Deterministic shuffle if seed provided; else random
    dm.deck = full;
    if (seed !== undefined) {
      // Simple LCG-based shuffle for determinism within tests
      let s = seed || 1;
      for (let i = dm.deck.length - 1; i > 0; i--) {
        s = (s * 1664525 + 1013904223) >>> 0;
        const j = s % (i + 1);
        [dm.deck[i], dm.deck[j]] = [dm.deck[j], dm.deck[i]];
      }
    } else {
      // randomize a bit
      for (let i = dm.deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [dm.deck[i], dm.deck[j]] = [dm.deck[j], dm.deck[i]];
      }
    }
    return dm;
  }
}
