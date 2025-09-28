import { TableState, GameStage, Player } from '../../types/poker';

export class GameStateManager {
  constructor(
    private readonly state: TableState,
  ) {}

  public startBettingRound(stage: GameStage): void {
    this.state.stage = stage;
    // Determine start position by variant/stage (using 1-based positions)
    let startPosition = 1;
    if (this.state.variant === 'seven-card-stud' || this.state.variant === 'seven-card-stud-hi-lo') {
      // US-053: In Stud, third street starts with bring-in (lowest upcard); simplify to position 1 for now
      // Later streets normally start with highest upcards; for MVP tests we start at position 1
      startPosition = 1;
    } else {
      startPosition = stage === 'preflop' ? 1 : 2;
    }

    const activePlayer = this.state.players.find(p => p.position === startPosition);
    if (!activePlayer) throw new Error('Could not find active player');
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
