import { PlayerAction, TableState, Player } from '../types/poker';

export class ActionValidator {
  public static validateAction(
    action: PlayerAction,
    state: TableState,
    player: Player
  ): { valid: boolean; error?: string } {
    // Validate player's turn
    if (action.playerId !== state.activePlayer) {
      return { valid: false, error: 'Not player\'s turn' };
    }

    // Validate player not folded or all-in
    if (player.isFolded) {
      return { valid: false, error: 'Player has folded' };
    }

    if (player.isAllIn) {
      return { valid: false, error: 'Player is all-in' };
    }

    // Validate action type and amount
    switch (action.type) {
      case 'fold':
        return { valid: true };

      case 'call':
        if (state.currentBet <= player.currentBet) {
          return { valid: false, error: 'No bet to call' };
        }
        if (state.currentBet - player.currentBet > player.stack) {
          return { valid: false, error: 'Not enough chips to call' };
        }
        return { valid: true };

      case 'bet':
      case 'raise':
        if (!action.amount) {
          return { valid: false, error: 'Bet amount required' };
        }
        if (action.amount > player.stack) {
          return { valid: false, error: 'Bet amount exceeds stack' };
        }
        if (action.type === 'bet' && state.currentBet > 0) {
          return { valid: false, error: 'Cannot bet when there is already a bet' };
        }
        if (action.type === 'raise') {
          if (state.currentBet === 0) {
            return { valid: false, error: 'Cannot raise when there is no bet' };
          }
          const minRaise = state.currentBet + state.minRaise;
          if (action.amount < minRaise) {
            return { 
              valid: false, 
              error: `Raise must be at least ${minRaise} chips`
            };
          }
        }
        const minBet = state.bigBlind;
        if (action.amount < minBet) {
          return { 
            valid: false, 
            error: `Bet must be at least ${minBet} chips`
          };
        }
        return { valid: true };

      default:
        return { valid: false, error: 'Invalid action type' };
    }
  }

  public static calculateActionEffects(
    action: PlayerAction,
    state: TableState,
    player: Player
  ): { 
    potDelta: number;
    stackDelta: number;
    newCurrentBet: number;
    newMinRaise: number;
  } {
    let potDelta = 0;
    let stackDelta = 0;
    let newCurrentBet = state.currentBet;
    let newMinRaise = state.minRaise;

    switch (action.type) {
      case 'fold':
        break;

      case 'call':
        potDelta = state.currentBet - player.currentBet;
        stackDelta = -potDelta;
        break;

      case 'bet':
        if (action.amount) {
          potDelta = action.amount;
          stackDelta = -action.amount;
          newCurrentBet = action.amount;
          newMinRaise = action.amount;
        }
        break;

      case 'raise':
        if (action.amount) {
          potDelta = action.amount - player.currentBet;
          stackDelta = -potDelta;
          newCurrentBet = action.amount;
          newMinRaise = action.amount - state.currentBet;
        }
        break;
    }

    return {
      potDelta,
      stackDelta,
      newCurrentBet,
      newMinRaise
    };
  }
}
