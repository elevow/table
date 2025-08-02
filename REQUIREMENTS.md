# Project Requirements Document

> **Detailed Documentation**
> - [Game Mechanics](./docs/GAME_MECHANICS.md)
> - [Technical Architecture](./docs/TECHNICAL_ARCHITECTURE.md)
> - [Security & Authentication](./docs/SECURITY_AUTH.md)
> - [UI/UX Guidelines](./docs/UI_UX_GUIDELINES.md)
> - [Testing Strategy](./docs/TESTING_STRATEGY.md)
> - [API Documentation](./docs/API_DOCUMENTATION.md)
> - [Database Schema](./docs/DATABASE_SCHEMA.md)
> - [DevOps Procedures](./docs/DEVOPS_PROCEDURES.md)

## Overview
"Table" is a multiplayer online poker platform that allows users to play various poker variants with their friends. The platform will support real-time gameplay, multiple poker variations, and a friendly, social gaming experience without real-money gambling.

## Functional Requirements
### Core Features
1. User Authentication and Profile Management
   - User registration and login
   - Profile customization
     - Custom avatar upload and management
     - Avatar moderation system
     - Multiple size variants (32x32, 64x64, 128x128)
     - Default avatar fallbacks
   - Friend list management
   - Game history tracking

2. Poker Game Variations
   - Texas Hold'em
   - Omaha
   - Seven-card Stud
   - Ability to add more variants in the future

3. Game Room Management
   - Create private/public game rooms
   - Customize game settings (blind levels, time limits, etc.)
   - Invite friends to games
   - Spectator mode

4. Real-time Gameplay Features
   - Turn-based gameplay system
   - Betting mechanics
   - Card dealing and distribution
   - Timer system for player actions
   - Chat functionality

### User Interface Requirements
1. Game Table Interface
   - Clear visualization of cards, chips, and pot
   - Player positions and statuses
   - Betting controls and amounts
   - Timer displays
   - Chat window

2. Lobby Interface
   - Available games list
   - Room creation interface
   - Friend list and online status
   - Game filtering and search

## Game Mechanics Requirements
### Poker Rules Implementation
1. Texas Hold'em
   - Pre-flop betting round
   - Flop, Turn, and River phases
   - Hand evaluation and showdown
   - Small/Big blind system
   - Position-based play order

2. Game Flow Management
   - Dealer button rotation
   - Blind progression system
   - Time bank system
   - Auto-muck losing hands option
   - Hand history recording
   - Special Features
     - Run it Twice
       - All-in situation detection
       - Multiple board dealing
       - Split pot calculations
       - Player preference settings
       - Multiple winner resolution
     - Rabbit Hunting
       - Post-hand card reveal
       - Remaining deck preservation
       - Street selection options
       - Cooldown management
       - Historical tracking

3. Betting System
   - Minimum/maximum bet limits
   - Pot limit/No limit variations
   - All-in rules and side pots
   - Raise and re-raise limits
   - Auto-posting blinds option

4. Player Actions
   - Fold, Call, Raise actions
   - Check when available
   - All-in declarations
   - Auto-fold on timeout option
   - Action preselection

## Technical Requirements
### System Architecture
- Next.js full-stack application architecture
- Supabase for database, auth, and real-time subscriptions
- Socket.io for complex game state synchronization
- API routes for game logic
- Server-side rendering for optimal performance
- Supabase row-level security for data protection
- React Query for client-state management
- Modular component architecture for game features

### Database Schema
1. User Management
   - Users table (profile, settings, statistics)
   - Avatar management system
     - Avatar storage and variants
     - Moderation queue
     - Processing jobs tracking
     - Version history
   - Friend relationships
   - User achievements and rankings
   - Session tracking

2. Game Management
   - Active games table
   - Game history
   - Hand history
     - Standard hand recording
     - Run it Twice outcomes
     - Rabbit Hunt revelations
     - Multiple board results
   - Player actions log
   - Chat history
   - Feature usage tracking
     - Run it Twice statistics
     - Rabbit Hunt usage metrics
     - Player preferences

3. Tournament/Room Management
   - Room configurations
   - Tournament structures
   - Blind level configurations
   - Player registrations

4. Statistics and Analytics
   - Player statistics
   - Game statistics
   - Performance metrics
   - System analytics

