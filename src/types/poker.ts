// Extended to support Seven-card Stud streets (US-053)
export type GameStage =
  | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' // Hold'em/Omaha
  | 'third' | 'fourth' | 'fifth' | 'sixth' | 'seventh' // Seven-card Stud
  | 'awaiting-dealer-choice'; // Dealer's Choice pre-hand pause

// Game variant type - shared across TableState and PokerEngine
export type GameVariant = 'texas-holdem' | 'omaha' | 'omaha-hi-lo' | 'seven-card-stud' | 'seven-card-stud-hi-lo' | 'five-card-stud'
  // Razz: seven-card stud played for the lowest hand. 'omaha-5': Omaha with five hole cards.
  | 'razz' | 'omaha-5';

// How much a player may bet: any amount, up to the pot, or one fixed bet per bet or raise
export type BettingMode = 'no-limit' | 'pot-limit' | 'fixed-limit';

/** One game in a mixed-game rotation, with the betting it is played with. */
export interface MixedGameEntry {
  variant: GameVariant;
  bettingMode: BettingMode;
}

export interface Card {
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades';
  rank: '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';
}

export type GameAction = {
  type: 'initialize' | 'join' | 'leave' | 'start' | 'deal' | 'bet' | 'call' | 'raise' | 'fold' | 'timeout' | 'error';
  playerId?: string;
  tableId: string;
  amount?: number;
  timestamp: number;
  metadata?: any;
}

export interface Player {
  id: string;
  name: string;
  position: number;
  stack: number;
  holeCards?: Card[];
  currentBet: number;
  hasActed: boolean;
  isFolded: boolean;
  isAllIn: boolean;
  // Seconds of extra thinking time left once the base turn clock runs out; used up across the game.
  // Only read for games saved before time banks were counted (see timeBanks).
  timeBank: number;
  // Time banks left; each adds the table's timeBankSeconds once the base turn time runs out
  timeBanks?: number;
  // Not dealt in, posts no blinds and is skipped by the button until they sit back in
  isSittingOut?: boolean;
  // Turns in a row the clock ran out on; reset when the player acts
  consecutiveTimeouts?: number;
  // Asked to straddle (post twice the big blind under the gun) next hand
  wantsStraddle?: boolean;
  // Joined (or came back owing a big blind) and is not dealt in until the big blind reaches them
  waitingForBigBlind?: boolean;
  // While waiting: post a big blind to be dealt in at the next hand instead
  postBigBlindNow?: boolean;
  // Sat out while the big blind passed them, so they owe one when they sit back in
  missedBigBlind?: boolean;
  // Stand up as soon as the current hand ends
  leaveAfterHand?: boolean;
}

/** One entry in a hand's action log, kept for hand history and the replayer. */
export interface HandActionEntry {
  playerId: string;
  action: 'small-blind' | 'big-blind' | 'straddle' | 'ante' | 'bring-in' | 'fold' | 'check' | 'call' | 'bet' | 'raise'
    // Paid after the hand, straight to the player in toPlayerId rather than into the pot
    | 'bounty'
    // The part of a bet nobody could call, handed back when the betting round ends (put is negative)
    | 'uncalled';
  // The player's total bet on this street after the action, where that applies
  amount?: number;
  // Chips this action moved from the player's stack into the pot (for a bounty, to toPlayerId)
  put: number;
  // Bounty: the player who was paid
  toPlayerId?: string;
  stage: GameStage;
  // Taken by the turn clock rather than the player
  auto?: boolean;
}

