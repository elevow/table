import { Player } from '../../types/poker';
import { PlayerAction } from '../../types/poker-engine';

export class BettingManager {
  constructor(
    private readonly smallBlind: number,
    private readonly bigBlind: number
  ) {}

  public placeBet(player: Player, amount: number): number {
    const actualBet = Math.min(amount, player.stack);
    player.stack -= actualBet;
    player.currentBet += actualBet;

    if (player.stack === 0) {
      player.isAllIn = true;
    }

    return actualBet;
  }

  public postBlinds(players: Player[]): { pot: number; currentBet: number } {
    // Find players by position
    const smallBlindPlayer = players.find(p => p.position === 1);
    if (!smallBlindPlayer) throw new Error('Could not find small blind player');
    const sbAmount = this.placeBet(smallBlindPlayer, this.smallBlind);

    // Post big blind
    const bigBlindPlayer = players.find(p => p.position === 2);
    if (!bigBlindPlayer) throw new Error('Could not find big blind player');
    const bbAmount = this.placeBet(bigBlindPlayer, this.bigBlind);

    return {
      pot: sbAmount + bbAmount,
      currentBet: this.bigBlind
    };
  }

  public processAction(
    player: Player, 
    action: PlayerAction, 
    currentBet: number,
    minRaise: number
  ): { pot: number; currentBet: number; minRaise: number } {
    let potIncrease = 0;

    switch (action.type) {
      case 'fold':
        player.isFolded = true;
        player.hasActed = true;
        break;

      case 'call':
        const callAmount = currentBet - player.currentBet;
        potIncrease = this.placeBet(player, callAmount);
        player.hasActed = true;
        break;

      case 'raise':
        if (!action.amount) {
          throw new Error('Raise amount is required');
        }
        const raiseAmount = action.amount - currentBet;
        if (raiseAmount < minRaise) {
          throw new Error('Invalid raise amount');
        }
        potIncrease = this.placeBet(player, action.amount);
        currentBet = player.currentBet;
        minRaise = raiseAmount;
        player.hasActed = true;
        break;

      case 'check':
        if (currentBet > player.currentBet) {
          throw new Error('Cannot check when there is a bet');
        }
        player.hasActed = true;
        break;
    }

    return { pot: potIncrease, currentBet, minRaise };
  }
}
