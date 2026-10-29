import { TableState, GameStage, Player } from '../../types/poker';
import { isSevenCardStudVariant, isStudVariant } from './variant-rules';
import { HandEvaluator } from './hand-evaluator';

/** Not dealt into hands: sitting out, or waiting for the big blind to reach them. */
export function sitsOutOfHand(p: Player): boolean {
  return !!p.isSittingOut || !!p.waitingForBigBlind;
}

export class GameStateManager {
  constructor(
    private readonly state: TableState,
  ) {}

  public startBettingRound(stage: GameStage): void {
    // If there are no players at all, this is an invalid state for starting a round
    if (!this.state.players || this.state.players.length === 0) {
      throw new Error('Could not find active player');
    }
    // Safety: if only one player remains, do not start another round; go to showdown immediately
    const activeCount = this.state.players.filter(p => !(p as any).folded && !p.isFolded).length;
    if (activeCount <= 1) {
      // eslint-disable-next-line no-console
      console.log(`[DEBUG] Prevented starting ${stage}: only one active remains; forcing showdown`);
      this.state.stage = 'showdown';
      this.state.activePlayer = '';
      return;
    }
    this.state.stage = stage;
    
    // Reset betting state for new rounds (except preflop which has blinds)
    if (stage !== 'preflop' && stage !== 'third') {
      this.state.currentBet = 0;
      this.state.players.forEach(player => {
        player.currentBet = 0;
        player.hasActed = false;
      });
      // Fixed limit: each street starts with no bets towards the cap
      if (this.state.bettingMode === 'fixed-limit') this.state.limitBets = 0;
    }
    
    // Determine who acts first
    // Default legacy mapping (fallback): preflop -> position 1; postflop -> position 2
    let activePlayer: Player | undefined;
    if (isStudVariant(this.state.variant)) {
      // Stud rules: on third street, the player after the bring-in (lowest upcard) acts first; on later streets, highest showing upcards acts first.
  const isActive = (p: Player) => !(p as any).folded && !p.isFolded && !p.isAllIn;
  const actives = this.state.players.filter(isActive);
  const weight: Record<any, number> = { '2': 2,'3': 3,'4': 4,'5': 5,'6': 6,'7': 7,'8': 8,'9': 9,'10': 10,'J': 11,'Q': 12,'K': 13,'A': 14 };
  const suitWeight: Record<string, number> = { clubs: 1, diamonds: 2, hearts: 3, spades: 4 };

      if (stage === 'third') {
        // Prefer computed bring-in
        const bringInId = this.state.studState?.bringIn?.player;
        const bringInPlayer = bringInId ? this.state.players.find(p => p.id === bringInId && !p.isFolded) : undefined;
        if (bringInPlayer && this.state.studState?.bringIn?.pending) {
          // The bring-in player opens by choosing to bring it in or complete
          activePlayer = bringInPlayer;
        } else if (bringInPlayer) {
          activePlayer = this.findNextActivePlayer(bringInPlayer.position) || (isActive(bringInPlayer) ? bringInPlayer : actives[0]);
          if (process.env.DEBUG_POKER === 'true') {
            const up = this.state.studState?.playerCards[activePlayer.id]?.upCards?.[0];
            // eslint-disable-next-line no-console
            console.log(`[DEBUG] Stud third street firstToAct=bring-in ${activePlayer.id} up=${up?.rank}${up?.suit?.[0]}`);
          }
        } else {
          // Compute from first upcard when bring-in not recorded
          let chosen: Player | undefined;
          let minVal = Infinity;
          for (const p of actives) {
            const up = this.state.studState?.playerCards[p.id]?.upCards?.[0];
            if (!up) continue;
            const v = weight[up.rank as any] ?? 99;
            if (v < minVal) { minVal = v; chosen = p; }
            else if (v === minVal && chosen) {
              const upChosen = this.state.studState?.playerCards[chosen.id]?.upCards?.[0];
              if (upChosen && suitWeight[up.suit] < suitWeight[upChosen.suit]) {
                chosen = p;
              }
            }
          }
          activePlayer = chosen || actives[0];
          if (process.env.DEBUG_POKER === 'true' && activePlayer) {
            const up = this.state.studState?.playerCards[activePlayer.id]?.upCards?.[0];
            // eslint-disable-next-line no-console
            console.log(`[DEBUG] Stud third street firstToAct=computed ${activePlayer.id} up=${up?.rank}${up?.suit?.[0]}`);
          }
        }
      } else if (this.state.variant === 'razz') {
        // Razz: the lowest showing hand acts first (aces low, pairs count against you); ties go
        // to the first such player in seat order
        let chosen: Player | undefined;
        for (const p of actives) {
          const ups = this.state.studState?.playerCards[p.id]?.upCards || [];
          if (!chosen) { chosen = p; continue; }
          const chosenUps = this.state.studState?.playerCards[chosen.id]?.upCards || [];
          if (HandEvaluator.compareRazzLow(HandEvaluator.razzLowKey(ups), HandEvaluator.razzLowKey(chosenUps)) < 0) chosen = p;
        }
        activePlayer = chosen || actives[0];
      } else {
        // Later streets: choose highest upcard among active players; tie-breaker by lowest position
        let chosen: Player | undefined;
        let maxVal = -1;
        for (const p of actives) {
          const ups = this.state.studState?.playerCards[p.id]?.upCards || [];
          const best = ups.reduce((m, c) => Math.max(m, weight[(c?.rank as any)] ?? -1), -1);
          if (best > maxVal) { maxVal = best; chosen = p; }
          else if (best === maxVal && chosen) {
            // Tie-break by suit of highest upcard; if still tied, fallback to seat position
            const bestUpP = ups.find(u => weight[(u?.rank as any)] === best);
            const upsChosen = this.state.studState?.playerCards[chosen.id]?.upCards || [];
            const bestUpChosen = upsChosen.find(u => weight[(u?.rank as any)] === best);
            if (bestUpP && bestUpChosen) {
              const swP = suitWeight[String(bestUpP.suit)];
              const swC = suitWeight[String(bestUpChosen.suit)];
              if (swP > swC) {
                chosen = p;
              } else if (swP === swC && typeof p.position === 'number' && p.position < (chosen.position as number)) {
                chosen = p;
              }
            }
          }
        }
        activePlayer = chosen || actives[0];
      }
      if (process.env.DEBUG_POKER === 'true') {
        // eslint-disable-next-line no-console
        console.log(`[DEBUG] Stud first-to-act (${stage}) -> ${activePlayer?.id}`);
      }
    } else if (typeof this.state.dealerPosition === 'number' && this.dealtInPlayers().length >= 2) {
      // Order is among players dealt into the hand; sitting-out players hold no seat in it
      const dealtIn = this.dealtInPlayers();
      const n = dealtIn.length;
      const dealerIdx = Math.max(0, dealtIn.indexOf(this.state.players[this.state.dealerPosition]));
      let firstIndex: number;
      if (n === 2) {
        // HU rules: dealer posts SB and acts first preflop; postflop non-dealer (BB) acts first
        firstIndex = stage === 'preflop' ? dealerIdx : (dealerIdx + 1) % n;
      } else {
        // 3+ players: preflop first to act is left of the big blind; postflop is left of dealer (SB)
        firstIndex = stage === 'preflop' ? (dealerIdx + 3) % n : (dealerIdx + 1) % n;
      }
      // That seat may have folded or be all-in (e.g. the small blind folded preflop); the action
      // starts with the next player who can still act
      const canAct = (p: Player) => !(p as any).folded && !p.isFolded && !p.isAllIn;
      activePlayer = dealtIn[firstIndex];
      for (let i = 0; i < n; i++) {
        const candidate = dealtIn[(firstIndex + i) % n];
        if (canAct(candidate)) { activePlayer = candidate; break; }
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
    // Safety: if only one player remains active, jump directly to showdown
    const activeCount = this.state.players.filter(p => !(p as any).folded && !p.isFolded).length;
    if (activeCount <= 1) {
      this.state.stage = 'showdown';
      return 'showdown';
    }
  const stages: GameStage[] = isSevenCardStudVariant(this.state.variant)
    ? ['third', 'fourth', 'fifth', 'sixth', 'seventh', 'showdown']
    : (this.state.variant === 'five-card-stud')
    ? ['third', 'fourth', 'fifth', 'sixth', 'showdown']
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
    // Clear Run-It-Twice state for new hand
    this.state.runItTwice = undefined;
    this.state.runItTwicePrompt = null;
    this.state.runItTwicePromptDisabled = false;
  if (isStudVariant(this.state.variant)) {
      this.state.studState = { playerCards: {} };
    } else {
      this.state.studState = undefined;
    }
  }

  /** Players taking part in the current hand: everyone not sitting out or waiting for the big blind. */
  public dealtInPlayers(): Player[] {
    return this.state.players.filter(p => !sitsOutOfHand(p));
  }

  public rotateDealerButton(): number {
    // The button moves to the next player who is sitting in
    const n = this.state.players.length;
    let next = (this.state.dealerPosition + 1) % n;
    for (let i = 0; i < n && this.state.players[next] && sitsOutOfHand(this.state.players[next]); i++) {
      next = (next + 1) % n;
    }
    this.state.dealerPosition = next;
    if (process.env.DEBUG_POKER === 'true') {
      // eslint-disable-next-line no-console
      console.log(`[DEBUG] Dealer rotated -> new dealerIdx=${this.state.dealerPosition} (playerId=${this.state.players[this.state.dealerPosition]?.id})`);
    }
    return this.state.dealerPosition;
  }

  public findNextActivePlayer(startPosition: number): Player | undefined {
    if (process.env.DEBUG_POKER === 'true') {
      // eslint-disable-next-line no-console
      console.log(`[DEBUG] findNextActivePlayer: startPos=${startPosition}, numPlayers=${this.state.players.length}, currentBet=${this.state.currentBet}`);
      // eslint-disable-next-line no-console
      console.log(`[DEBUG]   All players:`, this.state.players.map(p => `pos=${p.position} id=${p.id.slice(0,8)} hasActed=${p.hasActed} bet=${p.currentBet}`));
    }
    
    const numPlayers = this.state.players.length;
    
    // Find the index of the player with startPosition
    const startIndex = this.state.players.findIndex(p => p.position === startPosition);
    if (startIndex === -1) {
      if (process.env.DEBUG_POKER === 'true') {
        // eslint-disable-next-line no-console
        console.log(`[DEBUG]   -> Start position ${startPosition} not found in players array`);
      }
      return undefined;
    }
    
    // Check each player in order, starting from the next player after startIndex
    for (let i = 1; i <= numPlayers; i++) {
      const currentIndex = (startIndex + i) % numPlayers;
      const player = this.state.players[currentIndex];
      
      if (process.env.DEBUG_POKER === 'true') {
        // eslint-disable-next-line no-console
        console.log(`[DEBUG]   Loop iteration ${i}: arrayIndex=${currentIndex}, pos=${player.position}, player=${player.id}, hasActed=${player.hasActed}, currentBet=${player.currentBet}, isFolded=${player.isFolded}, isAllIn=${player.isAllIn}`);
      }
      
      if (player && !player.isFolded && !player.isAllIn && 
          (!player.hasActed || player.currentBet < this.state.currentBet)) {
        if (process.env.DEBUG_POKER === 'true') {
          // eslint-disable-next-line no-console
          console.log(`[DEBUG]   -> Found next player: ${player.id} at pos=${player.position}`);
        }
        return player;
      }
    }

    if (process.env.DEBUG_POKER === 'true') {
      // eslint-disable-next-line no-console
      console.log(`[DEBUG]   -> No next player found`);
    }
    return undefined;
  }
}
