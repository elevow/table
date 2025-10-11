import { Player } from '../../types/poker';
import { PlayerAction } from '../../types/poker-engine';
import { PotLimitCalculator } from './pot-limit';

export class BettingManager {
  private mode: 'no-limit' | 'pot-limit' = 'no-limit';
  constructor(
    private readonly smallBlind: number,
    private readonly bigBlind: number
  ) {}

  public setMode(mode: 'no-limit' | 'pot-limit') {
    this.mode = mode;
  }

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

  public postBlinds(players: Player[], dealerPosition?: number): { pot: number; currentBet: number } {
    // Prefer dealer-relative blind assignment if dealerPosition is provided
    let smallBlindPlayer: Player | undefined;
    let bigBlindPlayer: Player | undefined;

    if (typeof dealerPosition === 'number' && players.length === 2) {
      // Heads-up: dealer posts small blind; other posts big blind
      const n = players.length;
      smallBlindPlayer = players[dealerPosition];
      bigBlindPlayer = players[(dealerPosition + 1) % n];
    } else if (
      typeof dealerPosition === 'number' && players.length >= 3 && process.env.ENABLE_DEALER_RELATIVE_BLINDS_RING === 'true'
    ) {
      // Ring games (opt-in): assign blinds relative to dealer
      const n = players.length;
      const sbIndex = (dealerPosition + 1) % n;
      const bbIndex = (dealerPosition + 2) % n;
      smallBlindPlayer = players[sbIndex];
      bigBlindPlayer = players[bbIndex];
    } else {
      // Backward-compatible fallback by fixed positions (legacy tests/flows)
      smallBlindPlayer = players.find(p => p.position === 1);
      bigBlindPlayer = players.find(p => p.position === 2);
    }

    if (!smallBlindPlayer) throw new Error('Could not find small blind player');
    if (!bigBlindPlayer) throw new Error('Could not find big blind player');

    if (process.env.DEBUG_POKER === 'true') {
      const mode = players.length === 2 ? 'HU' : 'RING';
      // eslint-disable-next-line no-console
      console.log(`[DEBUG] Blinds (${mode}) dealerIdx=${typeof dealerPosition==='number'?dealerPosition:'n/a'} | SB=${smallBlindPlayer.id} (pos=${smallBlindPlayer.position}) BB=${bigBlindPlayer.id} (pos=${bigBlindPlayer.position})`);
    }

    const sbAmount = this.placeBet(smallBlindPlayer, this.smallBlind);
    const bbAmount = this.placeBet(bigBlindPlayer, this.bigBlind);

    if (process.env.DEBUG_POKER === 'true') {
      // eslint-disable-next-line no-console
      console.log(`[DEBUG] Posted blinds: SB ${smallBlindPlayer.id}=${sbAmount} BB ${bigBlindPlayer.id}=${bbAmount} -> potDelta=${sbAmount+bbAmount}`);
    }

    return {
      pot: sbAmount + bbAmount,
      currentBet: this.bigBlind
    };
  }

  public processAction(
    player: Player,
    action: PlayerAction,
    currentBet: number,
    minRaise: number,
    ctx?: { currentPot: number; players: Player[] }
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
        let desiredTotal = action.amount;
        if (this.mode === 'pot-limit') {
          const plc = PotLimitCalculator.calculateMaxBet(
            ctx?.currentPot ?? 0,
            0,
            (ctx?.players || []).map(p => ({ currentBet: p.currentBet, isFolded: p.isFolded, isAllIn: p.isAllIn })),
            previousBet
          );
          desiredTotal = Math.min(desiredTotal, plc.maxBet);
        }
        const newTotal = Math.min(desiredTotal, maxTotal);

        // Enforce minimum bet equal to big blind, unless player is all-in short
        if (this.mode === 'no-limit') {
          if (newTotal < this.bigBlind && newTotal < maxTotal) {
            throw new Error('Bet amount must be at least the big blind');
          }
        }

        potIncrease = this.placeBet(player, newTotal);
        currentBet = player.currentBet;
        // First bet sets the min raise size (stick to BB minimum in NL; PL follows amount)
        minRaise = this.mode === 'no-limit' ? Math.max(this.bigBlind, player.currentBet) : player.currentBet;
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
          let effectiveTotal = Math.min(desiredTotal, maxTotal);
          if (this.mode === 'pot-limit') {
            const plc = PotLimitCalculator.calculateMaxBet(
              ctx?.currentPot ?? 0,
              currentBet,
              (ctx?.players || []).map(p => ({ currentBet: p.currentBet, isFolded: p.isFolded, isAllIn: p.isAllIn })),
              previousBet
            );
            effectiveTotal = Math.min(effectiveTotal, plc.maxBet);
          }
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
    let minBet = hasBet ? currentBet + minRaise : Math.min(this.bigBlind, maxBet);
    if (this.mode === 'pot-limit') {
      // For pot-limit, minBet when no bet is the big blind; when there is a bet, min total is call + minRaise
      // Max total is computed as tableCurrentBet + (pot + pending calls). Engine should pass real pot if needed.
      // Without pot here, we expose stack-capped value; UI can query engine for precise.
      minBet = hasBet ? currentBet + minRaise : Math.min(this.bigBlind, maxBet);
    }
    return {
      minBet,
      minRaise,
      maxBet,
      currentBet
    };
  }

  /**
   * For pot-limit tables, announce pot size (UI helper).
   */
  public announcePot(currentPot: number): string {
    return `Pot is ${currentPot}`;
  }
}
