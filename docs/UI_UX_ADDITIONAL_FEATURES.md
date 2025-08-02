# UI/UX Additional Features Specification

## Run it Twice Interface

### All-in Situation Dialog
1. Main Dialog Design
   - Semi-transparent overlay background
   - Modal centered on screen
   - Prominent title "Run Multiple Times?"
   - Visual countdown timer (circular progress)
   - Player avatars with response status

2. Action Controls
   - Primary options:
     ```
     [ Run Once ] [ Run Twice ] [ Run 3x ] [ Run 4x ]
     ```
   - Quick action buttons with hover states
   - Selected state visual feedback
   - Disabled state for invalid options
   - Keyboard shortcuts (1-4)

3. Player Preferences
   - "Remember my choice" checkbox
   - Default run count selector
   - Auto-response threshold setting
   - Notification preferences
   - Sound effect toggles

### Multiple Board Display
1. Layout Structure
   ```
   [Board 1] - Current pot share: $500
   [Community Cards]
   [Winner Info]
   
   [Board 2] - Current pot share: $500
   [Community Cards]
   [Winner Info]
   ```

2. Visual Elements
   - Clear board separation lines
   - Unique background tint per board
   - Winner highlight animations
   - Pot distribution visualization
   - Hand strength indicators

3. Mobile Adaptation
   - Vertical stack layout
   - Swipeable board navigation
   - Dot indicators for multiple boards
   - Compact information display
   - Touch-friendly controls

### Animation Sequence
1. Board Dealing
   ```
   Timeline:
   0.0s: Start dealing animation
   0.2s: Burn card animation
   0.4s: First community card
   0.6s: Second community card
   0.8s: Third community card
   ```

2. Result Revelation
   ```
   Timeline:
   0.0s: Highlight winning hand
   0.3s: Show hand strength
   0.6s: Display pot share
   0.9s: Chip movement animation
   1.2s: Winner celebration
   ```

## Rabbit Hunting Interface

### Activation Control
1. Button Design
   - Location: Bottom right of game table
   - Icon: Rabbit icon + cards
   - States:
     - Available: Full opacity
     - Cooldown: Grayscale with timer
     - Disabled: 50% opacity
   ```
   [ 🐰 Hunt Cards ] (Available)
   [ 🐰 2:30 ]      (Cooldown)
   [ 🐰 ― ]        (Disabled)
   ```

2. Cooldown Display
   - Circular progress indicator
   - Remaining time counter
   - Color coding:
     - Green: Available
     - Yellow: < 30s cooldown
     - Red: > 30s cooldown

### Card Revelation Interface
1. Layout Design
   ```
   [Last Known Board State]
   
   Select streets to reveal:
   [ ] Turn
   [ ] River
   
   [Reveal Selected] [Close]
   ```

2. Animation Sequence
   ```
   Timeline:
   0.0s: Highlight deck
   0.2s: Burn card animation
   0.4s: Card flip animation
   0.6s: Card placement
   0.8s: Card settle effect
   ```

3. Multiple Scenario Support
   - Tabs for different scenarios
   - Quick navigation between options
   - Clear visual separation
   - Scenario comparison view
   - History tracking

### Historical View
1. Navigation
   - Recent hands list
   - Calendar view option
   - Filter by interesting hands
   - Search functionality
   - Quick access shortcuts
   - Statistical period selector (Day/Week/Month/Custom)

2. Data Display
   ```
   Hand #12345 - Texas Hold'em
   [Actual Outcome]
   [Rabbit Hunt Results]
   Players Involved: [Avatars]
   Pot Size: $1,000
   ```

3. Player Statistics Panel
   ```
   Player Overview:
   ├── Basic Stats
   │   ├── Hands Played: 150
   │   ├── VPIP (Voluntary Put in Pot): 24.5%
   │   ├── PFR (Pre-Flop Raise): 18.2%
   │   └── AF (Aggression Factor): 2.3
   │
   ├── Street Stats
   │   ├── Flop
   │   │   ├── Seen: 32%
   │   │   ├── Won when seen: 45%
   │   │   └── C-bet: 65%
   │   ├── Turn
   │   │   ├── Seen: 24%
   │   │   ├── Won when seen: 52%
   │   │   └── Bet when checked to: 48%
   │   └── River
   │       ├── Seen: 18%
   │       ├── Won when seen: 58%
   │       └── Bet when checked to: 42%
   │
   ├── Position Stats
   │   ├── Early: 22% VPIP, 15% PFR
   │   ├── Middle: 25% VPIP, 18% PFR
   │   └── Late: 32% VPIP, 24% PFR
   │
   ├── Money Stats
   │   ├── Total Winnings: $2,450
   │   ├── BB/100: 5.2
   │   ├── Showdown Win %: 54%
   │   └── Non-Showdown Win %: 46%
   │
   └── Advanced Metrics
       ├── 3-Bet %: 6.8%
       ├── Fold to 3-Bet: 62%
       ├── Steal Attempt %: 38%
       └── Fold to Steal: 42%
   ```

4. Visual Analytics
   - Heat map of position vs. action
   - Win/loss trend graph
   - Stack size vs. aggression correlation
   - Street-by-street action breakdown
   - Bankroll progression chart

5. Session Summaries
   ```
   Latest Session:
   Duration: 2h 45m
   Hands: 85
   Win/Loss: +$320
   Notable Hands: 3
   Biggest Pot: $750
   ```

### Mobile Considerations
1. Touch Interactions
   - Swipe between boards/scenarios
   - Long press for additional options
   - Pinch to zoom cards
   - Double tap to maximize
   - Edge swipe for navigation

2. Layout Adaptations
   ```
   Portrait Mode:
   [Board]
   [Controls]
   [History]
   
   Landscape Mode:
   [Board] | [Controls]
          [History]
   ```

3. Performance Optimizations
   - Reduced animation complexity
   - Progressive image loading
   - Lazy load historical data
   - Compressed card assets
   - Minimal render updates

## Common Elements

### Accessibility Features
1. Visual Assistance
   - High contrast mode
   - Colorblind support
   - Scalable text
   - Screen reader compatibility
   - Focus indicators

2. Input Methods
   - Keyboard navigation
   - Voice commands
   - Screen reader support
   - Alternative input devices
   - Touch alternatives

### Responsive Behavior
1. Breakpoints
   ```
   Desktop: > 1280px
   Tablet: 768px - 1279px
   Mobile: < 767px
   ```

2. Layout Adjustments
   - Stack vs. grid layouts
   - Collapsible sections
   - Priority content ordering
   - Touch target sizing
   - Font scaling

### Error States
1. Visual Feedback
   - Error messages
   - Warning indicators
   - Success confirmations
   - Loading states
   - Recovery options

2. Recovery Actions
   - Retry options
   - Alternative paths
   - Help resources
   - Support contact
   - Auto-recovery attempts
