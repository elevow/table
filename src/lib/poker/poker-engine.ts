import { randomUUID } from 'crypto';
import { TableState, Player, Card, GameStage, PlayerAction, HandResult, HandRanking, GameVariant, RunItTwicePrompt, HandActionEntry, BettingMode, MixedGameEntry, WildRule } from '../../types/poker';
import { RunItTwiceOutcomeInput } from '../../types/game-history';
import { HandEvaluator } from './hand-evaluator';
import { PotCalculator, SidePot } from './pot-calculator';
import { DeckManager } from './deck-manager';
import { BettingManager } from './betting-manager';
import { generateRngSecurity, verifyRngSecurity, RNGSecurity } from './rng-security';
import { GameStateManager, sitsOutOfHand } from './game-state-manager';
import {
  TIMEOUTS_BEFORE_SIT_OUT, MAX_TIME_BANKS, MIN_TURN_SECONDS, MAX_TURN_SECONDS, MIN_TIME_BANK_SECONDS,
  MAX_TIME_BANK_SECONDS, bankTimeMs, clampSetting, timeBankMs, turnTimeMs,
  MIN_HAND_DELAY_SECONDS, MAX_HAND_DELAY_SECONDS, DEFAULT_HAND_DELAY_SECONDS,
} from '../shared/turn-clock';
import { builtInWildRule, hasBuiltInWilds, holeCardCount, isBaseballVariant, isDrawVariant, isNicaraguaMethod, isNicaraguaVariant, isOmahaHiLoVariant, pineappleDiscardStage, isMidnightBaseballVariant, MIDNIGHT_FLIP_MS, isHoldemVariant, isOmahaVariant, isSevenCardStudVariant, isStudVariant } from './variant-rules';
import { evaluateWildHigh, evaluateWildLow, evaluateWildOmaha, evaluateWildOmahaLow, evaluateWildRazz, tableWildMatcher } from './wild-hands';
import { fixedLimitBetSize } from './fixed-limit';
import { describeNicaraguaHand, nicaraguaScore } from './nicaragua';
import { revealedPlayerIds } from './state-sanitizer';
import { debugFlags, runtime } from '../config/env';

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
  // Baseball: players dealt a face-up 3 on the street being dealt, in deal order
  private dealtThrees: string[] = [];
  // Midnight Baseball: time the table spends showing the cards just turned, added to the next clock
  private revealMs = 0;

  // Optional engine options to configure behavior such as betting mode
  public static defaultOptions = {
    bettingMode: 'no-limit' as BettingMode,
    runItTwicePersistence: undefined as | { handId?: string; onOutcome?: (input: RunItTwiceOutcomeInput) => Promise<void> } | undefined,
  requireRunItTwiceUnanimous: false as boolean,
  variant: undefined as undefined | GameVariant,
  wildRule: undefined as undefined | WildRule,
  };

  constructor(tableId: string, players: Player[], smallBlind: number, bigBlind: number, options?: Partial<typeof PokerEngine.defaultOptions>) {
    this.debugEnabled = debugFlags.poker;
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
    if (opts.wildRule) {
      this.state.wildRule = opts.wildRule;
    }
    this.syncBuiltInWilds();
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
    if (!runtime.isCI || this.debugEnabled) {
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

  /** Whether this player has already splashed the pot this session. */
  public hasSplashed(playerId: string): boolean {
    return (this.state.splashUsedBy || []).includes(playerId);
  }

  /**
   * Once per session a player can make a bet or raise with a splash: it goes in like any other,
   * and the table sees chips raining onto the pot.
   */
  public recordSplash(playerId: string, amount: number, now: number = Date.now()): void {
    if (this.hasSplashed(playerId)) throw new Error('You have already splashed the pot this session');
    this.state.splashUsedBy = [...(this.state.splashUsedBy || []), playerId];
    this.state.lastSplash = { playerId, amount, at: now };
  }

  /** Record a player's run it twice vote, leaving the clock running for those yet to vote. */
  public recordRunItVote(playerId: string, runs: number): void {
    const prompt = this.state.runItTwicePrompt;
    if (!prompt) throw new Error('No run it twice vote in progress');
    this.state.runItTwicePrompt = { ...prompt, votes: { ...(prompt.votes || {}), [playerId]: runs } };
  }

  public setRunItTwicePrompt(prompt: RunItTwicePrompt | null, disabled = false): void {
    this.state.runItTwicePrompt = prompt;
    this.state.runItTwicePromptDisabled = disabled;
    if (prompt) {
      this.state.activePlayer = prompt.playerId;
    } else if (disabled) {
      this.state.activePlayer = '';
    }
    // The run-it-twice decision is on the clock like any other
    this.startTurnClock(Date.now());
  }

  public setAutoRunoutProgress(stage: GameStage, communityCards: Card[]): void {
    this.state.stage = stage;
    this.state.communityCards = [...communityCards];
    this.state.activePlayer = '';
    this.startTurnClock(Date.now());
  }

  public runStudAllInToShowdown(): void {
    for (let streets = 0; this.state.stage !== 'showdown' && streets < 10; streets++) {
      this.runStudAllInStreet();
    }
  }

  /** Deal the next stud street with no betting (all-in runout), or settle the hand after the last one. */
  public runStudAllInStreet(): void {
    if (!isStudVariant(this.state.variant)) throw new Error('Stud runout requires a stud variant');
    if (this.state.stage === 'showdown') return;
    // Midnight Baseball has no streets: with nobody left to bet, the cards are turned to the end
    if (isMidnightBaseballVariant(this.state.variant)) {
      if (!this.pendingPotMatch()) this.continueMidnight();
      return;
    }

    const nextStage = this.gameStateManager.moveToNextStage();
    if (nextStage === 'showdown') {
      this.determineWinner();
      return;
    }
    if (nextStage === 'seventh') {
      this.dealStudDownCards(1);
    } else {
      this.dealStudUpCards(1);
    }
    // Once the betting is over, a face-up 3 asks nothing more of anyone
    this.dealtThrees = [];
    this.state.activePlayer = '';
  }

  public startNewHand(): void {
    // Before starting, drop any players flagged for removal and re-index positions
    if (this.removedPlayers.size > 0) {
      const before = this.state.players;
      const oldDealer = this.state.dealerPosition;
      // Positions are seat numbers, so the players who stay keep theirs
      const remaining = before.filter(p => !this.removedPlayers.has(p.id));
      this.state.players = remaining;
      // Keep the button on the same player; if the button player left, the next player in seat
      // order gets it when it moves at the start of this hand
      const keptBefore = before.slice(0, Math.max(0, oldDealer)).filter(p => !this.removedPlayers.has(p.id)).length;
      const dealerStays = !!before[oldDealer] && !this.removedPlayers.has(before[oldDealer].id);
      const n = remaining.length;
      this.state.dealerPosition = n === 0 ? 0 : ((dealerStays ? keptBefore : keptBefore - 1) + n) % n;
      // Do not clear removedPlayers here in case multiple successive starts need pruning
    }
    if (this.state.paused) {
      throw new Error('The game is paused');
    }
    if (!this.canStartNewHand()) {
      throw new Error('Need at least two players sitting in to start a hand');
    }
    this.applyPendingBlinds();
    // A mixed game moves on to its next game between hands, before anything is dealt
    this.advanceMixedGame();
    this.deckManager.resetDeck();
    this.gameStateManager.resetPlayerStates();
    // Nicaragua deals every hand of its game from the same button, so the next player after the
    // dealer who chose it chooses once it is over
    if (!this.nicaraguaContinues()) this.gameStateManager.rotateDealerButton();
    this.dealInWaitingPlayers();
    // Sitting-out (and still waiting) players keep their seat and stack but take no part in the hand
    this.state.players.forEach(p => {
      if (sitsOutOfHand(p, this.state)) {
        p.isFolded = true;
        p.hasActed = true;
      }
    });
    delete this.state.handWinners;
    delete this.state.shownCards;
    delete this.state.handResult;
    delete this.state.lastHiLoResult;
    delete this.state.straddle;
    delete this.state.sevenDeuceResult;
    this.state.handId = randomUUID();
    this.state.handNumber = (this.state.handNumber || 0) + 1;
    this.state.handStartedAt = Date.now();
    this.state.handActions = [];
    this.state.handKind = 'normal';
    // Snapshot stacks before blinds, antes or bring-ins so showdown can size the side pots
    this.state.handStartStacks = Object.fromEntries(this.state.players.map(p => [p.id, p.stack]));
    this.state.dealersChoiceHandCount = (this.state.dealersChoiceHandCount || 0) + 1;
    this.state.turnSeq = (this.state.turnSeq || 0) + 1;
  // Reset consents for any new hand
  this.ritConsents.clear();
  // Reset rabbit preview tracking for new hand
  this.rabbitPreviewed = 0;
  if (isStudVariant(this.state.variant)) {
      if (this.state.bettingMode === 'fixed-limit') this.state.limitBets = 0;
      this.dealtThrees = [];
      if (isMidnightBaseballVariant(this.state.variant)) {
        this.dealMidnightBaseball();
        this.postGameAntes('third');
        this.startMidnightBaseball();
      } else {
        this.dealStudInitial();
        this.postGameAntes('third');
        // Stud uses bring-in instead of blinds
        this.openStudStreet('third');
      }
    } else if (isDrawVariant(this.state.variant)) {
      // Draw games: antes and no blinds; the first player after the button opens
      // Nicaragua: later hands of the game are played for the pot carried over, with no antes,
      // and only by the players who started the game
      const carry = this.startNicaraguaHand();
      this.dealHoleCards();
      if (carry > 0) this.state.pot += carry;
      else this.postGameAntes('preflop');
      if (this.state.bettingMode === 'fixed-limit') this.state.limitBets = 0;
      if (this.bettorsLeft() >= 2) this.gameStateManager.startBettingRound('preflop');
      else this.startDraw();
    } else if (this.state.bombPotNext) {
      this.startBombPot(this.state.bombPotNext.anteBB);
    } else {
      this.dealHoleCards();
      // Courchevel shows the first flop card before anyone bets
      if (this.state.variant === 'courchevel') this.dealCommunityCards(1);
      this.postAntes();
  this.postBlinds();
      this.postReturningBigBlinds();
      this.gameStateManager.startBettingRound('preflop');
      this.postStraddle();
      this.settleIfNobodyCanBet();
    }
    this.state.players.forEach(p => { delete p.wantsStraddle; });
    this.startTurnClock(Date.now());
  }

  private logAction(entry: HandActionEntry): void {
    if (!this.state.handActions) this.state.handActions = [];
    const actions = this.state.handActions;
    // Nicaragua's refill is logged as the hand settles, which happens inside the action that
    // ended it; that action is logged after, so it goes before the refill
    const last = actions[actions.length - 1];
    if (last && last.stage === 'showdown' && last.action === 'match-pot' && entry.stage !== 'showdown') {
      actions.splice(actions.length - 1, 0, entry);
      return;
    }
    actions.push(entry);
  }

  /** Put chips from a player's stack into the pot as a forced bet (blind, straddle, ante). */
  private postForced(player: Player, amount: number, countsAsBet: boolean): number {
    const pay = Math.max(0, Math.min(amount, player.stack));
    player.stack -= pay;
    if (countsAsBet) player.currentBet += pay;
    if (player.stack === 0) player.isAllIn = true;
    this.state.pot += pay;
    return pay;
  }

  /** Blinds the host set take effect between hands. */
  private applyPendingBlinds(): void {
    const pending = this.state.pendingBlinds;
    if (!pending) return;
    this.state.smallBlind = pending.smallBlind;
    this.state.bigBlind = pending.bigBlind;
    this.state.minRaise = pending.bigBlind;
    this.bettingManager = new BettingManager(pending.smallBlind, pending.bigBlind);
    this.bettingManager.setMode(this.state.bettingMode || 'no-limit');
    delete this.state.pendingBlinds;
  }

  /** Host sets new blinds; they apply from the next hand. */
  public setPendingBlinds(smallBlind: number, bigBlind: number): void {
    if (!(smallBlind > 0) || !(bigBlind >= smallBlind)) throw new Error('Blinds must be positive and the big blind at least the small blind');
    this.state.pendingBlinds = { smallBlind, bigBlind };
  }

  /** Host pauses or resumes the game. The clock stops while paused, without charging time banks. */
  public setPaused(paused: boolean, now: number = Date.now()): void {
    if (paused === !!this.state.paused) return;
    if (paused) {
      this.state.paused = true;
      if (typeof this.state.turnDeadline === 'number') {
        this.state.pausedTurnRemainingMs = Math.max(0, this.state.turnDeadline - now);
      }
      delete this.state.turnDeadline;
      delete this.state.turnStartedAt;
      return;
    }
    this.state.paused = false;
    const remaining = this.state.pausedTurnRemainingMs;
    delete this.state.pausedTurnRemainingMs;
    const player = this.state.players.find(p => p.id === this.state.activePlayer);
    if (typeof remaining === 'number' && player) {
      // Resume where the clock stopped; the start time moves so the time bank is charged only for
      // time actually spent deciding
      this.state.turnDeadline = now + remaining;
      this.state.turnStartedAt = this.state.turnDeadline - (turnTimeMs(this.state) + bankTimeMs(player, this.state));
    } else {
      this.startTurnClock(now);
    }
  }

  /** Host allows or disallows straddles at this table. */
  /** Table settings for the clock: base time per decision and each player's time banks. */
  public configureClock(opts: { turnSeconds?: number; timeBanks?: number; timeBankSeconds?: number; handDelaySeconds?: number }): void {
    if (opts.turnSeconds !== undefined) this.setTurnTime(opts.turnSeconds);
    if (opts.handDelaySeconds !== undefined) this.setHandDelay(opts.handDelaySeconds);
    if (opts.timeBankSeconds !== undefined) {
      this.state.timeBankSeconds = clampSetting(opts.timeBankSeconds, MIN_TIME_BANK_SECONDS, MAX_TIME_BANK_SECONDS, 30);
    }
    if (opts.timeBanks !== undefined) {
      const count = clampSetting(opts.timeBanks, 0, MAX_TIME_BANKS, 0);
      this.state.startingTimeBanks = count;
      this.state.players.forEach(p => { p.timeBanks = count; });
    }
  }

  /** Host changes the base time per decision; it applies from the next decision. */
  public setTurnTime(seconds: number): void {
    this.state.turnTimeMs = clampSetting(seconds, MIN_TURN_SECONDS, MAX_TURN_SECONDS, 30) * 1000;
  }

  /** Host changes the pause between hands; it applies from the next hand's end. */
  public setHandDelay(seconds: number): void {
    this.state.handDelayMs = clampSetting(seconds, MIN_HAND_DELAY_SECONDS, MAX_HAND_DELAY_SECONDS, DEFAULT_HAND_DELAY_SECONDS) * 1000;
  }

  /**
   * Host gives a player more time banks or takes some away. If it is that player's turn, the
   * clock they are on moves by the same amount.
   */
  public adjustTimeBanks(playerId: string, delta: number, now: number = Date.now()): number {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found');
    // Games saved before time banks were counted: start from the seconds they had
    const current = typeof player.timeBanks === 'number'
      ? player.timeBanks
      : Math.floor(Math.max(0, player.timeBank || 0) * 1000 / timeBankMs(this.state));
    const next = Math.min(MAX_TIME_BANKS, Math.max(0, current + Math.round(delta)));
    player.timeBanks = next;
    const change = next - current;
    if (change !== 0 && this.state.activePlayer === playerId && typeof this.state.turnDeadline === 'number') {
      this.state.turnDeadline = Math.max(now, this.state.turnDeadline + change * timeBankMs(this.state));
    }
    if (change !== 0 && this.state.paused && this.state.activePlayer === playerId && typeof this.state.pausedTurnRemainingMs === 'number') {
      this.state.pausedTurnRemainingMs = Math.max(0, this.state.pausedTurnRemainingMs + change * timeBankMs(this.state));
    }
    return next;
  }

  /**
   * When a betting round ends with one player's bet higher than anyone else's (the others are
   * all-in for less or folded), the excess can never be won: return it to that player now, so
   * the pot shows only what is being played for.
   */
  private returnUncalledBet(): void {
    const byBet = [...this.state.players].sort((a, b) => b.currentBet - a.currentBet);
    const top = byBet[0];
    if (!top || top.isFolded || byBet.length < 2) return;
    const excess = top.currentBet - byBet[1].currentBet;
    if (excess <= 0) return;
    top.currentBet -= excess;
    top.stack += excess;
    if (top.stack > 0) top.isAllIn = false;
    this.state.pot = Math.max(0, this.state.pot - excess);
    this.state.currentBet = top.currentBet;
    this.logAction({ playerId: top.id, action: 'uncalled', put: -excess, stage: this.state.stage });
  }

  /** Whether this table offers run it twice after an all-in. */
  public setAllowRunItTwice(allow: boolean): void {
    // Run It Twice evaluates each board without wild cards, so wild tables play one board
    // Draw games have no board to run twice
    this.state.allowRunItTwice = allow && !this.state.wildRule && !isDrawVariant(this.state.variant);
  }

  /** Whether everyone still in at a showdown must show, instead of losers mucking. */
  public setShowAllAtShowdown(show: boolean): void {
    this.state.showAllAtShowdown = show;
  }

  public setAllowStraddle(allow: boolean): void {
    this.state.allowStraddle = allow;
    if (!allow) this.state.players.forEach(p => { delete p.wantsStraddle; });
  }

  /** Room option: the ante every player posts in Hold'em and Omaha hands (0 turns antes off). */
  public setAnte(amount: number): void {
    if (Number.isFinite(amount) && amount > 0) this.state.ante = amount;
    else delete this.state.ante;
  }

  /** Room option: the 7-2 bounty each other player pays a Hold'em pot winner who shows 7-2 (0 = off). */
  public setSevenDeuceBounty(amount: number): void {
    if (Number.isFinite(amount) && amount > 0) this.state.sevenDeuceBounty = amount;
    else delete this.state.sevenDeuceBounty;
  }

  /**
   * Room option: play these games in turn, handsPerGame hands each, starting with the first.
   * The switch happens as each hand starts, so it needs no chooser and no extra request.
   */
  public setMixedGame(games: MixedGameEntry[], handsPerGame: number): void {
    if (!Array.isArray(games) || games.length === 0) {
      delete this.state.mixedGame;
      return;
    }
    this.state.mixedGame = { games: games.map(g => ({ ...g })), handsPerGame: Math.max(1, Math.floor(handsPerGame) || 1), index: 0, handsInGame: 0 };
    this.setVariant(games[0].variant);
    this.setBettingMode(games[0].bettingMode);
  }

  /** Move a mixed game on to its next game once the current one has had its hands. */
  private advanceMixedGame(): void {
    const mixed = this.state.mixedGame;
    if (!mixed || !Array.isArray(mixed.games) || mixed.games.length === 0) return;
    const n = mixed.games.length;
    if (mixed.handsInGame >= mixed.handsPerGame) {
      mixed.index = (mixed.index + 1) % n;
      mixed.handsInGame = 0;
    }
    const game = mixed.games[((mixed.index % n) + n) % n];
    this.setVariant(game.variant);
    this.setBettingMode(game.bettingMode);
    mixed.handsInGame += 1;
  }

  /**
   * Antes (Hold'em and Omaha, a room option): every player dealt in posts the ante before the
   * blinds. Antes are dead money: they go into the pot but are not part of anyone's bet, so they
   * don't count towards calling or raising. Side pots still include them, since those are sized
   * from what each player put in over the whole hand.
   */
  private postAntes(): void {
    const ante = this.state.ante || 0;
    if (!(ante > 0) || isStudVariant(this.state.variant)) return;
    for (const p of this.gameStateManager.dealtInPlayers()) {
      const pay = this.postForced(p, ante, false);
      if (pay > 0) this.logAction({ playerId: p.id, action: 'ante', put: pay, stage: 'preflop' });
    }
  }

  /**
   * Stud and draw games: everyone dealt in antes (in stud, before the bring-in). The table's ante
   * is used, or a tenth of the big blind (at least 1) when the table has none.
   */
  private postGameAntes(stage: GameStage): void {
    const ante = this.state.ante && this.state.ante > 0
      ? this.state.ante
      : Math.max(1, Math.round(this.state.bigBlind / 10));
    for (const p of this.gameStateManager.dealtInPlayers()) {
      const pay = this.postForced(p, ante, false);
      if (pay > 0) this.logAction({ playerId: p.id, action: 'ante', put: pay, stage });
    }
  }

  /**
   * Seat order index of the player who posts the big blind, if these players were dealt in with
   * the button on dealerId. Heads-up the button posts the small blind and the other player the big.
   */
  private bigBlindIndexAmong(players: Player[], dealerId: string | undefined): number {
    const n = players.length;
    const d = players.findIndex(p => p.id === dealerId);
    if (n < 2 || d < 0) return -1;
    return n === 2 ? (d + 1) % n : (d + 2) % n;
  }

  /**
   * At the start of a hand, after the button moves: deal in players who were waiting for the big
   * blind once it reaches them (or who chose to post it now), and note a missed big blind for
   * anyone sitting out whom it passed. Games without blinds (stud) deal everyone in straight away,
   * as does a table that could not otherwise start.
   */
  private dealInWaitingPlayers(): void {
    const players = this.state.players;
    const dealerId = players[this.state.dealerPosition]?.id;
    const active = players.filter(p => !sitsOutOfHand(p, this.state));
    const waiting = players.filter(p => p.waitingForBigBlind && !p.isSittingOut);
    const hasBlinds = !isStudVariant(this.state.variant) && !isDrawVariant(this.state.variant) && !this.state.bombPotNext;
    const dealIn = (p: Player) => {
      delete p.waitingForBigBlind;
      delete p.missedBigBlind;
    };
    if (!hasBlinds || active.length < 2) {
      waiting.forEach(p => {
        dealIn(p);
        delete p.postBigBlindNow;
      });
      // The button may have skipped them; keep it on a player who is in the hand
      const onButton = players[this.state.dealerPosition];
      if (!onButton || sitsOutOfHand(onButton, this.state)) {
        const first = players.findIndex(p => !sitsOutOfHand(p, this.state));
        if (first >= 0) this.state.dealerPosition = first;
      }
      return;
    }
    // Would this player post the big blind if they were dealt in with the players already in?
    const wouldBeBigBlind = (p: Player) => {
      const withP = players.filter(x => x === p || active.includes(x));
      return withP[this.bigBlindIndexAmong(withP, dealerId)] === p;
    };
    let bigBlindTaken = false;
    for (const p of waiting) {
      if (p.postBigBlindNow) {
        dealIn(p);
      } else if (!bigBlindTaken && wouldBeBigBlind(p)) {
        dealIn(p);
        bigBlindTaken = true;
      }
    }
    // Missing the big blind is a cash-game idea: a tournament player sitting out still posts it
    if (this.state.tournamentRules) return;
    for (const p of players) {
      if (p.isSittingOut && !this.removedPlayers.has(p.id) && wouldBeBigBlind(p)) p.missedBigBlind = true;
    }
  }

  /**
   * Players who chose to post rather than wait for the big blind put one in now, out of turn. It
   * is a live bet: if nobody raises they may still check when the action reaches them.
   */
  private postReturningBigBlinds(): void {
    for (const p of this.state.players) {
      if (!p.postBigBlindNow) continue;
      delete p.postBigBlindNow;
      if (p.isFolded || sitsOutOfHand(p, this.state)) continue;
      const owe = this.state.bigBlind - p.currentBet;
      if (owe <= 0) continue;
      const pay = this.postForced(p, owe, true);
      if (pay > 0) this.logAction({ playerId: p.id, action: 'big-blind', amount: p.currentBet, put: pay, stage: 'preflop' });
    }
  }

  /**
   * After the forced bets, if every player in the hand is already all-in nobody can bet: deal the
   * rest of the board and settle, instead of waiting for a decision nobody can make.
   */
  private settleIfNobodyCanBet(): void {
    if (this.state.stage === 'showdown') return;
    const canAct = this.getActivePlayers().filter(p => !p.isAllIn);
    if (canAct.length > 0) return;
    if (this.discardOwed()) {
      this.skipToDiscard();
      return;
    }
    this.dealCommunityCards(Math.max(0, 5 - this.state.communityCards.length));
    this.determineWinner();
  }

  /**
   * 7-2 bounty (Hold'em only, a room option). A player who wins chips in a hand holding 7-2
   * offsuit (the traditional rule: 7-2 suited does not count), and whose cards are shown, collects
   * the bounty from every other player who was dealt into the hand, each paying at most what is
   * left in their stack. The cards count as shown when they are turned up as a winner at a
   * contested showdown or all-in, or when the player clicks "Show my cards" after winning
   * uncontested. Paid at most once per hand.
   */
  private maybeAwardSevenDeuceBounty(): void {
    const bounty = this.state.sevenDeuceBounty || 0;
    if (!(bounty > 0) || this.state.sevenDeuceResult || this.state.stage !== 'showdown') return;
    if (!isHoldemVariant(this.state.variant)) return;
    const winners = this.state.handWinners || [];
    const revealed = revealedPlayerIds(this.state);
    const winner = this.state.players.find(p => winners.includes(p.id) && revealed.has(p.id) && PokerEngine.isSevenDeuceOffsuit(p.holeCards));
    if (!winner) return;
    const payments: Record<string, number> = {};
    let total = 0;
    for (const p of this.state.players) {
      if (p.id === winner.id || (p.holeCards?.length || 0) === 0) continue;
      const pay = Math.max(0, Math.min(bounty, p.stack));
      if (pay <= 0) continue;
      p.stack -= pay;
      payments[p.id] = pay;
      total += pay;
      this.logAction({ playerId: p.id, action: 'bounty', put: pay, stage: 'showdown', toPlayerId: winner.id });
    }
    winner.stack += total;
    this.state.sevenDeuceResult = { playerId: winner.id, total, payments };
  }

  /** Exactly a seven and a deuce of different suits. */
  public static isSevenDeuceOffsuit(cards?: Card[]): boolean {
    if (!Array.isArray(cards) || cards.length !== 2) return false;
    const ranks = cards.map(c => c?.rank).sort().join(',');
    return ranks === '2,7' && cards[0].suit !== cards[1].suit;
  }

  /** A player asks to straddle next hand (posted only if they are under the gun). */
  public setWantsStraddle(playerId: string, wants: boolean): void {
    if (!this.state.allowStraddle && wants) throw new Error('Straddles are not allowed at this table');
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found');
    player.wantsStraddle = wants;
  }

  /** Host makes the next hand a bomb pot, or cancels it. */
  public setBombPotNext(anteBB: number | null): void {
    if (anteBB === null) {
      this.state.bombPotNext = null;
      return;
    }
    if (!(anteBB > 0)) throw new Error('The bomb pot ante must be positive');
    this.state.bombPotNext = { anteBB };
  }

  /**
   * Under-the-gun straddle: the player after the big blind posts twice the big blind and acts last
   * preflop. Only with three or more players in the hand.
   */
  private postStraddle(): void {
    // A straddle would be a raise out of turn, which fixed-limit betting has no place for
    if (!this.state.allowStraddle || this.state.bettingMode === 'fixed-limit') return;
    const dealtIn = this.gameStateManager.dealtInPlayers();
    const n = dealtIn.length;
    if (n < 3) return;
    const dealerIdx = Math.max(0, dealtIn.indexOf(this.state.players[this.state.dealerPosition]));
    const utg = dealtIn[(dealerIdx + 3) % n];
    if (!utg.wantsStraddle || utg.stack <= 0 || utg.isAllIn) return;
    const straddle = this.state.bigBlind * 2;
    const pay = this.postForced(utg, straddle, true);
    this.state.currentBet = Math.max(this.state.currentBet, utg.currentBet);
    this.state.minRaise = straddle;
    this.state.straddle = { playerId: utg.id, amount: pay };
    this.logAction({ playerId: utg.id, action: 'straddle', amount: utg.currentBet, put: pay, stage: 'preflop' });
    // Action starts after the straddler, who gets the last word preflop
    const next = this.gameStateManager.findNextActivePlayer(utg.position);
    if (next) this.state.activePlayer = next.id;
  }

  /**
   * Bomb pot: everyone antes, no preflop betting, the flop is dealt straight away and betting
   * starts there.
   */
  private startBombPot(anteBB: number): void {
    this.state.handKind = 'bomb-pot';
    this.state.bombPotNext = null;
    this.dealHoleCards();
    const ante = Math.max(1, Math.round(anteBB * this.state.bigBlind));
    for (const p of this.gameStateManager.dealtInPlayers()) {
      const pay = this.postForced(p, ante, false);
      this.logAction({ playerId: p.id, action: 'ante', put: pay, stage: 'preflop' });
    }
    this.state.currentBet = 0;
    this.state.minRaise = this.state.bigBlind;
    if (this.state.bettingMode === 'fixed-limit') this.state.limitBets = 0;
    this.dealCommunityCards(3);
    this.gameStateManager.startBettingRound('flop');
    const canAct = this.getActivePlayers().filter(p => !p.isAllIn);
    if (canAct.length < 2) {
      // Antes put (nearly) everyone all-in: deal the rest and settle
      this.dealCommunityCards(5 - this.state.communityCards.length);
      this.determineWinner();
    }
  }

  /** Whether at least two players (not leaving) are sitting in, as a new hand needs. */
  /**
   * Between hands, bring the game in line with who is seated: a player who sat down after the
   * game started joins it, and one who stood up and sat back down returns with the chips they
   * bought in for this time. Returns whether anything changed.
   */
  public syncSeatedPlayers(seated: Array<{ id: string; name: string; seatNumber: number; chips: number }>): boolean {
    if (this.state.stage !== 'showdown' && this.state.stage !== 'awaiting-dealer-choice') return false;
    const dealerId = this.state.players[this.state.dealerPosition]?.id;
    let changed = false;
    for (const s of seated) {
      if (!s.id || !(s.chips > 0)) continue;
      const fresh = {
        name: s.name || s.id,
        position: s.seatNumber,
        stack: s.chips,
        currentBet: 0,
        hasActed: false,
        isFolded: false,
        isAllIn: false,
        consecutiveTimeouts: 0,
        // Dealt in once the big blind reaches them (see dealInWaitingPlayers). In a tournament
        // straight away, away until they open the table so a no-show doesn't hold it up
        ...(this.state.tournamentRules ? { isSittingOut: true, notArrived: true } : { isSittingOut: false, waitingForBigBlind: true }),
        timeBank: 30,
        ...(typeof this.state.startingTimeBanks === 'number' ? { timeBanks: this.state.startingTimeBanks } : {}),
      };
      const existing = this.state.players.find(p => p.id === s.id);
      if (existing && !this.removedPlayers.has(s.id)) continue;
      changed = true;
      if (existing) {
        // Left and came back: they cashed out, so their stack is the new buy-in
        this.removedPlayers.delete(s.id);
        Object.assign(existing, fresh);
        delete existing.holeCards;
        delete existing.leaveAfterHand;
        delete existing.postBigBlindNow;
        delete existing.missedBigBlind;
        if (!this.state.tournamentRules) delete existing.notArrived;
      } else {
        // Dropped at an earlier hand and back now (a tournament rebuy at the same table)
        this.removedPlayers.delete(s.id);
        this.state.players.push({ id: s.id, ...fresh } as Player);
      }
    }
    if (changed) {
      this.state.players.sort((a, b) => a.position - b.position);
      const idx = dealerId ? this.state.players.findIndex(p => p.id === dealerId) : -1;
      if (idx >= 0) this.state.dealerPosition = idx;
    }
    return changed;
  }

  /** Whether a player has left and is dropped from the game at the next hand. */
  public isRemoved(playerId: string): boolean {
    return this.removedPlayers.has(playerId);
  }

  public canStartNewHand(): boolean {
    // Under tournament rules players sitting out are dealt in too
    return this.state.players
      .filter(p => (this.state.tournamentRules || !p.isSittingOut) && !this.removedPlayers.has(p.id))
      .length >= 2;
  }

  /**
   * Play this table by tournament rules: players sitting out stay dealt in, post their blinds and
   * antes and have their hands checked or folded for them, and players who sit down are dealt in
   * straight away. Anyone waiting for the big blind is dealt in from the next hand.
   */
  public useTournamentRules(): void {
    this.state.tournamentRules = true;
    for (const p of this.state.players) {
      delete p.waitingForBigBlind;
      delete p.postBigBlindNow;
      delete p.missedBigBlind;
    }
  }

  /**
   * Sit a player out from the next hand on, or back in. A hand already in progress is unaffected:
   * a player dealt into it plays it out, and one sat out of it stays out until it ends.
   */
  public setSittingOut(playerId: string, sittingOut: boolean): void {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found');
    if (this.state.tournamentRules) {
      // Nothing is owed: a tournament player sitting out keeps posting
      player.isSittingOut = sittingOut;
      delete player.notArrived;
      if (!sittingOut) player.consecutiveTimeouts = 0;
      // Sitting out while it's their turn: act for them now
      if (sittingOut && this.state.activePlayer === playerId && this.state.stage !== 'showdown') this.startTurnClock(Date.now());
      return;
    }
    if (sittingOut && player.waitingForBigBlind) {
      // Still owes the big blind they were waiting for
      player.missedBigBlind = true;
      delete player.waitingForBigBlind;
      delete player.postBigBlindNow;
    }
    player.isSittingOut = sittingOut;
    if (!sittingOut) {
      player.consecutiveTimeouts = 0;
      // Back in after missing the big blind: wait for it, or post one to play straight away
      if (player.missedBigBlind) player.waitingForBigBlind = true;
    }
  }

  /**
   * A player's choices about the next hands: post a big blind now rather than wait for it, or
   * stand up as soon as the current hand ends.
   */
  public setSeatOption(playerId: string, option: 'post-big-blind-now' | 'leave-after-hand', value: boolean): void {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found');
    if (option === 'post-big-blind-now') {
      if (value && !player.waitingForBigBlind) throw new Error('You are not waiting for the big blind');
      if (value) player.postBigBlindNow = true;
      else delete player.postBigBlindNow;
    } else if (value) {
      player.leaveAfterHand = true;
    } else {
      delete player.leaveAfterHand;
    }
  }

  /** After a hand ends, a player who was dealt in may show their cards to the table. */
  public showCards(playerId: string): void {
    if (this.state.stage !== 'showdown') throw new Error('Cards can only be shown after the hand ends');
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found');
    const stud = this.state.studState?.playerCards?.[playerId];
    const hasCards = (player.holeCards?.length || 0) > 0 || (stud?.downCards?.length || 0) > 0;
    if (!hasCards) throw new Error('No cards to show');
    const shown = new Set(this.state.shownCards || []);
    shown.add(playerId);
    this.state.shownCards = Array.from(shown);
    // Showing 7-2 after winning uncontested collects the bounty
    this.maybeAwardSevenDeuceBounty();
  }

  /**
   * Start the clock for the decision now facing activePlayer, or clear it when nobody is to act.
   * The deadline is the base turn time plus whatever is left in that player's time bank.
   */
  private startTurnClock(now: number): void {
    const decisionStage = this.state.stage !== 'showdown' && this.state.stage !== 'awaiting-dealer-choice';
    const player = decisionStage && this.state.activePlayer
      ? this.state.players.find(p => p.id === this.state.activePlayer)
      : undefined;
    if (!player) {
      this.revealMs = 0;
      delete this.state.turnStartedAt;
      delete this.state.turnDeadline;
      return;
    }
    if (this.actForAwayPlayer(player, now)) return;
    // Pineapple's discard: everyone is on the one clock that started with it
    const discard = this.pendingDiscard();
    if (discard && typeof discard.deadline === 'number') {
      this.state.turnStartedAt = discard.startedAt ?? now;
      this.state.turnDeadline = discard.deadline;
      return;
    }
    // The table shows any cards just turned before the decision, so that time is added
    const reveal = this.revealMs;
    this.revealMs = 0;
    this.state.turnStartedAt = now + reveal;
    this.state.turnDeadline = now + reveal + turnTimeMs(this.state) + bankTimeMs(player, this.state);
  }

  /**
   * Under tournament rules a player sitting out is still dealt in, so when the action reaches them
   * the table acts for them at once: check when that is free, otherwise fold. Returns whether it
   * acted (the clock then runs for whoever is next).
   */
  private actForAwayPlayer(player: Player, now: number): boolean {
    if (!this.state.tournamentRules || !player.isSittingOut || this.state.paused || this.state.runItTwicePrompt) return false;
    const type = this.timeoutAction(player);
    this.applyDecision({ type, playerId: player.id, tableId: this.state.tableId, timestamp: now } as PlayerAction, 'timeout', now);
    return true;
  }

  /**
   * What the table does for a player who doesn't act: check when that is free, otherwise fold.
   * The bring-in cannot fold or check, so it is brought in; a face-up 3 in Baseball folds.
   */
  public timeoutAction(player: Player): 'check' | 'fold' | 'bring-in' | 'draw' | 'discard' {
    // In Pineapple's discard, the clock throws away the lowest card
    if (this.pendingDiscard()?.pending.includes(player.id)) return 'discard';
    // In a draw, the clock stands pat
    if (this.pendingDraw()?.pending[0] === player.id) return 'draw';
    if (this.pendingPotMatch()?.queue[0] === player.id) return 'fold';
    if (this.pendingBringIn()?.player === player.id) return 'bring-in';
    return player.currentBet < this.state.currentBet ? 'fold' : 'check';
  }

  /** Charge the time a player took beyond the base turn time to their time bank. */
  private chargeTimeBank(player: Player, now: number): void {
    if (typeof this.state.turnStartedAt !== 'number') return;
    const overMs = now - this.state.turnStartedAt - turnTimeMs(this.state);
    if (overMs <= 0) return;
    if (typeof player.timeBanks === 'number') {
      // Each time bank started counts as used
      player.timeBanks = Math.max(0, player.timeBanks - Math.ceil(overMs / timeBankMs(this.state)));
    } else {
      player.timeBank = Math.max(0, (player.timeBank || 0) - Math.ceil(overMs / 1000));
    }
  }

  /**
   * Act for the player whose clock has run out: check when that is free, otherwise fold.
   * The time bank is used up, and enough timeouts in a row sit the player out from the next hand.
   */
  public handleTimeout(now: number = Date.now()): { playerId: string; action: 'check' | 'fold' | 'bring-in' | 'draw' | 'discard'; satOut: boolean } {
    const playerId = this.state.activePlayer;
    const deadline = this.state.turnDeadline;
    if (!playerId || typeof deadline !== 'number' || now < deadline) {
      throw new Error('The turn has not timed out');
    }
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found');
    const discard = this.pendingDiscard();
    if (discard) {
      // Everyone still choosing is out of time together
      const late = this.state.players.filter(p => discard.pending.includes(p.id));
      late.forEach(p => this.discardLowest(p, true));
      late.forEach(p => {
        p.timeBank = 0;
        if (typeof p.timeBanks === 'number') p.timeBanks = 0;
        p.consecutiveTimeouts = (p.consecutiveTimeouts || 0) + 1;
        if (p.consecutiveTimeouts >= TIMEOUTS_BEFORE_SIT_OUT) p.isSittingOut = true;
      });
      this.continueDiscard();
      this.finishDecision(undefined, 'timeout', now);
      return { playerId, action: 'discard', satOut: !!player.isSittingOut };
    }
    const action = this.timeoutAction(player);
    this.applyDecision({ type: action, playerId, tableId: this.state.tableId, timestamp: now }, 'timeout', now);
    player.timeBank = 0;
    if (typeof player.timeBanks === 'number') player.timeBanks = 0;
    player.consecutiveTimeouts = (player.consecutiveTimeouts || 0) + 1;
    const satOut = player.consecutiveTimeouts >= TIMEOUTS_BEFORE_SIT_OUT;
    if (satOut) player.isSittingOut = true;
    return { playerId, action, satOut };
  }

  // Force-fold a player immediately; if it's their turn, route through standard action logic
  public forceFold(playerId: string): void {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) return;
    if (player.isFolded) return;
    // A bring-in player who leaves still owes the forced bet; post it, then fold out of turn
    if (this.pendingBringIn()?.player === playerId) {
      this.postBringIn();
      this.state.turnSeq = (this.state.turnSeq || 0) + 1;
      this.startTurnClock(Date.now());
    }
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
    // Between hands, a Nicaragua game can be left without enough players to carry on
    if (this.state.stage === 'showdown' || this.state.stage === 'awaiting-dealer-choice') this.settleStrandedNicaragua();
  }

  private dealHoleCards(): void {
  // Deal 2 cards for Hold'em, 4 for Omaha (including Omaha Hi-Lo), 5 for 5-card Omaha
  const rounds = holeCardCount(this.state.variant);
  for (let round = 0; round < rounds; round++) {
      for (let i = 0; i < this.state.players.length; i++) {
        const playerPosition = (this.state.dealerPosition + 1 + i) % this.state.players.length;
        const player = this.state.players[playerPosition];
        // Players already out of the hand as it starts (sitting out, or not in a Nicaragua game)
        if (sitsOutOfHand(player, this.state) || player.isFolded) continue;

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
    
    // Blinds go round the players sitting in; the button is always on one of them
    const dealtIn = this.gameStateManager.dealtInPlayers();
    const dealerIdx = Math.max(0, dealtIn.indexOf(this.state.players[this.state.dealerPosition]));
    const { pot, currentBet } = this.bettingManager.postBlinds(dealtIn, dealerIdx);
    const posters = dealtIn.filter(p => p.currentBet > 0).sort((a, b) => a.currentBet - b.currentBet);
    posters.forEach((p, i) => {
      const action = i === posters.length - 1 && posters.length > 1 ? 'big-blind' : 'small-blind';
      this.logAction({ playerId: p.id, action, amount: p.currentBet, put: p.currentBet, stage: 'preflop' });
    });
    this.log(`Blind amounts: pot=${pot}, currentBet=${currentBet}`);
    
    // Add blind bets to pot
    if (pot > 0) {
      this.addToPot(pot);
    }
    this.state.currentBet = currentBet;
    this.state.minRaise = currentBet;
    // Fixed limit: the big blind is the first bet of the preflop round
    if (this.state.bettingMode === 'fixed-limit') this.state.limitBets = 1;
    
    this.log(`After blinds:`, this.state.players.map(p => ({
      id: p.id,
      stack: p.stack,
      bet: p.currentBet
    })));
    this.log(`Pot: ${this.state.pot}, Current bet: ${this.state.currentBet}, Min raise: ${this.state.minRaise}`);
  }

  // Allow changing betting mode at runtime (e.g., by room configuration update)
  public setBettingMode(mode: BettingMode): void {
    if (mode === 'no-limit') {
      // Remove the optional property to avoid breaking strict equality snapshots
      delete (this.state as any).bettingMode;
    } else {
      this.state.bettingMode = mode;
    }
    this.bettingManager.setMode(mode);
  }

  public handleAction(action: PlayerAction): void {
    this.applyDecision(action, 'player', Date.now());
  }

  private applyDecision(action: PlayerAction, source: 'player' | 'timeout', now: number): void {
    if (this.state.paused) throw new Error('The game is paused');
    const actor = this.state.players.find(p => p.id === action.playerId);
    const stage = this.state.stage;
    const stackBefore = actor?.stack ?? 0;
    const betBefore = actor?.currentBet ?? 0;
    // Baseball: a face-up 3 must match the pot or fold before anyone bets
    const potMatch = this.pendingPotMatch();
    if (potMatch) {
      if (!actor || action.playerId !== potMatch.queue[0]) throw new Error('Invalid action: not player\'s turn');
      this.decidePotMatch(actor, action.type, source);
      this.finishDecision(actor, source, now);
      return;
    }
    if (action.type === 'match-pot') throw new Error('There is no pot to match');
    // Draw games: in turn, each player still in swaps cards or stands pat
    const draw = this.pendingDraw();
    if (draw) {
      if (!actor || action.playerId !== draw.pending[0]) throw new Error('Invalid action: not player\'s turn');
      this.decideDraw(actor, action, source);
      this.finishDecision(actor, source, now);
      return;
    }
    if (action.type === 'draw') throw new Error('There is no draw now');
    // Pineapple: everyone still holding three cards throws one away, all at once
    const discard = this.pendingDiscard();
    if (discard) {
      if (!actor || !discard.pending.includes(actor.id)) throw new Error('You have already discarded');
      if (source === 'timeout') this.discardLowest(actor, true);
      else if (action.type === 'discard') this.decideDiscard(actor, action);
      else throw new Error('Choose a card to throw away');
      this.continueDiscard();
      this.finishDecision(actor, source, now);
      return;
    }
    if (action.type === 'discard') throw new Error('There is nothing to throw away now');
    // Stud third street opens with the bring-in player choosing: bring it in, or complete to a
    // full bet. Folding or checking is not allowed.
    const bringIn = this.pendingBringIn();
    if (action.type === 'bring-in' && !bringIn) throw new Error('There is no bring-in to post');
    if (bringIn && action.playerId === this.state.activePlayer) {
      if (action.type === 'raise') action = { ...action, type: 'bet' };
      if (action.type === 'bring-in' || action.type === 'call') {
        this.postBringIn();
        if (actor && source === 'timeout') {
          const entry = this.state.handActions?.[this.state.handActions.length - 1];
          if (entry?.action === 'bring-in') entry.auto = true;
        }
        this.finishDecision(actor, source, now);
        return;
      }
      if (action.type !== 'bet') throw new Error('Bring it in or complete the bet');
    }
    const opening = this.nicaraguaOpening(action);
    this.applyAction(action);
    if (opening && actor && this.state.nicaragua) {
      this.state.nicaragua.opener = actor.id;
      this.state.nicaragua.method = opening;
    }
    // Completing straight away settles the bring-in
    if (bringIn && action.playerId === bringIn.player) delete bringIn.pending;
    if (actor) {
      const put = Math.max(0, stackBefore - actor.stack);
      const entry: HandActionEntry = { playerId: actor.id, action: action.type, put, stage };
      if (action.type === 'call' || action.type === 'bet' || action.type === 'raise') entry.amount = betBefore + put;
      if (source === 'timeout') entry.auto = true;
      if (opening) entry.method = opening;
      this.logAction(entry);
    }
    this.finishDecision(actor, source, now);
  }

  /** Bookkeeping once a decision was accepted: the time bank, the turn counter and the clock. */
  private finishDecision(actor: Player | undefined, source: 'player' | 'timeout', now: number): void {
    if (actor && source === 'player') {
      this.chargeTimeBank(actor, now);
      actor.consecutiveTimeouts = 0;
    }
    this.state.turnSeq = (this.state.turnSeq || 0) + 1;
    this.startTurnClock(now);
  }

  private applyAction(action: PlayerAction): void {
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
    const { pot, currentBet, minRaise, limitBets } = this.bettingManager.processAction(
      player,
      // A bring-in is posted before this point (see applyDecision); only betting actions get here
      action as Parameters<BettingManager['processAction']>[1],
      this.state.currentBet,
      this.state.minRaise,
      {
        currentPot: this.state.pot,
        players: this.state.players,
        fixedLimit: this.state.bettingMode === 'fixed-limit'
          ? { unit: fixedLimitBetSize(this.state.stage, this.state.bigBlind), bets: this.state.limitBets || 0 }
          : undefined,
      }
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
    if (typeof limitBets === 'number') this.state.limitBets = limitBets;

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

      // Hand back any part of a bet nobody could match before the next cards come
      this.returnUncalledBet();
      // Draw games: the draw follows the first round; the showdown follows the second
      if (isDrawVariant(this.state.variant)) {
        if (this.state.stage === 'preflop' && isNicaraguaVariant(this.state.variant) && !this.state.nicaragua?.opener) this.endUnopenedNicaragua();
        else if (this.state.stage === 'preflop') this.startDraw();
        else this.determineWinner();
        return;
      }
      // Pineapple: everyone throws a card away before the next cards come
      if (this.discardOwed() && this.state.stage === pineappleDiscardStage(this.state.variant)) {
        this.startDiscard();
        return;
      }
      // Midnight Baseball: the next player turns cards to beat the high hand
      if (isMidnightBaseballVariant(this.state.variant)) {
        this.continueMidnight();
        return;
      }
      this.log(`Moving to next stage from ${this.state.stage}`);
      const nextStage = this.gameStateManager.moveToNextStage();

  if (isStudVariant(this.state.variant)) {
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
              if (isSevenCardStudVariant(this.state.variant) && minCount < 7) {
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
            // Courchevel's first flop card is already out
            this.dealCommunityCards(Math.max(0, 3 - this.state.communityCards.length));
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
      // Crazy Pineapple: with nobody left to bet on the flop, the discard comes straight away
      if (this.discardOwed() && nextStage === pineappleDiscardStage(this.state.variant) && this.bettorsLeft() < 2) {
        this.startDiscard();
        return;
      }
      if (isStudVariant(this.state.variant)) this.openStudStreet(nextStage);
      else this.gameStateManager.startBettingRound(nextStage);
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

  /**
   * Give a player a face-up card. Follow the Queen also notes the order face-up cards come out.
   * In Baseball a face-up 4 deals the player an extra card face down straight away, and a face-up
   * 3 is noted so the player can match the pot or fold before the betting.
   */
  private dealUpCard(playerId: string, card: Card): void {
    const stud = this.state.studState!;
    if (!stud.playerCards[playerId]) stud.playerCards[playerId] = { downCards: [], upCards: [] };
    stud.playerCards[playerId].upCards.push(card);
    if (this.state.variant === 'follow-the-queen') (stud.upCardOrder ||= []).push(card);
    if (isBaseballVariant(this.state.variant)) {
      if (card.rank === '4') {
        const extra = this.deckManager.dealCard();
        if (extra) stud.playerCards[playerId].downCards.push(extra);
      } else if (card.rank === '3') {
        this.dealtThrees.push(playerId);
      }
    }
  }

  /**
   * Open betting on a stud street that has just been dealt. In Baseball, anyone dealt a face-up 3
   * first matches the pot or folds, one at a time in deal order.
   */
  private openStudStreet(stage: GameStage): void {
    const threes = this.dealtThrees.filter(id => {
      const p = this.state.players.find(pl => pl.id === id);
      return !!p && !p.isFolded && p.stack > 0;
    });
    this.dealtThrees = [];
    if (threes.length > 0 && this.state.pot > 0 && this.getActivePlayers().length > 1) {
      this.state.stage = stage;
      this.state.studState!.potMatch = { queue: threes, stage };
      this.state.activePlayer = threes[0];
      return;
    }
    this.startStudBetting(stage);
  }

  private startStudBetting(stage: GameStage): void {
    // The bring-in is worked out once any face-up 3s on third street have matched or folded
    if (stage === 'third') this.computeStudBringIn();
    this.gameStateManager.startBettingRound(stage);
  }

  /** The Baseball match-the-pot decisions still to be made this street, if any. */
  private pendingPotMatch(): { queue: string[]; stage: GameStage } | undefined {
    const match = this.state.studState?.potMatch;
    return match && match.queue.length > 0 && this.state.stage === match.stage ? match : undefined;
  }

  /** A player dealt a face-up 3 pays the size of the pot to stay in, or folds. */
  private decidePotMatch(player: Player, type: PlayerAction['type'], source: 'player' | 'timeout'): void {
    const match = this.pendingPotMatch()!;
    const stage = this.state.stage;
    if (type === 'match-pot' || type === 'call') {
      const pay = this.postForced(player, this.state.pot, false);
      const matched = (this.state.studState!.potMatched ||= {});
      matched[player.id] = (matched[player.id] || 0) + pay;
      this.logAction({ playerId: player.id, action: 'match-pot', amount: pay, put: pay, stage, ...(source === 'timeout' ? { auto: true } : {}) });
    } else if (type === 'fold') {
      player.isFolded = true;
      player.hasActed = true;
      this.logAction({ playerId: player.id, action: 'fold', put: 0, stage, ...(source === 'timeout' ? { auto: true } : {}) });
    } else {
      throw new Error('Match the pot or fold');
    }
    match.queue.shift();
    this.continuePotMatch();
  }

  /** Move on to the next face-up 3, or open the betting once everyone has decided. */
  private continuePotMatch(): void {
    const match = this.state.studState?.potMatch;
    if (!match) return;
    match.queue = match.queue.filter(id => {
      const p = this.state.players.find(pl => pl.id === id);
      return !!p && !p.isFolded && p.stack > 0;
    });
    if (this.getActivePlayers().length <= 1) {
      delete this.state.studState!.potMatch;
      this.determineWinner();
      return;
    }
    if (match.queue.length > 0) {
      this.state.activePlayer = match.queue[0];
      return;
    }
    delete this.state.studState!.potMatch;
    // Midnight Baseball: the player who matched carries on turning cards
    if (isMidnightBaseballVariant(this.state.variant)) {
      this.continueMidnight();
      return;
    }
    this.startStudBetting(match.stage);
  }

  /** Midnight Baseball: seven cards each, all face down; nobody may look at their own. */
  private dealMidnightBaseball(): void {
    this.ensureStudState();
    for (let r = 0; r < 7; r++) {
      for (const p of this.state.players) {
        if (sitsOutOfHand(p, this.state)) continue;
        const c = this.deckManager.dealCard();
        if (!this.state.studState!.playerCards[p.id]) this.state.studState!.playerCards[p.id] = { downCards: [], upCards: [] };
        if (c) this.state.studState!.playerCards[p.id].downCards.push(c);
      }
    }
  }

  /** The first player after the button turns the first card. */
  private startMidnightBaseball(): void {
    this.state.stage = 'third';
    const dealer = this.state.players[this.state.dealerPosition];
    const first = this.nextInSeatOrder(dealer?.id, p => !p.isFolded);
    this.state.studState!.midnight = { turn: first?.id };
    this.continueMidnight();
  }

  /** The next player after afterId in seat order (wrapping round) that accept allows. */
  private nextInSeatOrder(afterId: string | undefined, accept: (p: Player) => boolean): Player | undefined {
    const players = this.state.players;
    const n = players.length;
    const start = players.findIndex(p => p.id === afterId);
    for (let i = 1; i <= n; i++) {
      const p = players[(start + i + n) % n];
      if (p && accept(p)) return p;
    }
    return undefined;
  }

  /** How good a player's face-up cards are; -1 before any are turned. */
  private showingScore(playerId: string | undefined): number {
    const up = (playerId && this.state.studState?.playerCards[playerId]?.upCards) || [];
    if (up.length === 0) return -1;
    return evaluateWildHigh(up, tableWildMatcher(this.state) || (() => false)).score;
  }

  /**
   * Midnight Baseball: the player with the high hand showing, who leads the betting. That is the
   * last player to beat it; if they have folded, the best hand still in.
   */
  private midnightHolder(): Player | undefined {
    const mb = this.state.studState?.midnight;
    // Nobody holds it until the first card is turned
    if (!mb?.holder) return undefined;
    const held = this.state.players.find(p => p.id === mb.holder);
    if (held && !held.isFolded) return held;
    let best: Player | undefined;
    let bestScore = -1;
    for (const p of this.state.players) {
      if (p.isFolded) continue;
      const score = this.showingScore(p.id);
      if (score > bestScore) { best = p; bestScore = score; }
    }
    mb.holder = best?.id;
    return best;
  }

  /** The next player after afterId still in the hand, other than the high hand, with a card left to turn. */
  private nextMidnightTurn(afterId: string | undefined): Player | undefined {
    const holder = this.midnightHolder();
    return this.nextInSeatOrder(afterId, p => !p.isFolded && p.id !== holder?.id
      && (this.state.studState?.playerCards[p.id]?.downCards.length || 0) > 0);
  }

  /** Nicaragua: whether the next hand carries on the game (it has a pot carried over and no winner yet). */
  private nicaraguaContinues(): boolean {
    const game = this.state.nicaragua;
    return isNicaraguaVariant(this.state.variant) && !!game && !game.over && (game.carry || 0) > 0;
  }

  /**
   * Nicaragua, as a hand starts: the chips carried into it from earlier hands of the game (none
   * starts a new game, with antes). Other games drop the record of a finished game.
   */
  private startNicaraguaHand(): number {
    if (!isNicaraguaVariant(this.state.variant)) {
      if (!(this.state.nicaragua?.carry)) delete this.state.nicaragua;
      return 0;
    }
    if (!this.nicaraguaContinues()) {
      // Everyone dealt into the first hand is in the game
      this.state.nicaragua = { carry: 0, players: this.state.players.filter(p => !p.isFolded).map(p => p.id) };
      return 0;
    }
    const game = this.state.nicaragua!;
    delete game.opener;
    delete game.method;
    // Players who sat down during the game wait for the next one: they put nothing into the pot
    if (Array.isArray(game.players)) {
      this.state.players.forEach(p => {
        if (!game.players!.includes(p.id)) {
          p.isFolded = true;
          p.hasActed = true;
        }
      });
    }
    return game.carry || 0;
  }

  /**
   * Nicaragua: the first bet before the draw opens, and the opener says how the hand is won.
   * Returns that method for the opening bet; anything else returns undefined.
   */
  private nicaraguaOpening(action: PlayerAction): PlayerAction['method'] {
    if (!isNicaraguaVariant(this.state.variant) || this.state.stage !== 'preflop' || this.state.nicaragua?.opener) return undefined;
    if (action.type !== 'bet' && action.type !== 'raise') return undefined;
    if (!isNicaraguaMethod(action.method)) throw new Error('Choose how the hand is won before you open');
    return action.method;
  }

  /** Nicaragua: nobody opened, so the pot carries into the next hand of the game. */
  private endUnopenedNicaragua(): void {
    const game = (this.state.nicaragua ||= {});
    const pot = this.state.pot;
    game.carry = pot;
    this.state.pot = 0;
    this.state.currentBet = 0;
    this.state.players.forEach(p => { p.currentBet = 0; });
    this.state.stage = 'showdown';
    this.state.activePlayer = '';
    this.state.handWinners = [];
    this.state.handResult = { pot, winnings: {} };
    this.settleStrandedNicaragua();
    this.startTurnClock(Date.now());
  }

  /**
   * Nicaragua, once the pot is awarded: an opener who won any of it ends the game. Otherwise the
   * opener pays the size of the pot (or all they have) into a new pot for another hand. A hand
   * nobody opened that still ended (everyone else folded) also ends the game.
   */
  private finishNicaraguaHand(pot: number, winnings: Record<string, number>): void {
    const game = (this.state.nicaragua ||= {});
    game.carry = 0;
    const opener = this.state.players.find(p => p.id === game.opener);
    // An opener who has left the table has nothing to refill with
    if (!opener || this.removedPlayers.has(opener.id) || (winnings[opener.id] || 0) > 0) {
      game.over = true;
      return;
    }
    const refill = Math.max(0, Math.min(pot, opener.stack));
    if (refill <= 0) {
      game.over = true;
      return;
    }
    opener.stack -= refill;
    game.carry = refill;
    this.logAction({ playerId: opener.id, action: 'match-pot', amount: refill, put: refill, stage: 'showdown' });
    this.settleStrandedNicaragua();
  }

  /**
   * Nicaragua between hands: with fewer than two of the game's players still at the table, the
   * game can't go on, so the carried pot is paid out and the game ends. It goes to the game's
   * player still here, or, if none is, split among everyone still at the table.
   */
  private settleStrandedNicaragua(): void {
    const game = this.state.nicaragua;
    const carry = game?.carry || 0;
    if (!isNicaraguaVariant(this.state.variant) || !game || game.over || carry <= 0) return;
    const here = this.state.players.filter(p => !this.removedPlayers.has(p.id));
    const inGame = here.filter(p => !Array.isArray(game.players) || game.players.includes(p.id));
    if (inGame.length >= 2) return;
    const recipients = inGame.length > 0 ? inGame : here;
    if (recipients.length === 0) return;
    const share = Math.floor(carry / recipients.length);
    let odd = carry - share * recipients.length;
    recipients.forEach(p => {
      p.stack += share + (odd > 0 ? 1 : 0);
      if (odd > 0) odd -= 1;
    });
    game.carry = 0;
    game.over = true;
  }

  /** Pineapple: someone still in the hand holds three cards and has a card to throw away. */
  private discardOwed(): boolean {
    return !!pineappleDiscardStage(this.state.variant) && this.getActivePlayers().some(p => (p.holeCards?.length || 0) > 2);
  }

  /** Pineapple's discard in progress, if any. */
  private pendingDiscard(): { pending: string[]; startedAt?: number; deadline?: number } | undefined {
    const discard = this.state.discardState;
    return discard && discard.pending.length > 0 ? discard : undefined;
  }

  /** Nobody can bet: deal on to the stage the discard follows, then discard. */
  private skipToDiscard(): void {
    const at = pineappleDiscardStage(this.state.variant);
    for (let guard = 0; guard < 4 && this.state.stage !== at && this.state.stage !== 'showdown'; guard++) {
      const next = this.gameStateManager.moveToNextStage();
      if (next === 'flop') this.dealCommunityCards(3);
      else if (next === 'turn' || next === 'river') this.dealCommunityCards(1);
    }
    this.startDiscard();
  }

  /**
   * Pineapple: everyone still in the hand, all-in or not, throws one hole card away. They all
   * choose at once, on one clock; the clock shows on the first of them still choosing.
   */
  private startDiscard(): void {
    const now = Date.now();
    const n = this.state.players.length;
    const pending: string[] = [];
    for (let i = 1; i <= n; i++) {
      const p = this.state.players[(this.state.dealerPosition + i) % n];
      if (p && !p.isFolded && (p.holeCards?.length || 0) > 2 && !pending.includes(p.id)) pending.push(p.id);
    }
    this.state.discardState = { pending, startedAt: now, deadline: now + turnTimeMs(this.state) };
    this.continueDiscard();
  }

  /** Throw away the hole card at discards[0]. */
  private decideDiscard(player: Player, action: PlayerAction): void {
    const hand = player.holeCards || [];
    const at = Array.isArray(action.discards) ? action.discards[0] : undefined;
    if (!Number.isInteger(at) || (at as number) < 0 || (at as number) >= hand.length) throw new Error('Choose a card from your hand to throw away');
    player.holeCards = hand.filter((_, i) => i !== at);
    this.logAction({ playerId: player.id, action: 'discard', put: 0, stage: this.state.stage });
  }

  /** Throw away the lowest hole card (aces high), for a player who ran out of time. */
  private discardLowest(player: Player, auto: boolean): void {
    const weight: Record<Card['rank'], number> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
    const hand = player.holeCards || [];
    if (hand.length <= 2) return;
    let lowest = 0;
    hand.forEach((c, i) => { if (weight[c.rank] < weight[hand[lowest].rank]) lowest = i; });
    player.holeCards = hand.filter((_, i) => i !== lowest);
    this.logAction({ playerId: player.id, action: 'discard', put: 0, stage: this.state.stage, ...(auto ? { auto: true } : {}) });
  }

  /** Move the clock to the next player still choosing; once everyone has, deal on and bet. */
  private continueDiscard(): void {
    const discard = this.state.discardState;
    if (!discard) return;
    discard.pending = discard.pending.filter(id => this.state.players.some(p => p.id === id && !p.isFolded && (p.holeCards?.length || 0) > 2));
    if (this.getActivePlayers().length <= 1) {
      delete this.state.discardState;
      this.determineWinner();
      return;
    }
    if (discard.pending.length > 0) {
      this.state.activePlayer = discard.pending[0];
      return;
    }
    delete this.state.discardState;
    const next = this.gameStateManager.moveToNextStage();
    if (next === 'flop') this.dealCommunityCards(3);
    else if (next === 'turn' || next === 'river') this.dealCommunityCards(1);
    else if (next === 'showdown') {
      this.determineWinner();
      return;
    }
    this.gameStateManager.startBettingRound(next);
  }

  /** Players still able to bet: in the hand and not all-in. */
  private bettorsLeft(): number {
    return this.state.players.filter(p => !p.isFolded && !p.isAllIn).length;
  }

  /**
   * Players with every card turned who are not holding the high hand can no longer win, so they
   * are out. When the high hand is all-in they stay in, as they may still win a side pot.
   */
  private foldDeadMidnightHands(): void {
    const holder = this.midnightHolder();
    if (!holder || holder.isAllIn) return;
    for (const p of this.state.players) {
      if (p.isFolded || p.id === holder.id) continue;
      if ((this.state.studState?.playerCards[p.id]?.downCards.length || 0) > 0) continue;
      p.isFolded = true;
      p.hasActed = true;
      this.logAction({ playerId: p.id, action: 'fold', put: 0, stage: this.state.stage });
      const mb = this.state.studState!.midnight!;
      (mb.outAt ||= {})[p.id] = mb.flips?.length || 0;
    }
  }

  /**
   * Open a betting round led by the high hand (or the next player who can bet, if it is all-in).
   * Returns false when fewer than two players can still bet, so the cards keep being turned.
   */
  private openMidnightBetting(): boolean {
    if (this.bettorsLeft() < 2) return false;
    const holder = this.midnightHolder();
    const canAct = (p: Player) => !p.isFolded && !p.isAllIn;
    const first = holder && canAct(holder) ? holder : this.nextInSeatOrder(holder?.id, canAct);
    if (!first) return false;
    this.state.currentBet = 0;
    this.state.players.forEach(p => { p.currentBet = 0; p.hasActed = false; });
    if (this.state.bettingMode === 'fixed-limit') this.state.limitBets = 0;
    this.state.minRaise = this.state.bigBlind;
    this.state.activePlayer = first.id;
    return true;
  }

  /**
   * Midnight Baseball: the player whose turn it is turns cards one at a time until their face-up
   * cards beat the high hand, and then the betting opens. A face-up 3 stops to match the pot or
   * fold first; a face-up 4 adds a face-down card to turn. A player who turns every card without
   * beating the high hand is out. The hand goes to showdown when nobody else has a card to turn.
   */
  private continueMidnight(): void {
    const stud = this.state.studState!;
    const mb = (stud.midnight ||= {});
    for (let guard = 0; guard < 500; guard++) {
      if (this.getActivePlayers().length <= 1) {
        this.determineWinner();
        return;
      }
      const holder = this.midnightHolder();
      const player = this.state.players.find(p => p.id === mb.turn);
      if (!player || player.isFolded || player.id === holder?.id) {
        const next = this.nextMidnightTurn(player?.id ?? holder?.id);
        if (!next) break;
        mb.turn = next.id;
        continue;
      }
      const score = this.showingScore(player.id);
      if (score >= 0 && (!holder || score > this.showingScore(holder.id))) {
        mb.holder = player.id;
        this.foldDeadMidnightHands();
        mb.turn = this.nextMidnightTurn(player.id)?.id;
        if (this.getActivePlayers().length > 1 && this.openMidnightBetting()) return;
        continue;
      }
      const down = stud.playerCards[player.id]?.downCards || [];
      if (down.length === 0) {
        // Every card turned without beating the high hand
        this.foldDeadMidnightHands();
        mb.turn = this.nextMidnightTurn(player.id)?.id;
        continue;
      }
      this.dealUpCard(player.id, down.shift()!);
      (mb.flips ||= []).push(player.id);
      this.revealMs += MIDNIGHT_FLIP_MS;
      const turnedThree = this.dealtThrees.includes(player.id);
      this.dealtThrees = [];
      // As in Baseball, nothing is asked once nobody else can bet
      if (turnedThree && player.stack > 0 && this.state.pot > 0 && this.bettorsLeft() >= 2) {
        stud.potMatch = { queue: [player.id], stage: this.state.stage };
        this.state.activePlayer = player.id;
        return;
      }
    }
    this.state.activePlayer = '';
    this.determineWinner();
  }

  private dealStudInitial(): void {
    this.ensureStudState();
    if (this.state.variant === 'five-card-stud') {
      // Five-card stud: 1 down, then one up to start (total 2 cards initially)
      for (const p of this.state.players) {
        if (sitsOutOfHand(p, this.state)) continue;
        const c = this.deckManager.dealCard();
        if (!this.state.studState!.playerCards[p.id]) this.state.studState!.playerCards[p.id] = { downCards: [], upCards: [] };
        if (c) this.state.studState!.playerCards[p.id].downCards.push(c);
      }
      for (const p of this.state.players) {
        if (sitsOutOfHand(p, this.state)) continue;
        const c = this.deckManager.dealCard();
        if (c) this.dealUpCard(p.id, c);
      }
    } else {
      // Seven-card stud: 2 down, 1 up initially
      for (let r = 0; r < 2; r++) {
        for (const p of this.state.players) {
          if (sitsOutOfHand(p, this.state)) continue;
          const c = this.deckManager.dealCard();
          if (!this.state.studState!.playerCards[p.id]) this.state.studState!.playerCards[p.id] = { downCards: [], upCards: [] };
          if (c) this.state.studState!.playerCards[p.id].downCards.push(c);
        }
      }
      for (const p of this.state.players) {
        if (sitsOutOfHand(p, this.state)) continue;
        const c = this.deckManager.dealCard();
        if (c) this.dealUpCard(p.id, c);
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
        if (p.isFolded || sitsOutOfHand(p, this.state)) continue;
        const c = this.deckManager.dealCard();
        if (c) this.dealUpCard(p.id, c);
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
        if (p.isFolded || sitsOutOfHand(p, this.state)) continue;
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
    // Razz turns this around: the highest up card brings it in (aces are low), and on a tie the
    // highest suit does. Negating both lets the same "lowest brings in" search below find it.
    if (this.state.variant === 'razz') {
      (Object.keys(weight) as Card['rank'][]).forEach(r => { weight[r] = -(r === 'A' ? 1 : weight[r]); });
      (Object.keys(suitWeight) as Card['suit'][]).forEach(st => { suitWeight[st] = -suitWeight[st]; });
    }
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
      // Nothing is posted yet: the bring-in player acts first and chooses to bring it in for
      // this amount or complete to a full bet (see decideBringIn)
      this.state.studState!.bringIn = { amount: Math.min(amount, player.stack), player: player.id, pending: true };
      if (debugFlags.poker) {
        console.log(`[DEBUG] Stud bring-in computed: player=${player.id} amount=${amount} upcards=`, debug);
      }
    }
  }

  /** The bring-in still waiting for its player to choose, if any. */
  private pendingBringIn(): { amount: number; player: string; pending?: boolean } | undefined {
    const bringIn = this.state.studState?.bringIn;
    return bringIn?.pending && this.state.stage === 'third' ? bringIn : undefined;
  }

  /**
   * Post the bring-in: a forced bet the others must call, complete or fold. The bring-in player
   * only acts again on third street if someone completes or raises.
   */
  private postBringIn(): void {
    const bringIn = this.pendingBringIn();
    if (!bringIn) return;
    const player = this.state.players.find(p => p.id === bringIn.player);
    delete bringIn.pending;
    if (!player) return;
    const pay = Math.min(bringIn.amount, player.stack);
    bringIn.amount = pay;
    player.stack -= pay;
    player.currentBet += pay;
    if (player.stack === 0) player.isAllIn = true;
    this.state.pot += pay;
    this.state.currentBet = Math.max(this.state.currentBet, player.currentBet);
    player.hasActed = true;
    this.logAction({ playerId: player.id, action: 'bring-in', amount: player.currentBet, put: pay, stage: this.state.stage });
    const next = this.gameStateManager.findNextActivePlayer(player.position);
    if (next) this.state.activePlayer = next.id;
  }

  /** The draw in progress, if any. */
  private pendingDraw(): { pending: string[]; muck?: Card[] } | undefined {
    const draw = this.state.drawState;
    return draw && this.state.stage === 'draw' && draw.pending.length > 0 ? draw : undefined;
  }

  /**
   * Draw games: once the first betting round is over, everyone still in draws in turn, starting
   * after the button. Players who are all-in draw too.
   */
  private startDraw(): void {
    this.state.stage = 'draw';
    this.state.currentBet = 0;
    this.state.players.forEach(p => { p.currentBet = 0; p.hasActed = false; });
    const n = this.state.players.length;
    const start = this.state.dealerPosition;
    const pending: string[] = [];
    for (let i = 1; i <= n; i++) {
      const p = this.state.players[(start + i) % n];
      if (p && !p.isFolded && (p.holeCards?.length || 0) > 0 && !pending.includes(p.id)) pending.push(p.id);
    }
    this.state.drawState = { pending, muck: [] };
    this.continueDraw();
  }

  /**
   * Swap the cards at the positions in action.discards (none stands pat): up to 3, or 4 when the
   * card kept is an ace. A player may also fold instead.
   */
  private decideDraw(player: Player, action: PlayerAction, source: 'player' | 'timeout'): void {
    const draw = this.pendingDraw()!;
    const auto = source === 'timeout' ? { auto: true } : {};
    if (action.type === 'fold') {
      player.isFolded = true;
      player.hasActed = true;
      this.logAction({ playerId: player.id, action: 'fold', put: 0, stage: 'draw', ...auto });
    } else if (action.type === 'draw') {
      const hand = player.holeCards || [];
      const positions = [...new Set(Array.isArray(action.discards) ? action.discards : [])];
      if (positions.some(i => !Number.isInteger(i) || i < 0 || i >= hand.length)) throw new Error('Choose cards from your hand to draw');
      const kept = hand.filter((_, i) => !positions.includes(i));
      if (positions.length > 4 || (positions.length === 4 && !kept.some(c => c.rank === 'A'))) {
        throw new Error('You can draw up to 3 cards, or 4 if the card you keep is an ace');
      }
      const thrown = positions.map(i => hand[i]);
      // If the deck runs out, earlier discards are shuffled in; this player's own are not
      if (this.deckManager.getRemainingDeck().length < thrown.length && (draw.muck?.length || 0) > 0) {
        this.deckManager.addShuffledToBottom(draw.muck || []);
        draw.muck = [];
      }
      player.holeCards = [...kept, ...this.deckManager.dealCards(thrown.length)];
      draw.muck = [...(draw.muck || []), ...thrown];
      this.logAction({ playerId: player.id, action: 'draw', put: 0, drawCount: thrown.length, stage: 'draw', ...auto });
    } else {
      throw new Error('Choose cards to draw, or stand pat');
    }
    draw.pending.shift();
    this.continueDraw();
  }

  /** Move on to the next player to draw; once everyone has, open the betting after the draw. */
  private continueDraw(): void {
    const draw = this.state.drawState;
    if (!draw) return;
    draw.pending = draw.pending.filter(id => this.state.players.some(p => p.id === id && !p.isFolded));
    if (this.getActivePlayers().length <= 1) {
      this.determineWinner();
      return;
    }
    if (draw.pending.length > 0) {
      this.state.activePlayer = draw.pending[0];
      return;
    }
    delete this.state.drawState;
    if (this.bettorsLeft() >= 2) {
      this.gameStateManager.startBettingRound('draw');
      return;
    }
    // Nobody left to bet against: straight to the showdown
    this.state.activePlayer = '';
    this.determineWinner();
  }

  /** Settle the hand and record who won chips, which decides whose cards are shown. */
  private determineWinner(): void {
    if (this.state.studState) delete this.state.studState.potMatch;
    delete this.state.drawState;
    delete this.state.discardState;
    const stacksBefore = new Map(this.state.players.map(p => [p.id, p.stack]));
    const starts = this.state.handStartStacks;
    const nicaraguaCarry = this.state.nicaragua?.carry || 0;
    const potBefore = starts && this.state.players.every(p => typeof starts[p.id] === 'number')
      ? this.state.players.reduce((sum, p) => sum + Math.max(0, starts[p.id] - p.stack), 0) + nicaraguaCarry
      : this.state.pot;
    this.settleHand();
    if (this.state.stage === 'showdown') {
      this.state.handWinners = this.state.players
        .filter(p => p.stack > (stacksBefore.get(p.id) ?? p.stack))
        .map(p => p.id);
      const winnings: Record<string, number> = {};
      this.state.players.forEach(p => {
        const won = p.stack - (stacksBefore.get(p.id) ?? p.stack);
        if (won > 0) winnings[p.id] = won;
      });
      this.state.handResult = { pot: potBefore, winnings };
      if (isNicaraguaVariant(this.state.variant)) this.finishNicaraguaHand(potBefore, winnings);
      // A winner turned face up with 7-2 collects the bounty now
      this.maybeAwardSevenDeuceBounty();
      this.startTurnClock(Date.now());
    }
  }

  private settleHand(): void {
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
    if (isStudVariant(this.state.variant)) {
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
    if (isStudVariant(this.state.variant)) {
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
        if (isSevenCardStudVariant(this.state.variant) && minCount < 7) {
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

  const potsToDistribute = this.buildPots(activePlayers);
    this.log(`Pots to distribute: ${JSON.stringify(potsToDistribute)}`);
  const wild = tableWildMatcher(this.state);

  // Special handling: Omaha Hi-Lo (US-052)
  if (isOmahaHiLoVariant(this.state.variant)) {
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
        if (wild) {
          const best = evaluateWildOmaha(p.holeCards || [], this.state.communityCards, wild);
          highStrengths.set(p.id, { score: best.score, view: { cards: best.cards, description: best.name } });
          return;
        }
        const hr = HandEvaluator.getOmahaHandRanking(p.holeCards || [], this.state.communityCards);
        const score = computeHighScore(hr.cards, hr.rank);
        highStrengths.set(p.id, { score, view: { cards: hr.cards, description: hr.name } });
      });

      // Precompute low evaluations (8-or-better, Ace-to-Five), store ranks arrays for comparison
      const lowEvals = new Map<string, { ranks: number[] }>();
      activePlayers.forEach(p => {
        const low = wild
          ? evaluateWildOmahaLow(p.holeCards || [], this.state.communityCards, wild)
          : HandEvaluator.evaluateOmahaLowEightOrBetter(p.holeCards || [], this.state.communityCards);
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
          const cmp = HandEvaluator.compareAceToFiveLow;
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
        if (wild) {
          highStrengths.set(p.id, { score: evaluateWildHigh(all, wild).score });
          const wildLow = evaluateWildLow(all, wild);
          if (wildLow) lowEvals.set(p.id, { ranks: wildLow.ranks });
          return;
        }
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
          const cmp = HandEvaluator.compareAceToFiveLow;
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
  if (this.state.variant === 'seven-card-stud' || this.state.variant === 'five-card-stud' || this.state.variant === 'razz' || hasBuiltInWilds(this.state.variant)) {
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
        if (this.state.variant === 'razz' && wild) {
          const low = evaluateWildRazz(all, wild);
          strengths.set(p.id, low.strength);
          handViews.set(p.id, { cards: low.lowCards, description: low.description });
          return;
        }
        if (wild) {
          const best = evaluateWildHigh(all, wild);
          strengths.set(p.id, best.score);
          handViews.set(p.id, { cards: best.cards, description: best.name });
          return;
        }
        if (this.state.variant === 'razz') {
          // Razz: the best ace-to-five low takes the whole pot
          const low = HandEvaluator.evaluateRazzLow(all);
          strengths.set(p.id, HandEvaluator.razzStrength(all));
          handViews.set(p.id, { cards: low.lowCards, description: low.description });
          return;
        }
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
      if (isNicaraguaVariant(this.state.variant)) {
        // The opener's method decides who wins
        const method = this.state.nicaragua?.method || 'high';
        strengths.set(p.id, nicaraguaScore(p.holeCards || [], method));
        handViews.set(p.id, { cards: p.holeCards || [], description: describeNicaraguaHand(p.holeCards || [], method) });
        return;
      }
      if (wild) {
        const best = isOmahaVariant(this.state.variant)
          ? evaluateWildOmaha(p.holeCards || [], this.state.communityCards, wild)
          : evaluateWildHigh([...(p.holeCards || []), ...this.state.communityCards], wild);
        strengths.set(p.id, best.score);
        handViews.set(p.id, { cards: best.cards, description: best.name });
        return;
      }
  const hr = (isOmahaVariant(this.state.variant)
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

  /** Dealer's Choice: the wild cards for the hands the dealer chose; undefined for none. */
  public setWildRule(rule?: WildRule): void {
    if (rule) this.state.wildRule = rule;
    else delete this.state.wildRule;
    this.syncBuiltInWilds();
  }

  /** Games with their own wild cards always play them; leaving such a game drops them. */
  private syncBuiltInWilds(): void {
    const own = builtInWildRule(this.state.variant);
    if (own) this.state.wildRule = own;
    // A game's own wild rule is named after the game
    else if (this.state.wildRule && hasBuiltInWilds(this.state.wildRule)) delete this.state.wildRule;
  }

  // Allow changing variant at runtime before a hand starts
  public setVariant(variant: GameVariant): void {
    if (variant) {
      this.state.variant = variant;
    } else {
      delete (this.state as any).variant;
    }
    this.syncBuiltInWilds();
  }

  // US-029: Execute run-it-twice using separate decks/boards per run and equal pot split
  /**
   * Split the pot into the main pot and side pots for showdown.
   * Uses each player's contribution over the whole hand (hand-start stack minus current stack).
   * Falls back to the current round's bets when no snapshot exists or it doesn't account for
   * the pot (state saved before snapshots existed, or stacks edited outside of play).
   */
  private buildPots(activePlayers: Player[]): SidePot[] {
    const betsTotal = this.state.players.reduce((sum, p) => sum + (p.currentBet || 0), 0);
    const potTotal = this.state.pot > 0 ? this.state.pot : betsTotal;
    const startStacks = this.state.handStartStacks;
    if (startStacks && this.state.players.every(p => typeof startStacks[p.id] === 'number')) {
      const contributions = this.state.players.map(p => ({
        id: p.id,
        contributed: Math.max(0, startStacks[p.id] - p.stack),
        isFolded: p.isFolded || !activePlayers.some(a => a.id === p.id),
      }));
      const contributedTotal = contributions.reduce((sum, c) => sum + c.contributed, 0);
      // Nicaragua: the pot carried from earlier hands is in the pot but was put in by nobody this hand
      const carried = isNicaraguaVariant(this.state.variant) ? this.state.nicaragua?.carry || 0 : 0;
      if (contributedTotal + carried === potTotal) {
        // Baseball: chips paid to match the pot are dead money that any player still in can win,
        // not a bet the others had to call, so they stay out of the side-pot split
        const matched = this.state.studState?.potMatched || {};
        // The carried pot is dead money the same way
        let dead = carried;
        contributions.forEach(c => {
          const m = Math.min(c.contributed, matched[c.id] || 0);
          c.contributed -= m;
          dead += m;
        });
        const pots = PotCalculator.calculatePotsFromContributions(contributions);
        return dead > 0 ? [{ amount: dead, eligiblePlayers: activePlayers.map(p => p.id) }, ...pots] : pots;
      }
      this.log(`Hand contributions (${contributedTotal}) do not match pot (${potTotal}); using current-round bets`);
    }

    const sidePots = PotCalculator.calculateSidePots(
      this.state.players.map(p => ({ id: p.id, stack: p.stack, currentBet: p.currentBet, isFolded: p.isFolded }))
    );
    const baseAmount = Math.max(0, this.state.pot - betsTotal);
    const basePot = baseAmount > 0 ? [{ amount: baseAmount, eligiblePlayers: activePlayers.map(p => p.id) }] : [];
    return [...basePot, ...sidePots];
  }

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
      this.settleHand();
      return;
    }

    // Every run's board comes from one deck, so no card appears on two runs
    this.dealRunItTwiceBoards();
    const boards = rit.boards;
    const hiLo = isOmahaHiLoVariant(this.state.variant);
    const omaha = isOmahaVariant(this.state.variant);

    // Each pot (main and side) is split evenly across the runs; odd chips go to the earliest runs.
    // On each run, a pot goes to the best hand among the players eligible for it.
    const pots = this.buildPots(activePlayers);
    const runs = rit.numberOfRuns;
    const potShares = pots.map(pot =>
      Array.from({ length: runs }, (_, r) => Math.floor(pot.amount / runs) + (r < pot.amount % runs ? 1 : 0))
    );

    const aggregate: Map<string, number> = new Map();
    const results = [] as {
      boardId: string;
      winners: Array<{ playerId: string; winningHand: HandRanking; potShare: number }>
    }[];

    for (let r = 0; r < rit.numberOfRuns; r++) {
      const runBoard = boards[r];

      // Evaluate winners on this run's board; enforce Omaha rules when applicable
      const evals = activePlayers.map(player => ({
        playerId: player.id,
        evaluation: (omaha ? HandEvaluator.evaluateOmahaHand : HandEvaluator.evaluateHand)
          .call(HandEvaluator, player.holeCards || [], runBoard)
      }));
      const bestOf = (candidates: typeof evals) => candidates.filter(ph =>
        !candidates.some(other => ph !== other && HandEvaluator.compareHands(other.evaluation.hand, ph.evaluation.hand) > 0)
      );
      // Hi-Lo: qualifying 8-or-better lows on this board (lower ranks win)
      const lows = new Map<string, { ranks: number[]; lowCards: Card[] }>();
      if (hiLo) {
        activePlayers.forEach(p => {
          const low = HandEvaluator.evaluateOmahaLowEightOrBetter(p.holeCards || [], runBoard);
          if (low) lows.set(p.id, low);
        });
      }
      const cmpLow = HandEvaluator.compareAceToFiveLow;
      const sides = new Map<string, Set<'high' | 'low'>>();
      const pay = (ids: string[], amount: number, side: 'high' | 'low', into: Map<string, number>) => {
        const per = Math.floor(amount / ids.length);
        const extra = amount % ids.length;
        ids.forEach((id, idx) => {
          into.set(id, (into.get(id) || 0) + per + (idx < extra ? 1 : 0));
          if (!sides.has(id)) sides.set(id, new Set());
          sides.get(id)!.add(side);
        });
      };

      // Award this run's share of each pot to the best eligible hand(s)
      let runPot = 0;
      const runWinnings = new Map<string, number>();
      pots.forEach((pot, i) => {
        const share = potShares[i][r];
        if (share <= 0) return;
        runPot += share;
        const eligible = evals.filter(e => pot.eligiblePlayers.includes(e.playerId));
        const pool = eligible.length > 0 ? eligible : evals;
        const highWinners = bestOf(pool).map(w => w.playerId);
        // Hi-Lo: the low half goes to the best qualifying low, if anyone has one
        const lowPool = pool.map(w => w.playerId).filter(id => lows.has(id));
        let lowWinners: string[] = [];
        if (hiLo && lowPool.length > 0) {
          const best = lowPool.reduce((m, id) => (cmpLow(lows.get(id)!.ranks, lows.get(m)!.ranks) < 0 ? id : m), lowPool[0]);
          lowWinners = lowPool.filter(id => cmpLow(lows.get(id)!.ranks, lows.get(best)!.ranks) === 0);
        }
        if (lowWinners.length > 0) {
          // Odd chip goes to the high side
          pay(highWinners, Math.ceil(share / 2), 'high', runWinnings);
          pay(lowWinners, Math.floor(share / 2), 'low', runWinnings);
        } else {
          pay(highWinners, share, 'high', runWinnings);
        }
      });

      const runWinners: Array<{ playerId: string; winningHand: HandRanking; potShare: number; side?: 'high' | 'low' | 'both' }> = [];
      runWinnings.forEach((potShare, playerId) => {
        aggregate.set(playerId, (aggregate.get(playerId) || 0) + potShare);
        const won = sides.get(playerId) || new Set(['high']);
        const holeCards = activePlayers.find(p => p.id === playerId)?.holeCards || [];
        const low = lows.get(playerId);
        const winningHand: HandRanking = won.has('high') || !low
          ? (omaha ? HandEvaluator.getOmahaHandRanking : HandEvaluator.getHandRanking).call(HandEvaluator, holeCards, runBoard)
          : { rank: 0, name: `Low ${low.ranks.slice().reverse().map(n => (n === 1 ? 'A' : String(n))).join('-')}`, cards: low.lowCards, kickers: [], strength: 0 };
        const side = hiLo ? (won.size === 2 ? 'both' : won.has('low') ? 'low' : 'high') : undefined;
        runWinners.push(side ? { playerId, winningHand, potShare, side } : { playerId, winningHand, potShare });
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
          if (!runtime.isCI || this.debugEnabled) {
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

    // Persist results on state and finalize; every board is now face up
    rit.results = results;
    rit.revealed = boards.map(board => board.length);
    rit.potDistribution = Array.from(aggregate.entries()).map(([playerId, amount]) => ({ playerId, amount }));
    this.state.stage = 'showdown';
    this.state.activePlayer = '';
  }

  // Public helper to trigger RIT resolution immediately (for tests/integration when betting is closed)
  public runItTwiceNow(): void {
    if (!this.state.runItTwice?.enabled) throw new Error('Run It Twice is not enabled');
    // Through determineWinner, so the winners and pot are recorded like any other showdown
    this.determineWinner();
  }

  /** Every card dealt this hand: all players' cards, folded hands included, and the board. */
  private dealtCards(): Card[] {
    const cards: Card[] = [...this.state.communityCards];
    this.state.players.forEach(p => (p.holeCards || []).forEach(c => cards.push(c)));
    Object.values(this.state.studState?.playerCards || {}).forEach(s => cards.push(...(s.downCards || []), ...(s.upCards || [])));
    return cards;
  }

  /**
   * Deal every run's board from one deck: the cards not dealt this hand, shuffled from the first
   * run seed so the boards can be verified once the seeds are published. The runs share the
   * cards already on the board, and no card appears on two runs.
   */
  private dealRunItTwiceBoards(): void {
    const rit = this.state.runItTwice;
    if (!rit) return;
    if (rit.boards.length === rit.numberOfRuns && rit.boards.every(board => board.length === 5)) return;
    const shared = [...this.state.communityCards];
    const missing = 5 - shared.length;
    const seedStr = rit.seeds[0] || '1';
    const seedNum = Array.from(seedStr).reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 0);
    const deck = DeckManager.fromExcluding(this.dealtCards(), seedNum);
    rit.boards = Array.from({ length: rit.numberOfRuns }, () => [...shared, ...deck.dealCards(missing)]);
    rit.revealed = rit.boards.map(() => shared.length);
  }

  /**
   * Run the board out more than once after the all-in. The board goes back to what players saw
   * when the decision was offered (cards dealt after that were never shown and return to the
   * deck), then every run's board is dealt, to be revealed run by run.
   */
  public startRunItTwice(runs: number, visibleBoardCount?: number): void {
    if (typeof visibleBoardCount === 'number' && visibleBoardCount >= 0 && visibleBoardCount < this.state.communityCards.length) {
      this.state.communityCards = this.state.communityCards.slice(0, visibleBoardCount);
      this.state.stage = visibleBoardCount >= 4 ? 'turn' : visibleBoardCount === 3 ? 'flop' : 'preflop';
    }
    const missing = 5 - this.state.communityCards.length;
    if (missing * runs > 52 - this.dealtCards().length) {
      throw new Error('Not enough cards left to run it that many times');
    }
    this.enableRunItTwice(runs);
    this.dealRunItTwiceBoards();
  }

  /** Reveal the next street of the next run. Returns false once every run is face up. */
  public revealRunItTwiceStep(): boolean {
    const rit = this.state.runItTwice;
    if (!rit?.enabled || !rit.revealed || rit.boards.length === 0) return false;
    const run = rit.revealed.findIndex((shown, i) => shown < rit.boards[i].length);
    if (run < 0) return false;
    const shown = rit.revealed[run];
    rit.revealed = rit.revealed.map((n, i) => (i === run ? (shown < 3 ? 3 : shown + 1) : n));
    return true;
  }

  // Dealer's Choice tables pause the game until the dealer selects a variant
  public pauseForDealerChoice(): TableState {
    // Each dealer's-choice round starts at this pause
    this.state.dealersChoiceHandCount = 0;
    this.state.stage = 'awaiting-dealer-choice';
    this.state.activePlayer = '';
    this.startTurnClock(Date.now());
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
    // Use JSON serialization for deep cloning to ensure complete state capture
    return {
      tableState: JSON.parse(JSON.stringify(this.state)),
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
