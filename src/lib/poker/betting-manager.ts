import { Player } from '../../types/poker';
import { PlayerAction } from '../../types/poker-engine';

export class BettingManager {
  constructor(
    private readonly smallBlind: number,
    private readonly bigBlind: number
  ) {}

  /**
   * Places a total bet (not incremental) for the player, deducting only the delta
   * between the new total and the player's previous bet.
   * Returns the delta contribution added by this action.
   */
  public placeBet(player: Player, totalBet: number): number {
    const previousBet = player.currentBet;
    const maxTotalBet = previousBet + player.stack; // all-in cap (total perspective)
    const newTotalBet = Math.min(totalBet, maxTotalBet);
    const delta = Math.max(0, newTotalBet - previousBet);

    // Deduct only the delta from stack
    player.stack -= delta;
    player.currentBet = newTotalBet;

    if (player.stack === 0) {
      player.isAllIn = true;
    }

    return delta;
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
    const previousBet = player.currentBet;

    switch (action.type) {
      case 'bet': {
        if (currentBet > 0) {
          throw new Error('Cannot bet when there is an active bet; use raise');
        }
        if (!action.amount || action.amount <= 0) {
          throw new Error('Bet amount must be specified');
        }

        const maxTotal = previousBet + player.stack;
        const desiredTotal = action.amount;
        const newTotal = Math.min(desiredTotal, maxTotal);

        // Enforce minimum bet equal to big blind, unless player is all-in short
        if (newTotal < this.bigBlind && newTotal < maxTotal) {
          throw new Error('Bet amount must be at least the big blind');
        }

        potIncrease = this.placeBet(player, newTotal);
        currentBet = player.currentBet;
        // If short all-in (< BB), do not lower the minRaise below BB
        if (player.currentBet < this.bigBlind && player.isAllIn) {
          minRaise = this.bigBlind;
        } else {
          // First bet sets the min raise size
          minRaise = player.currentBet;
        }
        player.hasActed = true;
        break;
      }
      case 'fold':
        player.isFolded = true;
        player.hasActed = true;
        break;

      case 'call':
        const neededAmount = currentBet - player.currentBet;
        if (neededAmount > 0) {
          // Only deduct the difference needed to call
          const actualBet = Math.min(neededAmount, player.stack);
          player.stack -= actualBet;
          player.currentBet += actualBet; // Add to existing bet
          potIncrease = actualBet; // Only add the new amount
          
          if (player.stack === 0) {
            player.isAllIn = true;
          }
        }
        player.hasActed = true;
        break;

      case 'raise':
        if (!action.amount || action.amount <= currentBet) {
          throw new Error('Raise amount must be greater than current bet');
        }
        {
          const desiredTotal = action.amount;
          const maxTotal = previousBet + player.stack;
          const effectiveTotal = Math.min(desiredTotal, maxTotal);
          const raiseAmount = effectiveTotal - currentBet;

          // Validate minimum raise; allow short all-in raises that don't meet minRaise
          const isAllInShort = effectiveTotal === maxTotal && raiseAmount < minRaise;
          if (raiseAmount < minRaise && !isAllInShort) {
            throw new Error('Invalid raise amount');
          }

          potIncrease = this.placeBet(player, effectiveTotal); // adds only delta
          currentBet = player.currentBet;
          // Only update minRaise when a full raise (>= previous minRaise) occurs
          if (raiseAmount >= minRaise) {
            minRaise = raiseAmount;
          }
          player.hasActed = true;
          break;
        }

      case 'check':
        if (currentBet > player.currentBet) {
          throw new Error('Cannot check when there is a bet');
        }
        player.hasActed = true;
        break;
    }

    return { pot: potIncrease, currentBet, minRaise };
  }

  /**
   * Compute current betting limits for a player in no-limit.
   * minBet equals big blind when there is no active bet (unless short all-in),
   * minRaise is carried from state, and maxBet is player.currentBet + stack.
   */
  public getBettingLimits(player: Player, currentBet: number, minRaise: number) {
    const maxBet = player.currentBet + player.stack;
    const hasBet = currentBet > 0;
    const minBet = hasBet ? currentBet + minRaise : Math.min(this.bigBlind, maxBet);
    return {
      minBet,
      minRaise,
      maxBet,
      currentBet
    };
  }
}
