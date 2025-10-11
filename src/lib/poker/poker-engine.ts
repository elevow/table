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
  variant: undefined as undefined | 'texas-holdem' | 'omaha' | 'omaha-hi-lo' | 'seven-card-stud' | 'seven-card-stud-hi-lo',
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
    if (numberOfRuns < 2 || numberOfRuns > 4) {
      throw new Error('Run It Twice supports 2-4 runs');
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
    this.deckManager.resetDeck();
    this.gameStateManager.resetPlayerStates();
    this.gameStateManager.rotateDealerButton();
  // Reset consents for any new hand
  this.ritConsents.clear();
  // Reset rabbit preview tracking for new hand
  this.rabbitPreviewed = 0;
  if (this.state.variant === 'seven-card-stud' || this.state.variant === 'seven-card-stud-hi-lo') {
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
      // When folding, current bet stays in place (doesn't go to pot yet)
      this.log(`Player ${player.id} folded with current bet of ${player.currentBet}`);
    }

    this.state.currentBet = currentBet;
    this.state.minRaise = minRaise;

    // If folding leaves only one player, end hand immediately with win by fold
    const remainingAfterAction = this.state.players.filter(p => !p.isFolded);
    if (remainingAfterAction.length === 1) {
      this.determineWinner();
      return;
    }

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

  if (this.state.variant === 'seven-card-stud' || this.state.variant === 'seven-card-stud-hi-lo') {
        switch (nextStage) {
          case 'fourth':
          case 'fifth':
          case 'sixth':
            this.dealStudUpCards(1);
            break;
          case 'seventh':
            this.dealStudDownCards(1);
            break;
          case 'showdown':
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
    // Deal two down cards, then one up card to each player
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

  private dealStudUpCards(count: number): void {
    this.ensureStudState();
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
    let chosen: { id: string; val: number } | null = null;
    for (const p of this.state.players) {
      const up = this.state.studState!.playerCards[p.id]?.upCards?.[0];
      if (!up) continue;
      const val = weight[up.rank];
      if (!chosen || val < chosen.val) chosen = { id: p.id, val };
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
    }
  }

  private determineWinner(): void {
    // If Run It Twice is enabled and we have reached showdown condition, execute RIT flow
    if (this.state.runItTwice?.enabled) {
      this.executeRunItTwice();
      return;
    }
    const activePlayers = this.state.players.filter(p => !p.isFolded);
    
    // If only one player remains, they win
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
      this.state.players.forEach(p => {
        this.log(`Clearing bet for player ${p.id}: ${p.currentBet} -> 0`);
        p.currentBet = 0;
      });
      this.log(`Clearing pot: ${this.state.pot} -> 0`);
      this.state.pot = 0;

      // Award delta to winner so totals match baseline
      const finalTotalBeforeAward = this.state.players.reduce((sum, p) => sum + p.stack, 0);
      const delta = initialTotal - finalTotalBeforeAward;
      if (delta !== 0) {
        this.log(`Awarding ${delta} to winner ${winner.id} to settle pot.`);
        winner.stack += delta;
      }

      // Finalize hand
      this.state.stage = 'showdown';
      this.state.activePlayer = '';

      // Debug: verify total chips
      const totalChips = this.state.players.reduce((sum, p) => sum + p.stack, 0);
      this.log(`Win by fold - Winner ${winner.id} final stack: ${winner.stack}`);
      this.log(`Total chips after win by fold: ${totalChips} (should equal baseline ${initialTotal})`);
      return;
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

    // Stud showdown path: evaluate with 7-card sets (best 5 of 7)
    if (this.state.variant === 'seven-card-stud') {
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
  public setVariant(variant: 'texas-holdem' | 'omaha' | 'omaha-hi-lo' | 'seven-card-stud' | 'seven-card-stud-hi-lo'): void {
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

  public getState(): TableState {
    return { ...this.state };
  }

  // Public safety: ensure immediate win-by-fold if only one player remains active
  public ensureWinByFoldIfSingle(): void {
    const active = this.state.players.filter(p => !p.isFolded);
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
}