export interface TableState {
  tableId: string;
  stage: GameStage;
  players: Player[];
  activePlayer: string;
  pot: number;
  // Each player's stack when the current hand started; start minus current stack is what
  // they have put into the pot this hand, which sets the side pots at showdown
  handStartStacks?: Record<string, number>;
  // Dealer's Choice: hands started since the last variant choice. Kept in the saved state
  // (not server memory) so every server instance sees the same count.
  dealersChoiceHandCount?: number;
  // Increases with every applied action and every new hand. Clients send the value they
  // acted on, so a duplicate or late request can't land on a later decision.
  turnSeq?: number;
  // Turn clock for the player in activePlayer (epoch ms, server clock): when the turn started and
  // when it times out, base time plus that player's time bank
  turnStartedAt?: number;
  turnDeadline?: number;
  // Base time for each decision at this table (ms); unset means the default
  turnTimeMs?: number;
  // Length of one time bank at this table (seconds)
  timeBankSeconds?: number;
  // Time banks a player starts with, for players who sit down after the game started
  startingTimeBanks?: number;
  // Added when the state is sent to a client: ms left on the clock at that moment, so clients
  // count down without depending on their own clock matching the server's
  turnTimeRemainingMs?: number;
  // Players who won chips in the hand just settled; set at showdown, cleared when a hand starts
  handWinners?: string[];
  // Players who chose to show their cards after the hand ended
  shownCards?: string[];
  // Identity of the current hand and what has happened in it, for hand history
  handId?: string;
  handNumber?: number;
  handStartedAt?: number;
  handActions?: HandActionEntry[];
  // Set when the hand is settled: chips in the pot and what each winner took from it
  handResult?: { pot: number; winnings: Record<string, number> };
  // Host has paused the game: no actions, no clock, no new hands
  paused?: boolean;
  pausedTurnRemainingMs?: number;
  // Blinds the host set, taking effect when the next hand starts
  pendingBlinds?: { smallBlind: number; bigBlind: number };
  // Table allows an under-the-gun straddle (Hold'em and Omaha)
  allowStraddle?: boolean;
  // Table offers run it twice after an all-in (a room setting; off unless the room turned it on)
  allowRunItTwice?: boolean;
  // The straddle posted this hand, if any
  straddle?: { playerId: string; amount: number };
  // Next hand is a bomb pot: everyone antes this many big blinds and betting starts on the flop
  bombPotNext?: { anteBB: number } | null;
  // What kind of hand is being played
  handKind?: 'normal' | 'bomb-pot';
  communityCards: Card[];
  currentBet: number;
  dealerPosition: number;
  smallBlind: number;
  bigBlind: number;
  minRaise: number;
  lastRaise: number;
  // Optional game variant; when set to 'omaha' or 'omaha-hi-lo', rules and dealing are adapted accordingly
  variant?: GameVariant;
  // Betting mode for the table: 'no-limit' (default), 'pot-limit' or 'fixed-limit'
  bettingMode?: BettingMode;
  // Fixed limit: full bets and raises made on the current street (the big blind counts as the
  // first one preflop; a stud bring-in does not). Betting is capped at FIXED_LIMIT_CAP.
  limitBets?: number;
  // Room option: every player dealt into a Hold'em or Omaha hand posts this ante (0 or unset = none)
  ante?: number;
  // Room option (Hold'em only): winning a pot with 7-2 and showing it collects this from every
  // other player dealt in (0 or unset = off)
  sevenDeuceBounty?: number;
  // The 7-2 bounty paid in the current hand, once it has been won
  sevenDeuceResult?: { playerId: string; total: number; payments: Record<string, number> };
  // Mixed games: the games played in turn, each for handsPerGame hands. index is the game being
  // played and handsInGame how many of its hands have started. Kept in the saved state, not in
  // server memory, so every server instance agrees on where the rotation is.
  mixedGame?: { games: MixedGameEntry[]; handsPerGame: number; index: number; handsInGame: number };
  // Policy: when true, Run It Twice requires unanimous consent from all active players
  requireRunItTwiceUnanimous?: boolean;
  // US-029: Run It Twice state (set only when enabled)
  runItTwice?: RunItTwice;
  // RIT prompt metadata when waiting on a specific player to decide
  runItTwicePrompt?: RunItTwicePrompt | null;
  // When true, the prompt for the current hand has been resolved and should not reappear
  runItTwicePromptDisabled?: boolean;
  // US-052/US-054: Hi-Lo last showdown results (optional, present for omaha-hi-lo or seven-card-stud-hi-lo)
  lastHiLoResult?: {
    high: Array<{ playerId: string; amount: number }>;
    low: Array<{ playerId: string; amount: number }> | null;
  };
  // US-052/US-054: Optional player declarations for Hi-Lo variants
  hiLoDeclarations?: Record<string, 'high' | 'low' | 'both'>;
  // US-052/US-054: Low hand qualifier value (defaults to 8 for Hi-Lo variants)
  lowHandQualifier?: 8;
  // US-053: Seven-card Stud per-player cards and bring-in tracking
  studState?: {
    playerCards: Record<string, { downCards: Card[]; upCards: Card[] }>;
    // pending: the bring-in player has yet to choose between bringing it in and completing
    bringIn?: { amount: number; player: string; pending?: boolean };
  };
}

