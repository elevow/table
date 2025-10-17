import { Server as SocketServer } from 'socket.io';
import { PlayerAction, TableState, Player, DisconnectionState } from '../types/poker';
import { ActionValidator } from './action-validator';
import { StateManager } from './state-manager';
import { TimerManager } from './timer-manager';
import { createPokerEngine } from './poker/engine-factory';
import { PokerEngine } from './poker/poker-engine';

interface ActionResponse {
  success: boolean;
  error?: string;
  state?: TableState;
}

export class ActionManager {
  private stateManager: StateManager;
  private io: SocketServer;
  private actionTimeouts: Map<string, NodeJS.Timeout>;
  // US-032: Track player disconnections with grace period and scheduled auto-actions
  private disconnects: Map<string, DisconnectionState>;
  // US-034: Time Bank and turn timers
  private timerManager: TimerManager;
  private pokerEngines: Map<string, PokerEngine> = new Map();
  // Timed auto-runout timers (per table) for all-in reveals
  private autoRunoutTimers: Map<string, NodeJS.Timeout[]> = new Map();

  constructor(stateManager: StateManager, io: SocketServer) {
    this.stateManager = stateManager;
    this.io = io;
    this.actionTimeouts = new Map();
  this.disconnects = new Map();
  // Initialize time bank/timer manager (US-034)
  this.timerManager = new TimerManager(this.io, this.stateManager);
    // If AUTO_RUNOUT_DEBUG is enabled, make console.debug visible via console.log and announce
    try {
      if (process?.env?.AUTO_RUNOUT_DEBUG) {
        // eslint-disable-next-line no-console
        console.log('[auto-runout] debug enabled via AUTO_RUNOUT_DEBUG=1');
        const originalDebug = (console as any).debug?.bind(console) || ((..._args: any[]) => {});
        (console as any).debug = (...args: any[]) => {
          try {
            // eslint-disable-next-line no-console
            console.log(...args);
          } catch {
            try { originalDebug(...args); } catch {}
          }
        };
      }
    } catch {}
    this.setupSocketHandlers();
    // React to external state updates (e.g., engine advancing to flop after a call)
    const maybeAddListener = (this.stateManager as any)?.addListener;
    if (typeof maybeAddListener === 'function') {
      try {
        maybeAddListener.call(this.stateManager, (tableId: string, state: TableState, update: Partial<TableState>) => {
          try {
            console.debug('[auto-runout] listener invoked', {
              tableId,
              stage: state.stage,
              updateKeys: Object.keys(update || {}),
              communityLen: state.communityCards?.length || 0
            });
            // If state just progressed and meets runout conditions, schedule reveals and hide UI
            const activeCount = state.players.filter(p => !p.isFolded).length;
            const anyAllIn = state.players.some(p => !p.isFolded && p.isAllIn);
            const nonAllInCount = state.players.filter(p => !p.isFolded && !p.isAllIn).length;
            const need = Math.max(0, 5 - (state.communityCards?.length || 0));
            if (activeCount >= 2 && anyAllIn && nonAllInCount <= 1 && need > 0 && state.stage !== 'showdown') {
              // Hide UI
              console.debug('[auto-runout] listener gating passed; hiding UI and stopping timers', { tableId, activeCount, anyAllIn, nonAllInCount, need, stage: state.stage });
              this.stateManager.updateState(tableId, { activePlayer: '' as any });
              // Stop any per-turn timer
              this.timerManager.stopTimer(tableId);
              // Ensure runout is scheduled
              this.maybeScheduleAutoRunout(tableId, state);
            } else {
              console.debug('[auto-runout] listener gating not met', { tableId, activeCount, anyAllIn, nonAllInCount, need, stage: state.stage });
            }
          } catch {}
        });
      } catch {}
    }
  }

