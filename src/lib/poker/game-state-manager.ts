import { TableState, GameStage, Player } from '../../types/poker';

export class GameStateManager {
  constructor(
    private readonly state: TableState,
  ) {}

  public startBettingRound(stage: GameStage): void {
    this.state.stage = stage;
    const startPosition = stage === 'preflop' ? 
      0 : // UTG starts after dealer in preflop
      1;  // SB starts in other rounds

    const activePlayer = this.state.players.find(p => p.position === startPosition);
    if (!activePlayer) throw new Error('Could not find active player');
    this.state.activePlayer = activePlayer.id;
  }

  public moveToNextStage(): GameStage {
    const stages: GameStage[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];
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
  }

  public rotateDealerButton(): number {
    this.state.dealerPosition = (this.state.dealerPosition + 1) % this.state.players.length;
    return this.state.dealerPosition;
  }

  public findNextActivePlayer(startPosition: number): Player | undefined {
    let pos = startPosition;
    const numPlayers = this.state.players.length;
    
    do {
      pos = (pos + 1) % numPlayers;
      const player = this.state.players.find(p => p.position === pos);
      
      if (player && !player.isFolded && !player.isAllIn && 
          (!player.hasActed || player.currentBet < this.state.currentBet)) {
        return player;
      }
    } while (pos !== startPosition);

    return undefined;
  }
}
