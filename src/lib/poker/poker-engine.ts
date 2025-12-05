import { TableState, Player, Card, GameStage, PlayerAction, HandResult, HandRanking } from '../../types/poker';
import { RunItTwiceOutcomeInput } from '../../types/game-history';
import { HandEvaluator } from './hand-evaluator';
import { PotCalculator } from './pot-calculator';
import { DeckManager } from './deck-manager';
import { BettingManager } from './betting-manager';
import { generateRngSecurity, verifyRngSecurity, RNGSecurity } from './rng-security';
import { GameStateManager } from './game-state-manager';

export class PokerEngine {
  private state: TableState;
  private deckManager: DeckManager;
  private bettingManager: BettingManager;
  private gameStateManager: GameStateManager;
  private debugEnabled: boolean;
  // Players marked for removal at the next hand start
  private removedPlayers: Set<string> = new Set();
  // Tracks how many community cards have been previewed (rabbit hunt) this hand
  private rabbitPreviewed: number = 0;
  // Optional RIT persistence hook
  private ritPersistence?: { handId?: string; onOutcome?: (input: RunItTwiceOutcomeInput) => Promise<void> };
  // Optional unanimous-consent requirement and consent tracking for RIT
  private requireRitUnanimous: boolean = false;
  private ritConsents: Set<string> = new Set();
  
  // Optional engine options to configure behavior such as betting mode
  public static defaultOptions = {
    bettingMode: 'no-limit' as 'no-limit' | 'pot-limit',
    runItTwicePersistence: undefined as | { handId?: string; onOutcome?: (input: RunItTwiceOutcomeInput) => Promise<void> } | undefined,
  requireRunItTwiceUnanimous: false as boolean,
  variant: undefined as undefined | 'texas-holdem' | 'omaha' | 'omaha-hi-lo' | 'seven-card-stud' | 'seven-card-stud-hi-lo' | 'five-card-stud',
  };

  constructor(tableId: string, players: Player[], smallBlind: number, bigBlind: number, options?: Partial<typeof PokerEngine.defaultOptions>) {
    this.debugEnabled = process.env.DEBUG_POKER === 'true';
    const opts = { ...PokerEngine.defaultOptions, ...(options || {}) };
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
    // Only set bettingMode on state when not default to preserve backward-compat visuals/equality
    if (opts.bettingMode !== 'no-limit') {
      this.state.bettingMode = opts.bettingMode;
    }
    // Set variant on state only when provided (keep undefined as default Hold'em)
    if (opts.variant) {
      this.state.variant = opts.variant;
    }
  // Configure optional RIT persistence
  this.ritPersistence = opts.runItTwicePersistence;
    // Configure unanimous-consent toggle
    this.requireRitUnanimous = !!opts.requireRunItTwiceUnanimous;

    this.deckManager = new DeckManager();
    this.bettingManager = new BettingManager(smallBlind, bigBlind);
    // Apply betting mode to betting manager
    this.bettingManager.setMode(opts.bettingMode);
    this.gameStateManager = new GameStateManager(this.state);
  }

  // Treat a player as inactive if either engine or external flag marks them folded
  private isPlayerActive(p: Player): boolean {
    return !(p as any).folded && !p.isFolded;
  }
  private getActivePlayers(): Player[] {
    return this.state.players.filter(p => this.isPlayerActive(p));
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

  // US-031: Prepare deck/state for rabbit-hunt previews without starting a hand
  // Optionally exclude known cards (e.g., mucked holes, burned cards) and seed community snapshot
  public prepareRabbitPreview(opts?: { community?: Card[]; known?: Card[]; seed?: number }): void {
    const community = opts?.community ?? [];
    const known = opts?.known ?? [];
    // Build a fresh deck excluding known + community
    const excludes = [...known, ...community];
    const dm = DeckManager.fromExcluding(excludes, opts?.seed);
    this.deckManager = dm;
    // Seed current community snapshot
    this.state.communityCards = [...community];
    // Reset preview tracker
    this.rabbitPreviewed = 0;
  }

  // US-031: Compute Rabbit Hunt reveal for a given street and provide remaining deck snapshot
  public previewRabbitHunt(street: 'flop' | 'turn' | 'river'):
    { street: 'flop' | 'turn' | 'river'; cards: Card[]; remainingDeck: Card[] } {
  // Determine total cards required for the requested street
  const target = street === 'flop' ? 3 : street === 'turn' ? 4 : 5;
  // Use whichever is greater: actual community dealt or previously previewed
  const shown = Math.max(this.state.communityCards.length, this.rabbitPreviewed);
  const need = Math.max(0, target - shown);
  const cards = need > 0 ? this.deckManager.dealCards(need) : [];
  // Track preview progress so subsequent previews are incremental
  this.rabbitPreviewed += cards.length;
    const remaining = this.deckManager.getRemainingDeck();
    return { street, cards, remainingDeck: remaining };
  }

  // US-029: Enable/Configure Run It Twice before showdown (2-4 runs)
  public enableRunItTwice(numberOfRuns: number, seeds?: string[], playerEntropy: string = ''): void {
    // Determine allowable range dynamically: 1..activePlayers (non-folded)
    const activePlayers = this.state.players.filter(p => !p.isFolded);
    const maxRuns = Math.max(1, activePlayers.length);
    if (numberOfRuns < 1 || numberOfRuns > maxRuns) {
      throw new Error(`Run It Twice supports 1-${maxRuns} runs for ${activePlayers.length} active players`);
    }
    // Only valid if an all-in has occurred and betting is closed or heading to showdown
    const anyAllIn = this.state.players.some(p => p.isAllIn);
  if (!anyAllIn) throw new Error('Run It Twice requires an all-in situation');
    // If unanimity required, ensure all active players have given consent
    if (this.requireRitUnanimous) {
      const active = this.state.players.filter(p => !p.isFolded);
      const missing = active.filter(p => !this.ritConsents.has(p.id));
      if (missing.length > 0) {
        throw new Error(`Run It Twice requires unanimous agreement; missing: ${missing.map(m => m.id).join(', ')}`);
      }
    }
    // If no seeds provided, generate via RNG security module (US-030)
    let rngSec: RNGSecurity | undefined;
    let runSeeds: string[];
    if (!seeds || seeds.length !== numberOfRuns) {
      const { rng, seeds: gen } = generateRngSecurity(numberOfRuns, playerEntropy);
      rngSec = rng;
      runSeeds = gen;
    } else {
      runSeeds = seeds;
    }

    this.state.runItTwice = {
      enabled: true,
      numberOfRuns,
      boards: [],
      results: [],
      potDistribution: [],
      seeds: runSeeds,
      rngSecurity: rngSec ? {
        seedGeneration: {
          entropy: rngSec.seedGeneration.entropy, // kept server-side
          timestamp: rngSec.seedGeneration.timestamp,
          playerEntropy: rngSec.seedGeneration.playerEntropy,
          vrf: rngSec.seedGeneration.vrf,
        },
        verification: rngSec.verification,
      } : undefined,
    };
  }

  public startNewHand(): void {
    // Before starting, drop any players flagged for removal and re-index positions
    if (this.removedPlayers.size > 0) {
      const remaining = this.state.players.filter(p => !this.removedPlayers.has(p.id));
      // Re-index positions contiguously starting at 1
      this.state.players = remaining.map((p, i) => ({ ...p, position: i + 1 }));
      // Normalize dealer position to current players length
      if (this.state.players.length > 0) {
        this.state.dealerPosition = ((this.state.dealerPosition % this.state.players.length) + this.state.players.length) % this.state.players.length;
      } else {
        this.state.dealerPosition = 0;
      }
      // Do not clear removedPlayers here in case multiple successive starts need pruning
    }
    this.deckManager.resetDeck();
    this.gameStateManager.resetPlayerStates();
    this.gameStateManager.rotateDealerButton();
  // Reset consents for any new hand
  this.ritConsents.clear();
  // Reset rabbit preview tracking for new hand
  this.rabbitPreviewed = 0;
  if (this.state.variant === 'seven-card-stud' || this.state.variant === 'seven-card-stud-hi-lo' || this.state.variant === 'five-card-stud') {
      this.dealStudInitial();
      // Stud uses bring-in instead of blinds
      this.computeStudBringIn();
      this.gameStateManager.startBettingRound('third');
    } else {
      this.dealHoleCards();
  this.postBlinds();
      this.gameStateManager.startBettingRound('preflop');
    }
  }

  // Force-fold a player immediately; if it's their turn, route through standard action logic
  public forceFold(playerId: string): void {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) return;
    if (player.isFolded) return;
    // If it's their turn, use normal action path for proper sequencing
    if (this.state.activePlayer === playerId) {
      const action: PlayerAction = { type: 'fold', playerId, tableId: this.state.tableId, timestamp: Date.now() } as any;
      this.handleAction(action);
      return;
    }
    // Otherwise, mark folded out-of-turn
    player.isFolded = true;
    player.hasActed = true;
    // If only one player remains, end hand immediately
    const active = this.state.players.filter(p => !p.isFolded);
    if (active.length === 1 && this.state.stage !== 'showdown') {
      this.determineWinner();
    }
  }