  private setupSocketHandlers(): void {
    this.io.on('connection', (socket) => {
      // On join, clear any pending disconnection state for this player if known
      socket.on('join_table', ({ tableId, playerId }: { tableId: string; playerId: string }) => {
        const key = `${tableId}:${playerId}`;
        const disc = this.disconnects.get(key);
        if (disc) {
          // Player reconnected within grace period; cancel auto-action
          this.clearAutoActionTimeout(key);
          this.disconnects.delete(key);
        }
  (socket as any).playerId = playerId;
  socket.join(tableId);
  // Also join a personal room for per-player events (e.g., timebank updates)
  socket.join(playerId);
      });
      socket.on('player_action', (action: PlayerAction, callback: (response: ActionResponse) => void) => {
        // Remember identity and ensure socket is in the room for broadcasts
        (socket as any).playerId = action.playerId;
        socket.join(action.tableId);
        this.handlePlayerAction(action)
          .then(response => callback(response))
          .catch(error => callback({ success: false, error: error.message }));
      });

      // Run It Twice enable request (client emits when offering 2-4 runs) leveraging real PokerEngine for seed security
      socket.on('enable_run_it_twice', async (
        { tableId, runs }: { tableId: string; runs: number },
        cb?: (resp: { success: boolean; error?: string }) => void
      ) => {
        try {
          if (!tableId || typeof runs !== 'number') { cb?.({ success: false, error: 'Invalid parameters' }); return; }
          const state = this.stateManager.getState(tableId);
          if (!state) { cb?.({ success: false, error: 'Table not found' }); return; }
          if (state.runItTwice?.enabled) { cb?.({ success: false, error: 'Already enabled' }); return; }
          // Dynamic allowed runs: 1 up to number of active (non-folded) players
          const activeCount = state.players.filter(p => !p.isFolded).length;
          const maxRuns = Math.max(1, activeCount);
          if (runs < 1 || runs > maxRuns) { cb?.({ success: false, error: `Runs must be 1-${maxRuns}` }); return; }
          if (state.communityCards.length >= 5 || state.stage === 'showdown') { cb?.({ success: false, error: 'Too late' }); return; }
          const anyAllIn = state.players.some(p => p.isAllIn);
          if (!anyAllIn) { cb?.({ success: false, error: 'No all-in present' }); return; }

          const engine = this.getOrCreateEngine(tableId, state);
          // Sync public info (hole + community) into engine clone state
          const engState = (engine as any).getState();
          engState.communityCards = [...state.communityCards];
          engState.players.forEach((ep: any) => {
            const sp = state.players.find(p => p.id === ep.id);
            if (sp?.holeCards) ep.holeCards = sp.holeCards;
            ep.isAllIn = sp?.isAllIn;
            ep.isFolded = sp?.isFolded;
          });

          engine.enableRunItTwice(runs);
          const rit = engine.getState().runItTwice;
          this.stateManager.updateState(tableId, { runItTwice: rit });
          this.io.to(tableId).emit('rit_enabled', { tableId, runs, rit });
          cb?.({ success: true });
        } catch (e: any) {
          cb?.({ success: false, error: e?.message || 'Failed to enable Run It Twice' });
        }
      });

      // US-034: Allow clients to consume their time bank for the active turn
      socket.on('use_timebank', (
        { tableId, playerId }: { tableId: string; playerId: string },
        callback?: (resp: { success: boolean }) => void
      ) => {
        const success = this.timerManager.useTimeBank(tableId, playerId);
        if (callback) callback({ success });
      });

      // Track disconnects and schedule auto-actions
      socket.on('disconnect', (reason) => {
        // Expect client to have identified with last join_table; if not, skip
        const rooms = Array.from(socket.rooms).filter(r => r !== socket.id);
        const tableId = rooms[0];
        const playerId = (socket as any).playerId as string | undefined;
        if (!tableId || !playerId) return;

        this.scheduleAutoAction(tableId, playerId);
      });
    });
  }