export interface BettingRound {
  stage: GameStage;
  startPosition: number;
  activePosition: number;
  minBet: number;
  currentBet: number;
  lastRaise: number;
}

export interface PlayerAction {
  // bring-in: the stud bring-in player posting the bring-in rather than completing
  type: 'bet' | 'call' | 'raise' | 'fold' | 'check' | 'bring-in';
  playerId: string;
  tableId: string;
  amount?: number;
  timestamp: number;
}

export interface HandResult {
  playerId: string;
  hand: Card[];
  description: string;
  strength: number;
  winAmount: number;
}

// US-026: Hand Rankings types
export enum HandRank {
  HighCard = 1,
  OnePair = 2,
  TwoPair = 3,
  ThreeOfAKind = 4,
  Straight = 5,
  Flush = 6,
  FullHouse = 7,
  FourOfAKind = 8,
  StraightFlush = 9,
  RoyalFlush = 10
}

export interface HandRanking {
  rank: number; // numeric rank (1-10) aligned with HandRank
  name: string; // e.g., "Full House"
  cards: Card[]; // best 5 cards forming the hand
  kickers: Card[]; // tie-breakers in order (if applicable)
  strength: number; // same as rank for now; reserved for extended scoring
}

// US-029: Run It Twice types
export interface PotSplit {
  playerId: string;
  amount: number;
}

export interface RunResult {
  boardId: string;
  winners: Array<{
    playerId: string;
    winningHand: HandRanking;
    potShare: number;
    // Hi-Lo games: which half of the pot this player won on this run
    side?: 'high' | 'low' | 'both';
  }>;
}

export interface RunItTwice {
  enabled: boolean;
  numberOfRuns: number; // 2-4
  boards: Card[][]; // Full community boards per run
  // Cards of each board shown to players so far; the rest stay hidden until revealed
  revealed?: number[];
  results: RunResult[];
  potDistribution: PotSplit[]; // aggregated distribution across runs
  seeds: string[]; // RNG seeds (opaque strings)
  // US-030: RNG Security metadata for audit/verification
  rngSecurity?: {
    seedGeneration: {
      entropy: any; // stored opaque; not serialized to clients
      timestamp: number;
      playerEntropy: string;
      vrf: string;
    };
    verification: {
      publicSeed: string;
      hashChain: string[];
      proof: string; // may be withheld from clients; used server-side for verification
    };
  };
}

export interface RunItTwicePrompt {
  playerId: string; // the player who must make the decision
  reason: 'lowest-hand';
  createdAt: number; // epoch ms when prompt issued
  boardCardsCount: number; // number of community cards visible at prompt time
  handDescription?: string; // textual summary of their current best hand
  highestHandDescription?: string; // textual summary of the highest hand among eligible players
  handDescriptionsByPlayer?: Record<string, string>; // per-player best-hand description for eligible players
  eligiblePlayerIds: string[]; // players considered when determining lowest hand
  tiedWith?: string[]; // other players with identical strength when tie-breaking randomly
}

// US-032: Disconnection handling
export interface DisconnectionState {
  playerId: string;
  graceTime: number; // in ms
  autoAction: {
    type: 'fold' | 'check-fold';
    executeAt: Date;
  };
  preservedStack: number;
  position: number;
  reconnectBy: Date;
}
