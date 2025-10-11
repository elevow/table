import { TableState, GameStage, Player } from '../../types/poker';

export class GameStateManager {
  constructor(
    private readonly state: TableState,
  ) {}

  public startBettingRound(stage: GameStage): void {
    this.state.stage = stage;
    
    // Reset betting state for new rounds (except preflop which has blinds)
    if (stage !== 'preflop' && stage !== 'third') {
      this.state.currentBet = 0;
      this.state.players.forEach(player => {
        player.currentBet = 0;
        player.hasActed = false;
      });
    }
    
    // Determine who acts first
    // Default legacy mapping (fallback): preflop -> position 1; postflop -> position 2
    let activePlayer: Player | undefined;
    if (this.state.variant === 'seven-card-stud' || this.state.variant === 'seven-card-stud-hi-lo') {
      // US-053: Simplified bring-in/door card rules not fully implemented; start with position 1
      activePlayer = this.state.players.find(p => p.position === 1);
    } else if (typeof this.state.dealerPosition === 'number' && this.state.players.length >= 2) {
      const n = this.state.players.length;
      const isHeadsUp = n === 2;
      if (isHeadsUp) {
        // HU rules: dealer posts SB and acts first preflop; postflop non-dealer (BB) acts first
        if (stage === 'preflop') {
          activePlayer = this.state.players[this.state.dealerPosition];
        } else {
          activePlayer = this.state.players[(this.state.dealerPosition + 1) % n];
        }
      } else {
        // 3+ players: preflop first to act is left of the big blind; postflop is left of dealer (SB)
        if (stage === 'preflop') {
          const bbIndex = (this.state.dealerPosition + 2) % n; // BB relative to dealer
          const firstIndex = (bbIndex + 1) % n; // left of BB
          activePlayer = this.state.players[firstIndex];
        } else {
          const firstIndex = (this.state.dealerPosition + 1) % n; // left of dealer (SB)
          activePlayer = this.state.players[firstIndex];
        }
      }
    } else {
      // Legacy fallback when dealerPosition not provided
      const legacyStartPos = stage === 'preflop' ? 1 : 2;
      activePlayer = this.state.players.find(p => p.position === legacyStartPos);
    }

    if (!activePlayer) throw new Error('Could not find active player');
    if (process.env.DEBUG_POKER === 'true') {
      const n = this.state.players.length;
      const mode = n === 2 ? 'HU' : 'RING';
      // eslint-disable-next-line no-console
      console.log(`[DEBUG] Start ${stage}: dealerIdx=${this.state.dealerPosition} players=${n} (${mode}) firstToAct=${activePlayer.id} (pos=${(activePlayer as any).position})`);
    }
    this.state.activePlayer = activePlayer.id;
  }

  public moveToNextStage(): GameStage {
  const stages: GameStage[] = (this.state.variant === 'seven-card-stud' || this.state.variant === 'seven-card-stud-hi-lo')
      ? ['third', 'fourth', 'fifth', 'sixth', 'seventh', 'showdown']
      : ['preflop', 'flop', 'turn', 'river', 'showdown'];
    const currentIndex = stages.indexOf(this.state.stage);
    
    if (currentIndex >= stages.length - 1) {
      throw new Error('No next stage available');
    }

    const nextStage = stages[currentIndex + 1];
    this.state.stage = nextStage;
    return nextStage;
  }

  public resetPlayerStates(): void {
    this.state.players.forEach(player => {
      player.holeCards = undefined;
      player.currentBet = 0;
      player.hasActed = false;
      player.isFolded = false;
      player.isAllIn = false;
    });
    this.state.pot = 0;
    this.state.currentBet = 0;
    this.state.communityCards = [];
  if (this.state.variant === 'seven-card-stud' || this.state.variant === 'seven-card-stud-hi-lo') {
      this.state.studState = { playerCards: {} };
    } else {
      this.state.studState = undefined;
    }
  }

  public rotateDealerButton(): number {
    this.state.dealerPosition = (this.state.dealerPosition + 1) % this.state.players.length;
    if (process.env.DEBUG_POKER === 'true') {
      // eslint-disable-next-line no-console
      console.log(`[DEBUG] Dealer rotated -> new dealerIdx=${this.state.dealerPosition} (playerId=${this.state.players[this.state.dealerPosition]?.id})`);
    }
    return this.state.dealerPosition;
  }

  public findNextActivePlayer(startPosition: number): Player | undefined {
    let pos = startPosition;
    const numPlayers = this.state.players.length;
    
    do {
      // Convert to 0-based for modulo, then back to 1-based for position lookup
      pos = ((pos - 1 + 1) % numPlayers) + 1;
      const player = this.state.players.find(p => p.position === pos);
      
      if (player && !player.isFolded && !player.isAllIn && 
          (!player.hasActed || player.currentBet < this.state.currentBet)) {
        return player;
      }
    } while (pos !== startPosition);

    return undefined;
  }
}