  public async handlePlayerAction(action: PlayerAction): Promise<ActionResponse> {
    // Clear any pending auto-runout timers on new action to avoid conflicting updates
    // Note: If an all-in lock is in progress and timers exist, we will block actions below instead of clearing.
    const state = this.stateManager.getState(action.tableId);
    if (!state) {
      return { success: false, error: 'Table not found' };
    }

    // If hand is locked for auto-runout or already scheduled, with runout remaining, block further actions
    try {
      const nonAllInCount = state.players.filter(p => !p.isFolded && !p.isAllIn).length;
      const timersActive = (this.autoRunoutTimers.get(action.tableId) || []).length > 0;
      const need = Math.max(0, 5 - (state.communityCards?.length || 0));
      if ((nonAllInCount === 0 || timersActive) && need > 0 && state.stage !== 'showdown') {
        console.debug('[auto-runout] blocking action due to runout lock', {
          tableId: action.tableId,
          nonAllInCount,
          timersActive,
          need,
          stage: state.stage
        });
        return { success: false, error: 'Hand locked by all-in; runout in progress' };
      }
    } catch { /* ignore guard errors */ }

    const player = state.players.find(p => p.id === action.playerId);
    if (!player) {
      return { success: false, error: 'Player not found' };
    }

    // Validate action
    const validation = ActionValidator.validateAction(action, state, player);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // Calculate effects
    const effects = ActionValidator.calculateActionEffects(action, state, player);

    // Apply action effects
    const newState = this.applyAction(state, player, action, effects);

  // If the action progressed the game to showdown and RIT needs resolution, finalize via engine
  const maybeResolved = this.finalizeShowdownWithRit(action.tableId, newState);

    // Update state
  await this.stateManager.updateState(action.tableId, maybeResolved);

    // If the action resulted in an all-in lock with community cards remaining, schedule auto-runout
    this.maybeScheduleAutoRunout(action.tableId, maybeResolved);

    // Broadcast action
    this.broadcastAction(action);

    // Clear existing timeout and only set a new one if not in all-in auto-runout state
    this.clearActionTimeout(action.tableId);
    const postActiveCount = maybeResolved.players.filter(p => !p.isFolded).length;
    const postNonAllInCount = maybeResolved.players.filter(p => !p.isFolded && !p.isAllIn).length;
    const anyAllIn = maybeResolved.players.some(p => !p.isFolded && p.isAllIn);
    const runoutRemaining = Math.max(0, 5 - (maybeResolved.communityCards?.length || 0)) > 0;
    if (postActiveCount >= 2 && anyAllIn && postNonAllInCount <= 1 && runoutRemaining && maybeResolved.stage !== 'showdown') {
      // Immediately clear active player to hide action prompts while we auto-runout
      console.debug('[auto-runout] post-action gating met; hiding UI and not starting turn timer', {
        tableId: action.tableId,
        postActiveCount,
        anyAllIn,
        postNonAllInCount,
        runoutRemaining,
        stage: maybeResolved.stage,
        communityLen: maybeResolved.communityCards?.length || 0
      });
      this.stateManager.updateState(action.tableId, { activePlayer: '' as any });
      // Do not start turn timer during auto-runout
    } else {
      console.debug('[auto-runout] post-action gating not met; starting turn timer if applicable', {
        tableId: action.tableId,
        postActiveCount,
        anyAllIn,
        postNonAllInCount,
        runoutRemaining,
        stage: maybeResolved.stage,
        communityLen: maybeResolved.communityCards?.length || 0
      });
      this.setActionTimeout(action.tableId, maybeResolved);
    }

    return { success: true, state: maybeResolved };
  }

  private applyAction(
    state: TableState,
    player: Player,
    action: PlayerAction,
    effects: ReturnType<typeof ActionValidator.calculateActionEffects>
  ): TableState {
    const newState = { ...state };

    // Update player state
    const playerIndex = state.players.findIndex(p => p.id === player.id);
    const updatedPlayer = {
      ...player,
      stack: player.stack + effects.stackDelta,
      currentBet: player.currentBet + Math.abs(effects.stackDelta),
      hasActed: true,
      isFolded: action.type === 'fold',
      isAllIn: player.stack + effects.stackDelta === 0
    };
    newState.players = [
      ...state.players.slice(0, playerIndex),
      updatedPlayer,
      ...state.players.slice(playerIndex + 1)
    ];

    // Update table state
    newState.pot += effects.potDelta;
    newState.currentBet = effects.newCurrentBet;
    newState.minRaise = effects.newMinRaise;

    // Move to next active player
    newState.activePlayer = this.findNextActivePlayer(newState);

    // Check if betting round is complete
    if (this.isBettingRoundComplete(newState)) {
      newState.stage = this.getNextStage(newState.stage);
      this.resetBettingRound(newState);
    }

    // If all active players are all-in and community runout remains, lock the hand (no active player)
    try {
      const allActiveAllIn = newState.players.filter(p => !p.isFolded).every(p => p.isAllIn);
      const need = Math.max(0, 5 - (newState.communityCards?.length || 0));
      if (allActiveAllIn && need > 0 && newState.stage !== 'showdown') {
        (newState as any).activePlayer = '';
      }
    } catch { /* ignore */ }

    return newState;
  }

  private findNextActivePlayer(state: TableState): string {
    const activePlayerIndex = state.players.findIndex(p => p.id === state.activePlayer);
    let nextIndex = (activePlayerIndex + 1) % state.players.length;
    
    while (nextIndex !== activePlayerIndex) {
      const player = state.players[nextIndex];
      if (!player.isFolded && !player.isAllIn && player.stack > 0) {
        return player.id;
      }
      nextIndex = (nextIndex + 1) % state.players.length;
    }
    
    return state.activePlayer; // If no other eligible player found
  }