### Performance Requirements
- Maximum latency of 100ms for game actions
- Support for minimum 1000 concurrent game rooms
- Support for minimum 5000 concurrent users
- 99.9% uptime leveraging Vercel's SLA
- Automatic game state recovery in case of disconnection
- Global CDN distribution for static assets
  - Avatar delivery optimization
  - Thumbnail caching strategies
  - Regional edge caching
  - Automatic image optimization
  - Cache invalidation on updates
- Automatic scaling based on user demand
- Image processing performance
  - Parallel processing for multiple sizes
  - Background job queuing
  - Efficient format conversion
  - Progressive loading support
- Special Feature Performance
  - Run it Twice
    - Multiple board state handling
    - Parallel pot calculations
    - Simultaneous outcome processing
    - Real-time UI updates
  - Rabbit Hunting
    - Deck state preservation
    - Efficient card retrieval
    - Memory optimization
    - Cleanup procedures

## Security Requirements
### Authentication and Authorization
- Supabase authentication with multiple provider support
  - Email/password authentication
  - Social login options (Google, GitHub, etc.)
  - Password recovery system
  - Email verification process
  - Session management and refresh tokens

### Data Security
- Row-level security policies for database access
  - User data isolation
  - Game room access control
  - Friend list privacy
  - Game history protection
  - Avatar access control and moderation
- File upload security
  - Image file validation
  - Size restrictions (max 5MB)
  - Format validation (JPEG, PNG, WebP)
  - Metadata stripping
  - Malware scanning
  - NSFW content detection
- Rate limiting for uploads
  - Hourly limits (5 uploads, 20MB total)
  - Daily limits (20 uploads, 50MB total)
- Encrypted WebSocket connections
- Secure data storage and transmission

### Game Integrity
- Protection against cheating and game manipulation
  - Server-side card dealing and verification
  - Action validation and sequence control
  - Multi-device detection and prevention
  - Collusion detection systems
  - Suspicious behavior monitoring
- Special Feature Integrity
  - Run it Twice
    - Random seed preservation
    - Multiple board integrity
    - Result verification
    - State consistency checks
  - Rabbit Hunting
    - Deck state verification
    - Access control timing
    - Reveal limit enforcement
    - Historical accuracy validation

### System Security
- Rate limiting to prevent abuse
  - API request limits
  - WebSocket connection limits
  - Authentication attempt limits
- Regular security audits and penetration testing
- Automated vulnerability scanning
- Incident response plan

## Compatibility Requirements
- Cross-platform web application (Chrome, Firefox, Safari, Edge)
- Mobile-responsive design for tablet and phone play
- Minimum supported resolution: 1280x720
- Support for both touch and mouse/keyboard input

## Project Timeline
- Phase 1: Core infrastructure and basic Texas Hold'em implementation
  - User authentication system
  - Basic game room creation
  - Single poker variant (Texas Hold'em)
  - Basic UI implementation

- Phase 2: Enhanced Features and Additional Games
  - Additional poker variants
  - Advanced room customization
  - Friend system implementation
  - Chat functionality

- Phase 3: Polish and Testing
  - UI/UX improvements
  - Performance optimization
  - Security testing
  - Beta testing with real users

## Dependencies
- Next.js for frontend and API routes
- Supabase for database, auth, and real-time features
- Socket.io for complex real-time game actions
- React Query for client-state management
- Custom card game logic implementation
  - Core poker engine
  - Run it Twice logic module
  - Rabbit Hunt controller
  - Multiple board evaluator
- Tailwind CSS for UI components
  - Animation system
  - Transition effects
  - Responsive layouts
- Jest and React Testing Library for testing
- Vercel for production deployment
- Vercel Edge Functions for low-latency operations
- Vercel CDN for static asset delivery
- Redis for feature state management
  - Deck state preservation
  - Multiple board tracking
  - Feature cooldown management

## Constraints
- No real-money gambling functionality
- Must comply with local gaming regulations
- Must maintain low latency for real-time gameplay
- Limited initial server resources
- Cross-browser compatibility requirements

## Success Criteria
- Successfully host 10 concurrent game rooms without performance issues
- Achieve less than 100ms latency for 95% of game actions
- Maintain 99.9% uptime during peak hours
- Zero critical security incidents in first 6 months
- Special Feature Success Metrics
  - Run it Twice
    - Process multiple boards within 200ms
    - 100% accuracy in pot splitting
    - Support up to 4 simultaneous boards
    - Zero state inconsistencies
  - Rabbit Hunting
    - Card reveal response < 50ms
    - Support 100 concurrent reveals
    - 100% deck state accuracy
    - Efficient memory cleanup

---
Last Updated: August 1, 2025
