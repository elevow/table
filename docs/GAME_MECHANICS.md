# Game Mechanics Specification

## Betting Structures

### No-Limit
1. Basic Rules
   - Players can bet any amount up to their entire stack
   - Minimum bet equals the big blind
   - Minimum raise must equal previous raise amount
   - No maximum number of raises
   - All-in bets     - Independent RNG seeds per board
      - Parallel deck management
      - Cross-run verification
      - Seed publication system
      - Audit trail per board

2. Run it Twice RNG Implementation
   a. Seed Generation
      - Unique seed per board run
      - Hardware-based entropy source
      - Timestamp incorporation
      - Player action entropy
      - Verifiable random function (VRF)

   b. Deck Management
      - Complete deck reset per run
      - Independent shuffle sequences
      - Card removal tracking
      - Burn card management
      - State verification checksums

   c. Verification System
      - Public seed verification
      - Hash chain implementation
      - Replay capability
      - Multi-party computation
      - Zero-knowledge proofs

   d. Security Measures
      - Timing attack prevention
      - Memory isolation
      - Secure seed storage
      - Audit log encryption
      - Tamper detection

3. Anti-Collusionminimum are allowed

2. All-in Rules
   - Player can go all-in for less than minimum bet
   - Side pots created when players can't match full bet
   - Main pot and side pots awarded separately
   - Players all-in for less than full bet only eligible for proportionate share

3. Run it Twice Option
   - Available when all remaining players are all-in
   - Requires unanimous agreement from all players involved
   - Deals remaining community cards twice
   - Pot is split 50/50 between each board result
   - Option to run it more than twice (three times, four times)
   - Each run uses a separate deck and RNG seed
   - Available in cash games only (not tournaments)

### Fixed-Limit
1. Basic Rules
   - Betting amounts are pre-set and fixed
   - Small bet used in early rounds
   - Big bet used in later rounds
   - Maximum of four bets per round: bet + three raises
   - All-in bets under limit are allowed

2. Specific Limits
   - Early Streets (First Two):
     - Bets and raises equal to small bet
     - Example: $2/$4 game uses $2 bets
   - Later Streets:
     - Bets and raises equal to big bet
     - Example: $2/$4 game uses $4 bets

### Pot-Limit
1. Basic Rules
   - Maximum bet equals current pot size
   - Minimum bet equals the big blind
   - Includes all previous bets and calls
   - All-in bets under minimum are allowed
   - Pot size includes current bet when calculating raise

2. Calculation Rules
   - Maximum bet = current pot + all bets on table + amount to call
   - Dealer must announce pot size on request
   - Players must declare raises before putting chips in pot

### Spread-Limit
1. Basic Rules
   - Bets allowed within specified range
   - Example: $2-$10 spread means any bet between those amounts
   - Raises must be at least the size of previous bet
   - All-in bets under minimum are allowed

2. Raise Rules
   - Raises can be up to maximum spread amount
   - Multiple raises allowed
   - Must be at least minimum spread amount
   - Cannot exceed maximum spread amount

## Poker Variants

### Texas Hold'em
1. Game Flow
   - Pre-game setup (position assignment, blind posting)
   - Pre-flop betting round
   - Flop (3 community cards) and betting round
   - Turn (4th community card) and betting round
   - River (5th community card) and betting round
   - Showdown or pot award

2. Common Betting Structures
   - Most common: No-Limit
   - Also played: Fixed-Limit, Pot-Limit
   - Tournament standard: No-Limit
   - Cash game options: All structures supported

3. Hand Rankings
   - Royal Flush
   - Straight Flush
   - Four of a Kind
   - Full House
   - Flush
   - Straight
   - Three of a Kind
   - Two Pair
   - One Pair
   - High Card

3. Betting Rules
   - No-Limit Structure
     - Minimum bet = Big Blind
     - Maximum bet = Player's stack
     - Minimum raise = Previous bet amount
   - Pot-Limit Structure
     - Maximum bet = Current pot size
     - Minimum bet = Big Blind