  private isBettingRoundComplete(state: TableState): boolean {
    const activePlayers = state.players.filter(p => !p.isFolded && !p.isAllIn);
    if (activePlayers.length <= 1) return true;

    // All active players must have acted
    const allPlayersActed = activePlayers.every(p => p.hasActed);
    // All active players must have equal bets or be all-in
    const allBetsEqual = activePlayers.every(p => 
      p.currentBet === state.currentBet || p.isAllIn
    );
    // At least one player must have acted for the round to complete
    const anyPlayerActed = activePlayers.some(p => p.hasActed);

    return anyPlayerActed && allPlayersActed && allBetsEqual;
  }

  private getNextStage(currentStage: TableState['stage']): TableState['stage'] {
    const stages: TableState['stage'][] = ['preflop', 'flop', 'turn', 'river', 'showdown'];
    const currentIndex = stages.indexOf(currentStage);
    return stages[currentIndex + 1] || 'showdown';
  }

  private resetBettingRound(state: TableState): void {
    state.players.forEach(player => {
      player.hasActed = false;
      player.currentBet = 0;
    });
    state.currentBet = 0;
    state.minRaise = state.bigBlind;
  }

  // When table state reaches showdown and runItTwice is enabled but results empty, reconstruct engine resolution
  private finalizeShowdownWithRit(tableId: string, state: TableState): TableState {
    if (state.stage !== 'showdown') return state;
    const rit = state.runItTwice;
    if (!rit || !rit.enabled || (rit.results && rit.results.length > 0)) return state; // already resolved or not enabled
    try {
      const engine = this.getOrCreateEngine(tableId, state);
      // Sync players & bets/pot (only needed minimally for distribution; we mirror pot & current bets)
      const engState = (engine as any).getState();
      engState.communityCards = [...state.communityCards];
      engState.pot = state.pot;
      engState.players.forEach((ep: any) => {
        const sp = state.players.find(p => p.id === ep.id);
        if (!sp) return;
        ep.holeCards = sp.holeCards;
        ep.isFolded = sp.isFolded;
        ep.isAllIn = sp.isAllIn;
        ep.currentBet = sp.currentBet;
        ep.stack = sp.stack; // baseline
      });
      // RIT already enabled earlier -> just run resolution now
      const engRun = (engine as any).getState().runItTwice;
      if ((!engRun || !engRun.enabled) && rit?.enabled) {
        // Table state indicates RIT enabled but engine instance not yet configured (e.g., direct state injection in tests)
        try {
          engine.enableRunItTwice(rit.numberOfRuns, (rit.seeds && rit.seeds.length === rit.numberOfRuns) ? rit.seeds : undefined);
        } catch {
          // swallow; we'll attempt runItTwiceNow and rely on catch below if it still fails
        }
      }
      engine.runItTwiceNow();
      const post = engine.getState();
      // Apply distribution deltas to original state (stacks, pot, runItTwice results)
      const updatedPlayers = state.players.map(p => {
        const ep = post.players.find((x: any) => x.id === p.id);
        return ep ? { ...p, stack: ep.stack, currentBet: 0 } : p;
      });
      const newState: TableState = { ...state, players: updatedPlayers, pot: 0, runItTwice: post.runItTwice };
      this.stateManager.updateState(tableId, { players: updatedPlayers, pot: 0, runItTwice: post.runItTwice });
      return newState;
    } catch (e) {
      // Fail silently; keep original state
      return state;
    }
  }