  // Mark a player to be removed at next hand start and fold them now if hand in progress
  public removePlayer(playerId: string): void {
    this.removedPlayers.add(playerId);
    if (this.state.stage !== 'showdown') {
      this.forceFold(playerId);
    }
  }

  private dealHoleCards(): void {
  // Deal 2 cards for Hold'em, 4 for Omaha (including Omaha Hi-Lo)
  const rounds = (this.state.variant === 'omaha' || this.state.variant === 'omaha-hi-lo') ? 4 : 2;
  for (let round = 0; round < rounds; round++) {
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
    if (this.state.variant === 'seven-card-stud') {
      // No blinds in Stud; handled via bring-in mechanic
      return;
    }
    this.log(`-------- Posting Blinds --------`);
    this.log(`Before blinds:`, this.state.players.map(p => ({
      id: p.id,
      stack: p.stack,
      bet: p.currentBet
    })));
    
  const { pot, currentBet } = this.bettingManager.postBlinds(this.state.players, this.state.dealerPosition);
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

  // Allow changing betting mode at runtime (e.g., by room configuration update)
  public setBettingMode(mode: 'no-limit' | 'pot-limit'): void {
    if (mode === 'no-limit') {
      // Remove the optional property to avoid breaking strict equality snapshots
      delete (this.state as any).bettingMode;
    } else {
      this.state.bettingMode = mode;
    }
    this.bettingManager.setMode(mode);
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

    // Fast-path: for folds, pre-mark and settle immediately if this leaves a single active player
    if (action.type === 'fold') {
      this.log(`Fast-path fold by ${player.id} at stage=${this.state.stage}`);
      player.isFolded = true;
      player.hasActed = true;
      const remaining = this.getActivePlayers();
      if (remaining.length === 1) {
        this.determineWinner();
        return;
      }
      // If more than one remain, continue with normal action processing for consistency
    }
    
    // Process the action
    const { pot, currentBet, minRaise } = this.bettingManager.processAction(
      player,
      action,
      this.state.currentBet,
      this.state.minRaise,
      { currentPot: this.state.pot, players: this.state.players }
    );

    // Update state and add new contribution to pot if any
  if ((action.type === 'call' || action.type === 'raise' || action.type === 'bet') && pot > 0) {
      // Only add the difference between new bet and old bet
      this.log(`Processing bet: oldBet=${oldBet}, newBet=${player.currentBet}, potContribution=${pot}`);
      if (pot > 0) {
        this.addToPot(pot);
        this.log(`Added ${pot} to pot from player ${player.id} (old bet: ${oldBet}, new bet: ${player.currentBet}, new total pot: ${this.state.pot})`);
      }
    } else if (action.type === 'fold') {
      // Already pre-marked above; ensure flags remain set
      this.log(`Player ${player.id} folded with current bet of ${player.currentBet}`);
      player.isFolded = true;
      player.hasActed = true;
    }

    this.state.currentBet = currentBet;
    this.state.minRaise = minRaise;

    // If folding leaves only one player, end hand immediately with win by fold
    const remainingAfterAction = this.getActivePlayers();
    if (remainingAfterAction.length === 1) {
      this.determineWinner();
      return;
    }

    // Find next player or move to next stage
    this.log(`Searching for next player after ${player.id} (pos=${player.position})`);
    this.log(`All players state:`, this.state.players.map(p => ({
      id: p.id,
      pos: p.position,
      hasActed: p.hasActed,
      currentBet: p.currentBet,
      isFolded: p.isFolded,
      isAllIn: p.isAllIn
    })));
    this.log(`Current state: currentBet=${this.state.currentBet}, stage=${this.state.stage}`);
    
    const nextPlayer = this.gameStateManager.findNextActivePlayer(player.position);
    
    if (nextPlayer) {
      this.log(`Found next player: ${nextPlayer.id} (pos=${nextPlayer.position})`);
      this.state.activePlayer = nextPlayer.id;
    } else {
      this.log(`No next player found - betting round should be complete`);
      
      // Check if only one player remains (win by fold)
      const activePlayers = this.getActivePlayers();
      if (activePlayers.length === 1) {
        this.log(`Only one active player remains - determining winner`);
        this.determineWinner();
        return;
      }

      this.log(`Moving to next stage from ${this.state.stage}`);
      const nextStage = this.gameStateManager.moveToNextStage();

  if (this.state.variant === 'seven-card-stud' || this.state.variant === 'seven-card-stud-hi-lo' || this.state.variant === 'five-card-stud') {
        switch (nextStage) {
          case 'fourth':
          case 'fifth':
            this.dealStudUpCards(1);
            break;
          case 'sixth':
            // Five-card stud also deals an up card on sixth (sequence: 1 down + 1 up initially, then up on 4th/5th/6th)
            this.dealStudUpCards(1);
            break;
          case 'seventh':
            if (this.state.variant !== 'five-card-stud') this.dealStudDownCards(1);
            break;
          case 'showdown':
            // Defensive: ensure all active stud players have enough cards; otherwise, correct the flow by dealing the missing street
            try {
              // If only one player remains active at this exact moment, settle immediately (do not deal any further stud cards)
              const stillActive = this.getActivePlayers();
              if (stillActive.length === 1) {
                this.determineWinner();
                return;
              }
              const actives = this.getActivePlayers();
              const counts = actives.map(p => {
                const st = this.state.studState?.playerCards[p.id];
                return (st?.downCards?.length || 0) + (st?.upCards?.length || 0);
              });
              const minCount = counts.length ? Math.min(...counts) : 0;
              if (this.state.variant === 'five-card-stud' && minCount < 5) {
                // We still owe an up card on sixth street; deal and keep betting
                this.dealStudUpCards(1);
                this.gameStateManager.startBettingRound('sixth');
                return;
              }
              if ((this.state.variant === 'seven-card-stud' || this.state.variant === 'seven-card-stud-hi-lo') && minCount < 7) {
                // Owe the seventh card (down); deal and keep betting
                this.dealStudDownCards(1);
                this.gameStateManager.startBettingRound('seventh');
                return;
              }
            } catch (e) {
              // If any error occurs, fall back to determining winner to avoid deadlock
            }
            this.determineWinner();
            return;
        }
      } else {
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
      }

      // Final safety: if only one player remains before starting the next round, settle now
      const actives = this.getActivePlayers();
      if (actives.length <= 1) {
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

  // US-053: Seven-card Stud helpers
  private ensureStudState(): void {
    if (!this.state.studState) this.state.studState = { playerCards: {} };
  }

  private dealStudInitial(): void {
    this.ensureStudState();
    if (this.state.variant === 'five-card-stud') {
      // Five-card stud: 1 down, then one up to start (total 2 cards initially)
      for (const p of this.state.players) {
        const c = this.deckManager.dealCard();
        if (!this.state.studState!.playerCards[p.id]) this.state.studState!.playerCards[p.id] = { downCards: [], upCards: [] };
        if (c) this.state.studState!.playerCards[p.id].downCards.push(c);
      }
      for (const p of this.state.players) {
        const c = this.deckManager.dealCard();
        if (!this.state.studState!.playerCards[p.id]) this.state.studState!.playerCards[p.id] = { downCards: [], upCards: [] };
        if (c) this.state.studState!.playerCards[p.id].upCards.push(c);
      }
    } else {
      // Seven-card stud: 2 down, 1 up initially
      for (let r = 0; r < 2; r++) {
        for (const p of this.state.players) {
          const c = this.deckManager.dealCard();
          if (!this.state.studState!.playerCards[p.id]) this.state.studState!.playerCards[p.id] = { downCards: [], upCards: [] };
          if (c) this.state.studState!.playerCards[p.id].downCards.push(c);
        }
      }
      for (const p of this.state.players) {
        const c = this.deckManager.dealCard();
        if (!this.state.studState!.playerCards[p.id]) this.state.studState!.playerCards[p.id] = { downCards: [], upCards: [] };
        if (c) this.state.studState!.playerCards[p.id].upCards.push(c);
      }
    }
  }

  private dealStudUpCards(count: number): void {
    this.ensureStudState();
    // Do not deal further up cards if hand is effectively over (one active player)
    const active = this.getActivePlayers();
    if (active.length <= 1) {
      this.log(`[STUD] Skipping dealStudUpCards(${count}): only one active remains`);
      return;
    }
    for (let k = 0; k < count; k++) {
      for (const p of this.state.players) {
        const c = this.deckManager.dealCard();
        if (!this.state.studState!.playerCards[p.id]) this.state.studState!.playerCards[p.id] = { downCards: [], upCards: [] };
        if (c) this.state.studState!.playerCards[p.id].upCards.push(c);
      }
    }
  }

  private dealStudDownCards(count: number): void {
    this.ensureStudState();
    // Do not deal further down cards if hand is effectively over (one active player)
    const active = this.getActivePlayers();
    if (active.length <= 1) {
      this.log(`[STUD] Skipping dealStudDownCards(${count}): only one active remains`);
      return;
    }
    for (let k = 0; k < count; k++) {
      for (const p of this.state.players) {
        const c = this.deckManager.dealCard();
        if (!this.state.studState!.playerCards[p.id]) this.state.studState!.playerCards[p.id] = { downCards: [], upCards: [] };
        if (c) this.state.studState!.playerCards[p.id].downCards.push(c);
      }
    }
  }

  private computeStudBringIn(): void {
    this.ensureStudState();
    // Simplified bring-in: lowest upcard pays small blind amount as bring-in; choose first player if tie
    const weight: Record<Card['rank'], number> = {
      'A': 14,'K': 13,'Q': 12,'J': 11,'10': 10,'9': 9,'8': 8,'7': 7,'6': 6,'5': 5,'4': 4,'3': 3,'2': 2,
    };
    const suitWeight: Record<Card['suit'], number> = { clubs: 1, diamonds: 2, hearts: 3, spades: 4 };
    let chosen: { id: string; val: number } | null = null;
    const debug: Array<{ id: string; up?: Card; rankW?: number; suitW?: number }> = [];
    for (const p of this.state.players) {
      const up = this.state.studState!.playerCards[p.id]?.upCards?.[0];
      if (!up) continue;
      const val = weight[up.rank];
      debug.push({ id: p.id, up, rankW: val, suitW: suitWeight[up.suit] });
      if (!chosen || val < chosen.val) chosen = { id: p.id, val };
      else if (val === chosen.val) {
        // Tie-break by suit (lowest suit brings in): clubs < diamonds < hearts < spades
        const currUp = up;
        const chosenUp = this.state.studState!.playerCards[chosen.id]?.upCards?.[0];
        if (chosenUp && suitWeight[currUp.suit] < suitWeight[chosenUp.suit]) {
          chosen = { id: p.id, val };
        }
      }
    }
    const amount = Math.max(1, Math.floor(this.state.smallBlind));
    if (chosen) {
      const player = this.state.players.find(pl => pl.id === chosen!.id)!;
      const pay = Math.min(amount, player.stack);
      player.stack -= pay;
      player.currentBet += pay;
      this.state.pot += pay;
      // Do not set table currentBet for bring-in in this simplified implementation
      this.state.studState!.bringIn = { amount: pay, player: player.id };
      if (process.env.DEBUG_POKER === 'true') {
        // eslint-disable-next-line no-console
        console.log(`[DEBUG] Stud bring-in computed: player=${player.id} amount=${pay} upcards=`, debug);
      }
    }
  }

  private determineWinner(): void {
    // Normalize: if any player has external folded flag, reflect it in engine state
    this.state.players.forEach(p => {
      if ((p as any).folded && !p.isFolded) {
        p.isFolded = true;
      }
    });
    // Start from all non-folded players
  let activePlayers = this.getActivePlayers();

    // Immediate resolution: if only one player remains, settle win by fold without dealing any more cards
    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      this.log(`-------- Win by Fold --------`);
      this.log(`Initial state:`);
      this.log(`- Pot: ${this.state.pot}`);
      this.log(`- Current bets: ${this.state.players.map(p => `${p.id}: ${p.currentBet}`).join(', ')}`);
      this.log(`- Player stacks: ${this.state.players.map(p => `${p.id}: ${p.stack}`).join(', ')}`);

      // Compute conservation baseline; if pot is zero, include outstanding bets (e.g., blinds posted but not yet moved to pot)
      const betsTotal = this.state.players.reduce((sum, p) => sum + (p.currentBet || 0), 0);
      const potBefore = this.state.pot;
      const stacksTotal = this.state.players.reduce((sum, p) => sum + p.stack, 0);
      const includeOutstandingBets = potBefore === 0 ? betsTotal : 0;
      const initialTotal = stacksTotal + potBefore + includeOutstandingBets;

      // Clear current bets and pot
      this.state.players.forEach(p => { this.log(`Clearing bet for player ${p.id}: ${p.currentBet} -> 0`); p.currentBet = 0; });
      this.log(`Clearing pot: ${this.state.pot} -> 0`);
      this.state.pot = 0;

      // Award delta to winner so totals match baseline
      const finalTotalBeforeAward = this.state.players.reduce((sum, p) => sum + p.stack, 0);
      const delta = initialTotal - finalTotalBeforeAward;
      if (delta !== 0) { this.log(`Awarding ${delta} to winner ${winner.id} to settle pot.`); winner.stack += delta; }

      // Finalize hand
      this.state.stage = 'showdown';
      this.state.activePlayer = '';
      const totalChips = this.state.players.reduce((sum, p) => sum + p.stack, 0);
      this.log(`Win by fold - Winner ${winner.id} final stack: ${winner.stack}`);
      this.log(`Total chips after win by fold: ${totalChips} (should equal baseline ${initialTotal})`);
      return;
    }

    // If Run It Twice is enabled and we have reached showdown condition, execute RIT flow
    if (this.state.runItTwice?.enabled) {
      this.executeRunItTwice();
      return;
    }
    // Defensive: for Stud variants, exclude players who do not have enough stud cards
    // This can occur if a player joined mid-hand or had no cards dealt due to an edge case.
    if (this.state.variant === 'seven-card-stud' || this.state.variant === 'seven-card-stud-hi-lo' || this.state.variant === 'five-card-stud') {
      const eligible = activePlayers.filter(p => {
        const st = this.state.studState?.playerCards[p.id];
        const down = st?.downCards?.length || 0;
        const up = st?.upCards?.length || 0;
        return (down + up) >= 5; // require at least 5 total cards to evaluate
      });
      // If no one qualifies (should not happen), fall back to original active players to avoid empty distributions
      if (eligible.length > 0) {
        activePlayers = eligible;
      }
    }
    
    // Defensive: for stud variants, if somehow we reached here prematurely without enough cards, correct the flow
    if (this.state.variant === 'five-card-stud' || this.state.variant === 'seven-card-stud' || this.state.variant === 'seven-card-stud-hi-lo') {
      try {
        const counts = activePlayers.map(p => {
          const st = this.state.studState?.playerCards[p.id];
          return (st?.downCards?.length || 0) + (st?.upCards?.length || 0);
        });
        const minCount = counts.length ? Math.min(...counts) : 0;
        if (this.state.variant === 'five-card-stud' && minCount < 5) {
          this.log(`[STUD] Premature showdown guard (5-card): minCount=${minCount} < 5; dealing sixth up card and resuming betting.`);
          this.dealStudUpCards(1);
          this.gameStateManager.startBettingRound('sixth');
          return;
        }
        if ((this.state.variant === 'seven-card-stud' || this.state.variant === 'seven-card-stud-hi-lo') && minCount < 7) {
          this.log(`[STUD] Premature showdown guard (7-card): minCount=${minCount} < 7; dealing seventh down card and resuming betting.`);
          this.dealStudDownCards(1);
          this.gameStateManager.startBettingRound('seventh');
          return;
        }
      } catch (e) {
        // fall through to evaluation if any unexpected error
      }
    }

  // Evaluate hands and distribute pots (US-033: multi-way all-in resolution with side pots)
    this.log(`-------- Showdown --------`);
    this.log(`Initial state:`);
    this.log(`- Pot: ${this.state.pot}`);
    this.log(`- Current bets: ${this.state.players.map(p => `${p.id}: ${p.currentBet}`).join(', ')}`);
    this.log(`- Player stacks: ${this.state.players.map(p => `${p.id}: ${p.stack}`).join(', ')}`);

  // Verify total chips conservation baseline (pot already includes contributed bets)
  const betsTotal = this.state.players.reduce((sum, p) => sum + (p.currentBet || 0), 0);
  const potBefore = this.state.pot;
  const stacksTotal = this.state.players.reduce((sum, p) => sum + p.stack, 0);
  const includeOutstandingBets = potBefore === 0 ? betsTotal : 0;
  const initialTotal = stacksTotal + potBefore + includeOutstandingBets;
    this.log(`Total chips before distribution: ${initialTotal}`);

  // Build side pots from current bets and eligibility
  const sidePots = PotCalculator.calculateSidePots(
      this.state.players.map(p => ({ id: p.id, stack: p.stack, currentBet: p.currentBet, isFolded: p.isFolded }))
    );
    this.log(`Calculated side pots: ${JSON.stringify(sidePots)}`);

    // Create a base pot representing chips from previous streets (exclude current round unmatched totals)
  const baseAmount = Math.max(0, potBefore - betsTotal);
  const basePot = baseAmount > 0 ? [{ amount: baseAmount, eligiblePlayers: activePlayers.map(p => p.id) }] : [];
  const potsToDistribute = [...basePot, ...sidePots];

  // Special handling: Omaha Hi-Lo (US-052)
  if (this.state.variant === 'omaha-hi-lo') {
      // Prepare helpers
      const rankWeight: Record<Card['rank'], number> = {
        '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
      };
      const computeHighScore = (cards: Card[], category: number): number => {
        // Pack to a single number; high is better
        const vals = cards.map(c => rankWeight[c.rank] || 0);
        while (vals.length < 5) vals.push(0);
        const [v0, v1, v2, v3, v4] = vals;
        return category * 1e10 + v0 * 1e8 + v1 * 1e6 + v2 * 1e4 + v3 * 1e2 + v4;
      };

      // Precompute high hand ranks
      const highStrengths = new Map<string, { score: number; view: { cards: Card[]; description: string } }>();
      activePlayers.forEach(p => {
        const hr = HandEvaluator.getOmahaHandRanking(p.holeCards || [], this.state.communityCards);
        const score = computeHighScore(hr.cards, hr.rank);
        highStrengths.set(p.id, { score, view: { cards: hr.cards, description: hr.name } });
      });

      // Precompute low evaluations (8-or-better, Ace-to-Five), store ranks arrays for comparison
      const lowEvals = new Map<string, { ranks: number[] }>();
      activePlayers.forEach(p => {
        const low = HandEvaluator.evaluateOmahaLowEightOrBetter(p.holeCards || [], this.state.communityCards);
        if (low) lowEvals.set(p.id, { ranks: low.ranks });
      });

      // Aggregated per-player winnings for summary
      const totals = new Map<string, number>();
      const highTotals = new Map<string, number>();
      const lowTotals = new Map<string, number>();

      // Distribute each pot as hi/lo
      for (const pot of potsToDistribute) {
        const eligible = pot.eligiblePlayers.filter(id => activePlayers.some(p => p.id === id));
        if (eligible.length === 0 || pot.amount <= 0) continue;

        // Determine high winners among eligible
        const eligibleHigh = eligible.map(id => ({ id, s: highStrengths.get(id)?.score || 0 }));
        const maxHigh = Math.max(...eligibleHigh.map(e => e.s));
        const highWinners = eligibleHigh.filter(e => e.s === maxHigh).map(e => e.id);

        // Determine low qualifiers and winners among eligible
        const eligibleLow = eligible.filter(id => lowEvals.has(id));
        let lowWinners: string[] = [];
        if (eligibleLow.length > 0) {
          // Find minimal lexicographic ranks
          const cmp = (a: number[], b: number[]) => {
            const n = Math.min(a.length, b.length);
            for (let i = 0; i < n; i++) { if (a[i] !== b[i]) return a[i] - b[i]; }
            return a.length - b.length;
          };
          let bestRanks: number[] | null = null;
          for (const id of eligibleLow) {
            const r = lowEvals.get(id)!.ranks;
            if (!bestRanks || cmp(r, bestRanks) < 0) bestRanks = r;
          }
          lowWinners = eligibleLow.filter(id => cmp(lowEvals.get(id)!.ranks, bestRanks!) === 0);
        }

        if (lowWinners.length === 0) {
          // No qualifying low: entire pot to high winners (even split, remainder to earliest indices)
          const share = Math.floor(pot.amount / highWinners.length);
          let rem = pot.amount % highWinners.length;
          highWinners.forEach((id, i) => {
            const add = share + (i < rem ? 1 : 0);
            totals.set(id, (totals.get(id) || 0) + add);
            highTotals.set(id, (highTotals.get(id) || 0) + add);
          });
        } else {
          // Split pot into high and low halves; odd chip goes to high side
          const highPortion = Math.floor(pot.amount / 2) + (pot.amount % 2);
          const lowPortion = Math.floor(pot.amount / 2);

          // Distribute high portion
          const hShare = Math.floor(highPortion / highWinners.length);
          let hRem = highPortion % highWinners.length;
          highWinners.forEach((id, i) => {
            const add = hShare + (i < hRem ? 1 : 0);
            totals.set(id, (totals.get(id) || 0) + add);
            highTotals.set(id, (highTotals.get(id) || 0) + add);
          });

          // Distribute low portion
          const lShare = Math.floor(lowPortion / lowWinners.length);
          let lRem = lowPortion % lowWinners.length;
          lowWinners.forEach((id, i) => {
            const add = lShare + (i < lRem ? 1 : 0);
            totals.set(id, (totals.get(id) || 0) + add);
            lowTotals.set(id, (lowTotals.get(id) || 0) + add);
          });
        }
      }

      // Apply distribution to stacks and clear bets/pot
      this.state.players.forEach(p => {
        const win = totals.get(p.id) || 0;
        if (win > 0) {
          p.stack += win;
          this.log(`Awarded (Hi-Lo) ${win} to ${p.id} (stack now: ${p.stack})`);
        }
      });

      this.state.players.forEach(p => { p.currentBet = 0; });
      this.state.pot = 0;

      // Conservation check
      const finalTotalHL = this.state.players.reduce((sum, p) => sum + p.stack, 0);
      this.log(`Total chips after Hi-Lo distribution: ${finalTotalHL} (should equal initial ${initialTotal})`);
      if (finalTotalHL !== initialTotal) {
        this.error(`Chip count mismatch (Hi-Lo)! Lost ${initialTotal - finalTotalHL} chips in distribution.`);
        const delta = initialTotal - finalTotalHL;
        if (delta !== 0) {
          const firstActive = this.state.players.find(p => !p.isFolded);
          if (firstActive) {
            firstActive.stack += delta;
            this.log(`Adjusted ${firstActive.id} stack by ${delta} to maintain chip conservation.`);
          }
        }
      }

      // Persist last Hi-Lo result summary
      const highArr = Array.from(highTotals.entries()).map(([playerId, amount]) => ({ playerId, amount }));
      const lowArrRaw = Array.from(lowTotals.entries()).map(([playerId, amount]) => ({ playerId, amount }));
      this.state.lastHiLoResult = {
        high: highArr.sort((a, b) => a.playerId.localeCompare(b.playerId)),
        low: lowArrRaw.length > 0 ? lowArrRaw.sort((a, b) => a.playerId.localeCompare(b.playerId)) : null,
      };

      // Set stage to indicate hand is over
      this.state.stage = 'showdown';
      this.state.activePlayer = '';
      return;
    }

    // Stud Hi-Lo showdown path (US-054): evaluate high best-5 from 7; low Ace-to-Five 8-or-better from 7
    if (this.state.variant === 'seven-card-stud-hi-lo') {
      const rankWeight: Record<Card['rank'], number> = { '2': 2,'3': 3,'4': 4,'5': 5,'6': 6,'7': 7,'8': 8,'9': 9,'10': 10,'J': 11,'Q': 12,'K': 13,'A': 14 };
      const computeHighScore = (cards: Card[], category: number): number => {
        const vals = cards.map(c => rankWeight[c.rank] || 0); while (vals.length < 5) vals.push(0);
        const [v0, v1, v2, v3, v4] = vals; return category * 1e10 + v0 * 1e8 + v1 * 1e6 + v2 * 1e4 + v3 * 1e2 + v4;
      };
      // Precompute high strengths from stud cards
      const highStrengths = new Map<string, { score: number }>();
      const lowEvals = new Map<string, { ranks: number[] }>();
      activePlayers.forEach(p => {
        const st = this.state.studState?.playerCards[p.id];
        const all = st ? [...(st.downCards || []), ...(st.upCards || [])] : [];
        const hr = HandEvaluator.getHandRanking(all, []);
        const score = computeHighScore(hr.cards, hr.rank);
        highStrengths.set(p.id, { score });
        const low = HandEvaluator.evaluateAceToFiveLow(all);
        if (low) lowEvals.set(p.id, { ranks: low.ranks });
      });

      const totals = new Map<string, number>();
      const highTotals = new Map<string, number>();
      const lowTotals = new Map<string, number>();

      for (const pot of potsToDistribute) {
        const eligible = pot.eligiblePlayers.filter(id => activePlayers.some(p => p.id === id));
        if (eligible.length === 0 || pot.amount <= 0) continue;
        const eligibleHigh = eligible.map(id => ({ id, s: highStrengths.get(id)?.score || 0 }));
        const maxHigh = Math.max(...eligibleHigh.map(e => e.s));
        const highWinners = eligibleHigh.filter(e => e.s === maxHigh).map(e => e.id);
        const eligibleLow = eligible.filter(id => lowEvals.has(id));
        let lowWinners: string[] = [];
        if (eligibleLow.length > 0) {
          const cmp = (a: number[], b: number[]) => { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) { if (a[i] !== b[i]) return a[i] - b[i]; } return a.length - b.length; };
          let best: number[] | null = null;
          for (const id of eligibleLow) { const r = lowEvals.get(id)!.ranks; if (!best || cmp(r, best) < 0) best = r; }
          lowWinners = eligibleLow.filter(id => cmp(lowEvals.get(id)!.ranks, best!) === 0);
        }

        if (lowWinners.length === 0) {
          const share = Math.floor(pot.amount / highWinners.length); let rem = pot.amount % highWinners.length;
          highWinners.forEach((id, i) => { const add = share + (i < rem ? 1 : 0); totals.set(id, (totals.get(id) || 0) + add); highTotals.set(id, (highTotals.get(id) || 0) + add); });
        } else {
          const highPortion = Math.floor(pot.amount / 2) + (pot.amount % 2);
          const lowPortion = Math.floor(pot.amount / 2);
          const hShare = Math.floor(highPortion / highWinners.length); let hRem = highPortion % highWinners.length;
          highWinners.forEach((id, i) => { const add = hShare + (i < hRem ? 1 : 0); totals.set(id, (totals.get(id) || 0) + add); highTotals.set(id, (highTotals.get(id) || 0) + add); });
          const lShare = Math.floor(lowPortion / lowWinners.length); let lRem = lowPortion % lowWinners.length;
          lowWinners.forEach((id, i) => { const add = lShare + (i < lRem ? 1 : 0); totals.set(id, (totals.get(id) || 0) + add); lowTotals.set(id, (lowTotals.get(id) || 0) + add); });
        }
      }

      this.state.players.forEach(p => { const win = totals.get(p.id) || 0; if (win > 0) { p.stack += win; this.log(`Awarded (Stud Hi-Lo) ${win} to ${p.id}`); } });
      this.state.players.forEach(p => { p.currentBet = 0; });
      this.state.pot = 0;
      const finalTotalSHL = this.state.players.reduce((sum, p) => sum + p.stack, 0);
      this.log(`Total chips after Stud Hi-Lo distribution: ${finalTotalSHL} (should equal initial ${initialTotal})`);
      if (finalTotalSHL !== initialTotal) {
        this.error(`Chip count mismatch (Stud Hi-Lo)! Lost ${initialTotal - finalTotalSHL} chips.`);
        const delta = initialTotal - finalTotalSHL; if (delta !== 0) { const firstActive = this.state.players.find(p => !p.isFolded); if (firstActive) { firstActive.stack += delta; } }
      }
      const highArr = Array.from(highTotals.entries()).map(([playerId, amount]) => ({ playerId, amount }));
      const lowArrRaw = Array.from(lowTotals.entries()).map(([playerId, amount]) => ({ playerId, amount }));
      this.state.lastHiLoResult = { high: highArr.sort((a,b)=>a.playerId.localeCompare(b.playerId)), low: lowArrRaw.length ? lowArrRaw.sort((a,b)=>a.playerId.localeCompare(b.playerId)) : null };
      this.state.stage = 'showdown';
      this.state.activePlayer = '';
      return;
    }

  // Stud showdown path: evaluate with stud cards (best 5 from available)
  if (this.state.variant === 'seven-card-stud' || this.state.variant === 'five-card-stud') {
      const rankWeight: Record<Card['rank'], number> = {
        '2': 2,'3': 3,'4': 4,'5': 5,'6': 6,'7': 7,'8': 8,'9': 9,'10': 10,'J': 11,'Q': 12,'K': 13,'A': 14,
      };
      const computeScore = (cards: Card[], category: number): number => {
        const vals = cards.map(c => rankWeight[c.rank] || 0);
        while (vals.length < 5) vals.push(0);
        const [v0, v1, v2, v3, v4] = vals;
        return category * 1e10 + v0 * 1e8 + v1 * 1e6 + v2 * 1e4 + v3 * 1e2 + v4;
      };
      // Build pseudo hole/community: use all stud cards as holeCards input to generic evaluator
      const strengths = new Map<string, number>();
      const handViews = new Map<string, { cards: Card[]; description: string }>();
      activePlayers.forEach(p => {
        const st = this.state.studState?.playerCards[p.id];
        const all = st ? [...(st.downCards || []), ...(st.upCards || [])] : [];
        const { hand, cards } = HandEvaluator.evaluateHand(all, []);
        const hr = HandEvaluator.getHandRanking(all, []);
        strengths.set(p.id, computeScore(cards, hr.rank));
        handViews.set(p.id, { cards: hr.cards, description: hr.name });
      });

      const distribution = this.state.players.map(p => ({ playerId: p.id, winAmount: 0, strength: strengths.get(p.id) }));
      PotCalculator.distributePots(potsToDistribute, distribution);
      this.state.players.forEach(p => {
        const win = distribution.find(d => d.playerId === p.id)?.winAmount || 0;
        if (win > 0) { p.stack += win; this.log(`Awarded ${win} to ${p.id} (stack now: ${p.stack})`); }
      });
      this.state.players.forEach(p => { p.currentBet = 0; });
      this.state.pot = 0;
      const finalTotal = this.state.players.reduce((sum, p) => sum + p.stack, 0);
      this.log(`Total chips after distribution: ${finalTotal} (should equal initial ${initialTotal})`);
      if (finalTotal !== initialTotal) {
        this.error(`Chip count mismatch! Lost ${initialTotal - finalTotal} chips in distribution.`);
        const delta = initialTotal - finalTotal;
        if (delta !== 0) {
          const firstActive = this.state.players.find(p => !p.isFolded);
          if (firstActive) { firstActive.stack += delta; this.log(`Adjusted ${firstActive.id} stack by ${delta} to maintain chip conservation.`); }
        }
      }
      this.state.stage = 'showdown';
      this.state.activePlayer = '';
      return;
    }

    // Precompute hand strengths for all non-folded players (Hold'em/Omaha)
    // Build a composite numeric score: category rank + ordered best-5 ranks for intra-category tie-breaks
    const rankWeight: Record<Card['rank'], number> = {
      '2': 2,
      '3': 3,
      '4': 4,
      '5': 5,
      '6': 6,
      '7': 7,
      '8': 8,
      '9': 9,
      '10': 10,
      'J': 11,
      'Q': 12,
      'K': 13,
      'A': 14,
    };
    const computeScore = (cards: Card[], category: number): number => {
      // Use 2 digits per card slot to pack values safely within Number range
      const vals = cards.map(c => rankWeight[c.rank] || 0);
      // Ensure length 5 (best hand); pad with zeros if defensive
      while (vals.length < 5) vals.push(0);
      const [v0, v1, v2, v3, v4] = vals;
      return category * 1e10 + v0 * 1e8 + v1 * 1e6 + v2 * 1e4 + v3 * 1e2 + v4;
    };
    const strengths = new Map<string, number>();
    const handViews = new Map<string, { cards: Card[]; description: string }>();
    activePlayers.forEach(p => {
  const hr = ((this.state.variant === 'omaha' || this.state.variant === 'omaha-hi-lo')
        ? HandEvaluator.getOmahaHandRanking
        : HandEvaluator.getHandRanking
      ).call(HandEvaluator, p.holeCards || [], this.state.communityCards);
      const score = computeScore(hr.cards, hr.rank);
      strengths.set(p.id, score);
      handViews.set(p.id, { cards: hr.cards, description: hr.name });
    });

  // Prepare distribution array for all players (winAmount accumulates)
    const distribution = this.state.players.map(p => ({
      playerId: p.id,
      winAmount: 0,
      strength: strengths.get(p.id)
    }));

    // Distribute each side pot to highest-strength eligible players
  PotCalculator.distributePots(potsToDistribute, distribution);

    // Apply distribution to stacks and clear bets/pot
    this.state.players.forEach(p => {
      const win = distribution.find(d => d.playerId === p.id)?.winAmount || 0;
      if (win > 0) {
        p.stack += win;
        this.log(`Awarded ${win} to ${p.id} (stack now: ${p.stack})`);
      }
    });

    // Clear all current bets and pot
    this.state.players.forEach(p => {
      this.log(`Clearing bet for player ${p.id}: ${p.currentBet} -> 0`);
      p.currentBet = 0;
    });
    this.state.pot = 0;

    // Conservation check
  const finalTotal = this.state.players.reduce((sum, p) => sum + p.stack, 0);
    this.log(`Total chips after distribution: ${finalTotal} (should equal initial ${initialTotal})`);
    if (finalTotal !== initialTotal) {
      this.error(`Chip count mismatch! Lost ${initialTotal - finalTotal} chips in distribution.`);
      // As a last resort (should not happen), push any remaining difference to first active player
      const delta = initialTotal - finalTotal;
      if (delta !== 0) {
        const firstActive = this.state.players.find(p => !p.isFolded);
        if (firstActive) {
          firstActive.stack += delta;
          this.log(`Adjusted ${firstActive.id} stack by ${delta} to maintain chip conservation.`);
        }
      }
    }

  // Set stage to indicate hand is over
  this.state.stage = 'showdown';
  this.state.activePlayer = '';
  }

  // Allow changing variant at runtime before a hand starts
  public setVariant(variant: 'texas-holdem' | 'omaha' | 'omaha-hi-lo' | 'seven-card-stud' | 'seven-card-stud-hi-lo' | 'five-card-stud'): void {
    if (variant) {
      this.state.variant = variant;
    } else {
      delete (this.state as any).variant;
    }
  }

  // US-029: Execute run-it-twice using separate decks/boards per run and equal pot split
  private executeRunItTwice(): void {
    const rit = this.state.runItTwice!;
    const activePlayers = this.state.players.filter(p => !p.isFolded);
    if (activePlayers.length === 0) {
      // Edge-case: no active players; nothing to distribute
      this.state.stage = 'showdown';
      this.state.activePlayer = '';
      return;
    }

    // Determine missing community cards count
    const missing = 5 - this.state.communityCards.length;
    if (missing <= 0) {
      // Already have full board; fallback to standard showdown
      this.state.runItTwice = undefined;
      this.determineWinner();
      return;
    }

    // Exclude all known cards (players' hole cards + current community)
    const known: Card[] = [];
    activePlayers.forEach(p => (p.holeCards || []).forEach(c => known.push(c)));
    this.state.communityCards.forEach(c => known.push(c));

    const totalPrizePool = this.state.pot;
    const perRunPot = Math.floor(totalPrizePool / rit.numberOfRuns);
    let remainder = totalPrizePool % rit.numberOfRuns;

    const aggregate: Map<string, number> = new Map();
    const results = [] as {
      boardId: string;
      winners: Array<{ playerId: string; winningHand: HandRanking; potShare: number }>
    }[];

    for (let r = 0; r < rit.numberOfRuns; r++) {
      // Build a fresh deck excluding knowns; use a simple numeric seed from seed string for determinism
      const seedStr = rit.seeds[r] || `${r + 1}`;
      const seedNum = Array.from(seedStr).reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 0);
      const dm = DeckManager.fromExcluding(known, seedNum);
      const runBoard = [...this.state.communityCards, ...dm.dealCards(missing)];
      rit.boards.push(runBoard);

      // Evaluate winners on this run's board; enforce Omaha rules when applicable
      const evals = activePlayers.map(player => ({
        playerId: player.id,
        evaluation: ((this.state.variant === 'omaha' || this.state.variant === 'omaha-hi-lo')
          ? HandEvaluator.evaluateOmahaHand
          : HandEvaluator.evaluateHand).call(HandEvaluator, player.holeCards || [], runBoard)
      }));
      const winners = evals.filter(ph => !evals.some(other => ph !== other && HandEvaluator.compareHands(other.evaluation.hand, ph.evaluation.hand) > 0));

      // Split this run's pot equally among winners
      const runPot = perRunPot + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
      const prizePerWinner = Math.floor(runPot / winners.length);
      let runRemainder = runPot % winners.length;
      const runWinners: Array<{ playerId: string; winningHand: HandRanking; potShare: number }> = [];
      winners.forEach((w, idx) => {
        const potShare = prizePerWinner + (idx === winners.length - 1 ? runRemainder : 0);
        const prev = aggregate.get(w.playerId) || 0;
        aggregate.set(w.playerId, prev + potShare);
        const winningHand = ((this.state.variant === 'omaha' || this.state.variant === 'omaha-hi-lo')
          ? HandEvaluator.getOmahaHandRanking
          : HandEvaluator.getHandRanking).call(
            HandEvaluator,
            activePlayers.find(p => p.id === w.playerId)?.holeCards || [],
            runBoard
          );
        runWinners.push({ playerId: w.playerId, winningHand, potShare });
      });
      results.push({ boardId: `run-${r + 1}`, winners: runWinners });

      // Fire-and-forget persistence per run if configured
      const onOutcome = this.ritPersistence?.onOutcome;
      const handId = this.ritPersistence?.handId;
      if (onOutcome && handId) {
        const communityCards = runBoard.map(c => PokerEngine.cardToDbString(c));
        const winnersPayload = runWinners.map(w => ({ playerId: w.playerId, potShare: w.potShare, hand: w.winningHand }));
        const input: RunItTwiceOutcomeInput = {
          handId,
          boardNumber: r + 1,
          communityCards,
          winners: winnersPayload,
          potAmount: runPot,
        };
        // Do not await to keep engine synchronous; log errors if any
        onOutcome(input).catch(err => {
          if (!process.env.CI || this.debugEnabled) {
            console.error('RIT persistence failed:', err);
          }
        });
      }
    }

    // Apply aggregated distribution to players, clear pot and bets
    this.state.players.forEach(p => { p.currentBet = 0; });
    this.state.pot = 0;
    for (const [playerId, amount] of aggregate.entries()) {
      const player = this.state.players.find(p => p.id === playerId);
      if (player) player.stack += amount;
    }

    // Persist results on state and finalize
    rit.results = results;
    rit.potDistribution = Array.from(aggregate.entries()).map(([playerId, amount]) => ({ playerId, amount }));
    this.state.stage = 'showdown';
    this.state.activePlayer = '';
  }

  // Public helper to trigger RIT resolution immediately (for tests/integration when betting is closed)
  public runItTwiceNow(): void {
    if (!this.state.runItTwice?.enabled) throw new Error('Run It Twice is not enabled');
    this.executeRunItTwice();
  }

  // Dealer's Choice tables pause the game until the dealer selects a variant
  public pauseForDealerChoice(): TableState {
    this.state.stage = 'awaiting-dealer-choice';
    this.state.activePlayer = '';
    this.state.pot = 0;
    this.state.currentBet = 0;
    this.state.minRaise = this.state.bigBlind;
    this.state.communityCards = [];
    this.state.players = this.state.players.map((player) => ({
      ...player,
      currentBet: 0,
      hasActed: false,
      isFolded: false,
      isAllIn: false,
      holeCards: [],
    }));
    return this.getState();
  }

  public getState(): TableState {
    return { ...this.state };
  }

  // Public: finalize the hand to showdown immediately using current state
  // This will execute standard distribution or Run It Twice if enabled.
  public finalizeToShowdown(): void {
    this.determineWinner();
  }

  // Public safety: ensure immediate win-by-fold if only one player remains active
  public ensureWinByFoldIfSingle(): void {
    const active = this.getActivePlayers();
    if (active.length === 1 && this.state.stage !== 'showdown') {
      this.determineWinner();
    }
  }

  // US-030: Verify RNG security chain matches seeds stored
  public verifyRunItTwiceSeeds(): boolean {
    const rit = this.state.runItTwice;
    if (!rit || !rit.rngSecurity) return true; // nothing to verify (e.g., custom seeds provided)
    const res = verifyRngSecurity(rit.rngSecurity, rit.numberOfRuns, rit.rngSecurity.seedGeneration.playerEntropy);
    if (!res.ok) return false;
    // Ensure computed matches stored seeds
    return JSON.stringify(res.computed) === JSON.stringify(rit.seeds);
  }

  // Configure or update run-it-twice persistence at runtime
  public configureRunItTwicePersistence(handId: string, onOutcome: (input: RunItTwiceOutcomeInput) => Promise<void>): void {
    this.ritPersistence = { handId, onOutcome };
  }

  // Toggle unanimous consent requirement for RIT
  public setRunItTwiceUnanimous(required: boolean): void {
    this.requireRitUnanimous = !!required;
  }

  // Record or revoke a player's consent for RIT
  public recordRunItTwiceConsent(playerId: string, consent: boolean): void {
    if (consent) this.ritConsents.add(playerId); else this.ritConsents.delete(playerId);
  }

  // Helper: format a Card to DB-friendly string like 'As', 'Kd', '10s'
  private static cardToDbString(card: Card): string {
    const suitMap: Record<Card['suit'], string> = {
      hearts: 'h',
      diamonds: 'd',
      clubs: 'c',
      spades: 's',
    };
    const rank = card.rank; // keep '10' as '10'
    return `${rank}${suitMap[card.suit]}`;
  }

  // Helper for external services: serialize card to string once
  public static toDbCard(card: Card): string {
    return PokerEngine.cardToDbString(card);
  }

  // Helper: parse DB-friendly string (e.g., 'Ah', '10d') back to Card
  public static fromDbCard(s: string): Card {
    const suitChar = s.slice(-1);
    const rankStr = s.slice(0, -1);
    const suitMap: Record<string, Card['suit']> = { h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' };
    const suit = suitChar.toLowerCase();
    if (!suitMap[suit]) throw new Error(`Invalid card suit: ${s}`);
    const validRanks = new Set(['2','3','4','5','6','7','8','9','10','J','Q','K','A']);
    if (!validRanks.has(rankStr)) throw new Error(`Invalid card rank: ${s}`);
    return { rank: rankStr as Card['rank'], suit: suitMap[suit] };
  }

  /**
   * Serialize the engine state for persistence (e.g., to database).
   * This captures the full game state including the deck, allowing the engine
   * to be reconstructed in a stateless serverless environment.
   */
  public serialize(): {
    tableState: TableState;
    deck: Card[];
    removedPlayers: string[];
    rabbitPreviewed: number;
    requireRitUnanimous: boolean;
    ritConsents: string[];
  } {
    return {
      tableState: { ...this.state },
      deck: this.deckManager.serialize(),
      removedPlayers: Array.from(this.removedPlayers),
      rabbitPreviewed: this.rabbitPreviewed,
      requireRitUnanimous: this.requireRitUnanimous,
      ritConsents: Array.from(this.ritConsents),
    };
  }

  /**
   * Restore/reconstruct a PokerEngine from serialized state.
   * This is used to restore the game in serverless environments where
   * the in-memory state may not persist between requests.
   */
  public static fromSerialized(data: {
    tableState: TableState;
    deck: Card[];
    removedPlayers?: string[];
    rabbitPreviewed?: number;
    requireRitUnanimous?: boolean;
    ritConsents?: string[];
  }): PokerEngine {
    const { tableState, deck } = data;
    
    // Create engine with the preserved state
    const engine = new PokerEngine(
      tableState.tableId,
      tableState.players,
      tableState.smallBlind,
      tableState.bigBlind,
      {
        variant: tableState.variant,
        bettingMode: tableState.bettingMode || 'no-limit',
        requireRunItTwiceUnanimous: data.requireRitUnanimous || tableState.requireRunItTwiceUnanimous,
      }
    );

    // Restore full state (overwrite what constructor set)
    engine.state = { ...tableState };

    // Restore deck from serialized cards
    engine.deckManager = DeckManager.fromSerialized(deck);

    // Restore internal tracking state
    if (data.removedPlayers) {
      engine.removedPlayers = new Set(data.removedPlayers);
    }
    if (typeof data.rabbitPreviewed === 'number') {
      engine.rabbitPreviewed = data.rabbitPreviewed;
    }
    if (typeof data.requireRitUnanimous === 'boolean') {
      engine.requireRitUnanimous = data.requireRitUnanimous;
    }
    if (data.ritConsents) {
      engine.ritConsents = new Set(data.ritConsents);
    }

    // Re-initialize managers with restored state
    engine.bettingManager = new BettingManager(tableState.smallBlind, tableState.bigBlind);
    engine.bettingManager.setMode(tableState.bettingMode || 'no-limit');
    engine.gameStateManager = new GameStateManager(engine.state);

    return engine;
  }
}