### Omaha
1. Game Flow
   - Similar to Texas Hold'em
   - Four hole cards dealt to each player
   - Must use exactly two hole cards

2. Common Betting Structures
   - Most common: Pot-Limit
   - Also played: No-Limit, Fixed-Limit
   - Tournament standard: Pot-Limit
   - Cash game options: All structures supported

### Seven-card Stud
1. Game Flow
   - Ante and bring-in
   - Two hole cards and one up card
   - Betting rounds after each additional up card
   - Final card dealt face down
   - Five betting rounds total

### Five-card Draw
1. Game Flow
   - Ante (optional)
   - Deal five cards face down
   - Initial betting round
   - Draw phase (discard and replace up to 5 cards)
   - Final betting round
   - Showdown

2. Betting Rules
   - Fixed-limit structure common
   - Minimum bet = Big blind
   - Maximum bet varies by betting round
   - No straddles allowed

### Five-card Stud
1. Game Flow
   - Ante required
   - One hole card and one up card initially
   - Betting round after each up card
   - Four betting rounds total
   - Best five-card hand wins

2. Betting Structure
   - Usually played fixed-limit
   - First two rounds smaller bet
   - Last two rounds larger bet
   - Maximum three raises per round

### Omaha Hi-Lo
1. Game Flow
   - Similar to Omaha
   - Four hole cards dealt to each player
   - Must use exactly two hole cards
   - Pot split between high and low hands
   - Eight-or-better qualifying for low hand

2. Low Hand Rules
   - Must be 8-high or better to qualify
   - Aces count as low
   - Straights and flushes don't count against low
   - Best low hand is A-2-3-4-5

### Razz
1. Game Flow
   - Seven-card stud played for low only
   - Ante and bring-in
   - Two hole cards and one up card
   - Lowest hand wins
   - Aces are low
   - No high hand

2. Hand Rankings
   - Best possible hand: A-2-3-4-5
   - Straights and flushes don't count
   - Pairs count against you
   - Five lowest unpaired cards used

### Seven Card Stud Hi-Lo
1. Game Flow
   - Similar to Seven-card Stud
   - Pot split between high and low hands
   - Eight-or-better qualifying for low hand
   - Can win both high and low (scoop)
   - Best five cards from seven for each hand

2. Low Hand Rules
   - Must be 8-high or better to qualify
   - Aces count as low
   - Straights and flushes don't count for low
   - Best low hand is A-2-3-4-5

## Game Room Management

### Room Types
1. Cash Games
   - Fixed blind levels
   - Players can join/leave at any time
   - Auto-top up options
   - Maximum/minimum buy-in limits
   - Run it Twice availability
     - Player preference settings
     - Table-wide settings option
     - Default run count setting
     - Opt-in/opt-out persistence
     - Quick decision timer options

2. Tournaments
   - Progressive blind levels
   - Fixed starting stack
   - Elimination format
   - Prize structure
   - Late registration period
   - Re-entry options

### Table Management
1. Seat Management
   - Maximum 9 players per table
   - Wait list system
   - Reserved seating
   - Auto-seat feature
   - Seat change requests

2. Game Flow Control
   - Hand dealing mechanics
   - Dealer button progression
   - Blind level timing
   - Break timing (tournaments)
   - Table balancing (tournaments)

3. Run it Twice UI/UX Requirements
   a. Multiple Board Display
      - Vertical stack layout
      - Swipeable board navigation
      - Board completion indicators
      - Winner highlight per board
      - Combined result summary

   b. Player Interface Elements
      - Quick decision buttons
      - Run count selector
      - Player preference controls
      - Timer display
      - Result history access

   c. Animation System
      - Sequential board dealing
      - Smooth transitions
      - Winner reveal sequence
      - Pot split visualization
      - Mobile optimization

   d. Mobile Considerations
      - Compact view mode
      - Touch-friendly controls
      - Gesture navigation
      - Portrait/landscape adaptation
      - Network state indicators

## Player Actions

### Basic Actions
1. Fold
   - Immediate effect
   - Cards hidden from view
   - Player sits out until next hand