  // Schedule automatic street reveals at 5s intervals when hand is locked by all-in and community runout remains
  private maybeScheduleAutoRunout(tableId: string, state: TableState): void {
    try {
      // Only for Hold'em/Omaha style (no stud runout automation)
      const variant = (state as any).variant as string | undefined;
      if (variant === 'seven-card-stud' || variant === 'seven-card-stud-hi-lo' || variant === 'five-card-stud') {
        console.debug('[auto-runout] skip scheduling: variant not supported', { tableId, variant });
        return;
      }
      if (!Array.isArray(state.communityCards)) {
        console.debug('[auto-runout] skip scheduling: communityCards not an array', { tableId });
        return;
      }
      if (state.stage === 'showdown') {
        console.debug('[auto-runout] skip scheduling: already at showdown', { tableId });
        return; // already done
      }
  // Start auto-runout only when there is at least one all-in and betting is effectively closed (<=1 non-all-in), and at least 2 active players remain
  const activeCount = state.players.filter(p => !p.isFolded).length;
  if (activeCount < 2) { console.debug('[auto-runout] skip scheduling: active players < 2', { tableId, activeCount }); return; }
  const anyAllIn = state.players.some(p => !p.isFolded && p.isAllIn);
  if (!anyAllIn) { console.debug('[auto-runout] skip scheduling: no all-in detected', { tableId }); return; }
  const nonAllInCount = state.players.filter(p => !p.isFolded && !p.isAllIn).length;
  if (nonAllInCount > 1) { console.debug('[auto-runout] skip scheduling: betting not closed (>1 non-all-in)', { tableId, nonAllInCount }); return; }
      // If no more cards are needed, nothing to do
      const needed = Math.max(0, 5 - state.communityCards.length);
      if (needed === 0) { console.debug('[auto-runout] skip scheduling: no more cards needed', { tableId }); return; }
      // Ensure we only schedule once per hand
      if (this.autoRunoutTimers.has(tableId) && this.autoRunoutTimers.get(tableId)!.length > 0) {
        console.debug('[auto-runout] skip scheduling: timers already active', { tableId, timers: this.autoRunoutTimers.get(tableId)!.length });
        return;
      }

      // Prepare engine for deterministic preview using current public info
      const engine = this.getOrCreateEngine(tableId, state);
      const engState = (engine as any).getState();
      engState.communityCards = [...state.communityCards];
      engState.players.forEach((ep: any) => {
        const sp = state.players.find(p => p.id === ep.id);
        if (sp?.holeCards) ep.holeCards = sp.holeCards;
        ep.isAllIn = sp?.isAllIn;
        ep.isFolded = sp?.isFolded;
      });
      try { (engine as any).prepareRabbitPreview?.({ community: engState.communityCards, known: engState.players.flatMap((p: any) => p.holeCards || []) }); } catch { /* optional */ }

      console.debug('[auto-runout] scheduling timers', { tableId, stage: state.stage, activeCount, anyAllIn, nonAllInCount, needed, communityLen: state.communityCards.length });
      const timers: NodeJS.Timeout[] = [];
      const currentLen = state.communityCards.length;
      const steps: Array<'flop' | 'turn' | 'river'> = [];
      if (currentLen < 3) steps.push('flop');
      if (currentLen < 4) steps.push('turn');
      if (currentLen < 5) steps.push('river');

  // Hide action UI immediately
  console.debug('[auto-runout] hiding UI immediately on schedule', { tableId });
  this.stateManager.updateState(tableId, { activePlayer: '' as any });

  let delay = 5000; // 5 seconds between reveals
      steps.forEach((street) => {
        const t = setTimeout(() => {
          try {
            const prev = this.stateManager.getState(tableId);
            if (!prev) return;
            // If hand already ended or progressed, abort remaining timers
            if (prev.stage === 'showdown') { console.debug('[auto-runout] abort remaining timers: already at showdown', { tableId }); this.clearAutoRunout(tableId); return; }
            // Stop any per-turn timer since no actions should occur during runout
            console.debug('[auto-runout] revealing street', { tableId, street });
            this.timerManager.stopTimer(tableId);
            const preview = (engine as any).previewRabbitHunt?.(street);
            const cards = preview?.cards || [];
            console.debug('[auto-runout] preview results', { tableId, street, cards });
            // Keep engine's community in sync so subsequent previews compute correct deltas
            try {
              const es = (engine as any).getState();
              if (Array.isArray(es?.communityCards) && Array.isArray(cards) && cards.length > 0) {
                es.communityCards.push(...cards);
              }
            } catch { /* ignore engine sync errors */ }
            const updated = { ...prev, communityCards: [...prev.communityCards, ...cards] } as TableState;
            // Update stage to reflect current street
            updated.stage = street === 'flop' ? 'flop' : street === 'turn' ? 'turn' : 'river';
            // Clear activePlayer to prevent UI from offering actions
            this.stateManager.updateState(tableId, { communityCards: updated.communityCards, stage: updated.stage, activePlayer: '' as any });

            // If this was the river, advance to showdown after another 5s and finalize (including RIT)
            if (street === 'river') {
              const t2 = setTimeout(async () => {
                try {
                  console.debug('[auto-runout] advancing to showdown after river', { tableId });
                  const st = this.stateManager.getState(tableId) || updated;
                  const atShowdown = { ...st, stage: 'showdown' as const } as TableState;
                  const finalized = this.finalizeShowdownWithRit(tableId, atShowdown);
                  await this.stateManager.updateState(tableId, { ...finalized, activePlayer: '' as any });
                } finally {
                  this.clearAutoRunout(tableId);
                }
              }, 5000);
              timers.push(t2);
            }
          } catch {
            // swallow to avoid breaking timers
          }
        }, delay);
        console.debug('[auto-runout] scheduled street reveal', { tableId, street, delayMs: delay });
        timers.push(t);
        delay += 5000;
      });

      this.autoRunoutTimers.set(tableId, timers);
    } catch {
      // ignore scheduling failures
    }
  }

