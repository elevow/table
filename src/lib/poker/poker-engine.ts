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

      // Evaluate winners on this run's board
      const evals = activePlayers.map(player => ({
        playerId: player.id,
        evaluation: HandEvaluator.evaluateHand(player.holeCards || [], runBoard)
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
        const winningHand = HandEvaluator.getHandRanking(
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