2. Check
   - Available when no betting action
   - Passes action to next player
   - Visual indication of check action

3. Call
   - Matches current bet amount
   - Partial calls for all-in situations
   - Visual chip movement animation

4. Raise
   - Minimum raise amount validation
   - Maximum raise amount validation
   - All-in considerations
   - Re-raise requirements

### Advanced Actions
1. Time Bank
   - Initial time bank amount
   - Time bank replenishment rules
   - Visual countdown
   - Auto-action on expiration

2. Run it Twice Timing Rules
   a. Decision Phase
      - Initial decision window: 15 seconds
      - Extension with time bank allowed
      - Synchronized player decisions
      - Auto-decline on timeout
      - Decision change grace period: 3 seconds

   b. Action Timing
      - Sequential board dealing
      - Result revelation timing
      - Animation duration controls
      - Skip option availability
      - Tournament timing adjustments

   c. Player Preferences
      - Pre-set decision defaults
      - Auto-accept thresholds
      - Animation speed settings
      - Result display duration
      - Sound notification options

3. Auto Actions
   - Auto-muck losing hands
   - Auto-fold to any bet
   - Check/fold option
   - Call any option
   - Auto-post blinds

3. Chat Actions
   - Quick chat options
   - Emoji reactions
   - Private messaging
   - Mute options

## Integrity Systems

### Fair Play
1. Random Number Generation
   - Cryptographically secure RNG
   - Verifiable card distribution
   - Audit trail of all deals
   - Multiple board integrity
     - Independent RNG seeds per run
     - Parallel deck management
     - Cross-run verification
     - Seed publication system
     - Audit trail per board

2. Anti-Collusion
   - IP tracking
   - Playing pattern analysis
   - Multi-accounting detection
   - Suspicious behavior flagging

### Game State Management
1. Disconnection Handling
   - Grace period for reconnection
   - Auto-action on disconnect
   - Hand history preservation
   - Stack preservation
   - Position maintenance

2. All-in Situations
   - Run it Twice handling
     - Player opt-in system
     - Multiple deck management
     - Parallel board dealing
     - Split pot calculations
     - Result display for all runs
   - Regular all-in handling
     - Single board completion
     - Standard pot awards
     - Side pot management

3. Run it Twice Implementation Details
   a. Multiple Run Management
      - Separate deck initialization for each run
      - Independent RNG seeds per board
      - Parallel hand evaluation
      - Synchronous result calculation
      - Atomic transaction handling

   b. Pot Distribution Logic
      - Equal division between runs
      - Proportional distribution for side pots
      - Handling of odd chip amounts
      - Tracking partial pot ownership
      - Settlement order (high to low)

   b.1 Pot Distribution Examples
      Example 1: Simple Two-Way All-in
      - Main pot: $1000
      - Run 1: Player A wins ($500)
      - Run 2: Player B wins ($500)
      - Result: Equal split

      Example 2: Three-Way All-in with Side Pots
      - Main pot: $300 (all players)
      - Side pot 1: $400 (two players)
      - Run 1: Player A wins main, Player B wins side
      - Run 2: Player C wins main, Player B wins side
      - Result: 
        - Player A: $150 (half main pot run 1)
        - Player B: $400 (all side pot)
        - Player C: $150 (half main pot run 2)

      Example 3: Multiple Runs with Odd Chips
      - Total pot: $1001
        Run 1 ($501): Player A
        Run 2 ($500): Player B
      - Odd chip assigned to first run

      Example 4: Split Pot on One Run
      - Run 1: Split between A and B ($500 each)
      - Run 2: Player A wins ($1000)
      - Final result: Player A $1500, Player B $500

   c. Tournament Exclusion Rationale
      - Tournament integrity preservation
      - Consistent variance maintenance
      - Elimination clarity
      - Tournament pace considerations
      - Broadcasting requirements

   d. State Management
      - Multiple board state tracking
      - Player preference persistence
      - Run history recording
      - Result verification system
      - Dispute resolution handling

4. Error Recovery
   - Hand cancelation criteria
   - Refund procedures
   - State rollback capabilities
   - Player compensation system