  private clearAutoRunout(tableId: string): void {
    const arr = this.autoRunoutTimers.get(tableId);
    if (arr && arr.length) {
      console.debug('[auto-runout] clearing timers', { tableId, count: arr.length });
      arr.forEach(t => clearTimeout(t));
    }
    this.autoRunoutTimers.delete(tableId);
  }

  // Retrieve or lazily construct a PokerEngine seeded with current table meta for RIT operations
  private getOrCreateEngine(tableId: string, state: TableState): PokerEngine {
    let engine = this.pokerEngines.get(tableId);
    if (engine) return engine;
    // Build minimal player array for engine (clone to avoid mutating shared state)
    const players = state.players.map(p => ({ ...p }));
    engine = createPokerEngine({
      tableId,
      players: players as any,
      smallBlind: state.smallBlind,
      bigBlind: state.bigBlind,
      state: {
        bettingMode: state.bettingMode,
        variant: state.variant,
        requireRunItTwiceUnanimous: state.requireRunItTwiceUnanimous,
      }
    });
    this.pokerEngines.set(tableId, engine);
    return engine;
  }

  private broadcastAction(action: PlayerAction): void {
    this.io.to(action.tableId).emit('player_action', action);
  }

  // US-032: Disconnection handling
  private scheduleAutoAction(tableId: string, playerId: string): void {
    const state = this.stateManager.getState(tableId);
    if (!state) return;
    const player = state.players.find(p => p.id === playerId);
    if (!player) return;

    const graceMs = Math.max(5000, player.timeBank ?? 30000); // use timeBank as baseline
    const executeAt = new Date(Date.now() + graceMs);
    const key = `${tableId}:${playerId}`;

    const autoType: DisconnectionState['autoAction']['type'] = state.currentBet > player.currentBet ? 'fold' : 'check-fold';
    const disc: DisconnectionState = {
      playerId,
      graceTime: graceMs,
      autoAction: { type: autoType, executeAt },
      preservedStack: player.stack,
      position: player.position,
      reconnectBy: executeAt
    };
    this.disconnects.set(key, disc);

    const timer = setTimeout(async () => {
      const current = this.disconnects.get(key);
      if (!current) return; // cancelled due to reconnect
      // Re-evaluate latest state for check-fold behavior
      const s = this.stateManager.getState(tableId);
      const pl = s?.players.find(p => p.id === playerId);
      const execType: PlayerAction['type'] = (!s || !pl) ? 'fold' : (s.currentBet > pl.currentBet ? 'fold' : 'check');
      const action: PlayerAction = { type: execType, playerId, tableId, timestamp: Date.now() } as PlayerAction;
      this.broadcastAction(action);
      try {
        await this.handlePlayerAction(action);
      } catch {
        // ignore if invalid now
      }
      this.disconnects.delete(key);
    }, graceMs);

    // Store timer using existing map for reuse
    this.actionTimeouts.set(`disc:${key}`, timer);
  }

  private clearAutoActionTimeout(key: string): void {
    const timer = this.actionTimeouts.get(`disc:${key}`);
    if (timer) {
      clearTimeout(timer);
      this.actionTimeouts.delete(`disc:${key}`);
    }
  }

  private setActionTimeout(tableId: string, state: TableState): void {
  // Delegate to TimerManager (US-034)
  this.timerManager.startTimer(tableId, state.activePlayer);
  }

  private clearActionTimeout(tableId: string): void {
  // Stop the TimerManager timer for this table (US-034)
  this.timerManager.stopTimer(tableId);
  }

  private async handleTimeout(tableId: string, playerId: string): Promise<void> {
  // For active turn timeouts, default to fold to preserve legacy behavior
  const timeoutAction: PlayerAction = { type: 'fold', playerId, tableId, timestamp: Date.now() } as PlayerAction;
    this.broadcastAction(timeoutAction);
    try {
      await this.handlePlayerAction(timeoutAction);
    } catch {
      // ignore
    }
  }
}
