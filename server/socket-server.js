// Standalone Socket.IO server for seating and gameplay events.
// Deploy this to a persistent host (Koyeb/Render/Fly/Railway/VM) and point the
// frontend via NEXT_PUBLIC_SOCKET_IO_URL (and optionally NEXT_PUBLIC_SOCKET_IO_PATH).

// Enable loading TypeScript modules (PokerEngine, etc.) at runtime
try {
  require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs' } });
  // eslint-disable-next-line no-console
  console.log('[socket-server] ts-node registered for TS imports');
} catch (e) {
  // eslint-disable-next-line no-console
  console.warn('[socket-server] ts-node not available; gameplay features may be limited', e?.message || e);
}

const http = require('http');
const { Server } = require('socket.io');
const { fetchRoomRebuyLimit } = require('../src/lib/shared/rebuy-limit');
const { getPlayerRebuyInfo, recordBuyin } = require('../src/lib/shared/rebuy-tracker');

const PORT = process.env.PORT || 4001;
const SOCKET_PATH = process.env.SOCKET_IO_PATH || process.env.NEXT_PUBLIC_SOCKET_IO_PATH || '/socket.io';

// In-memory seat storage: tableId -> { [seatNumber]: { playerId, playerName, chips } | null }
const gameSeats = new Map();

function initializeRoomSeats(tableId) {
  if (!gameSeats.has(tableId)) {
    const seats = {};
    for (let i = 1; i <= 9; i++) seats[i] = null;
    gameSeats.set(tableId, seats);
  }
  return gameSeats.get(tableId);
}

function getRoomSeats(tableId) {
  return gameSeats.get(tableId) || {};
}

function setRoomSeats(tableId, seats) {
  gameSeats.set(tableId, seats);
}

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const io = new Server(server, {
  path: SOCKET_PATH,
  transports: ['websocket', 'polling'],
  allowUpgrades: true,
  pingInterval: 25000,
  pingTimeout: 20000,
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// In-memory active poker engines: tableId -> PokerEngine instance
if (!global.activeGames) {
  global.activeGames = new Map();
}

// In-memory table configuration for special modes (e.g., Dealer's Choice)
// tableId -> {
//   mode: 'fixed' | 'dealers-choice',
//   chosenVariant?: string,
//   allowedVariants?: string[],
//   dcStepCount?: number, // number of completed hands since last DC prompt
// }
if (!global.tableConfigs) {
  global.tableConfigs = new Map();
}

// Helpers: Start next hand after showdown
const NEXT_HAND_DELAY_MS = 5000;
if (!global.nextHandTimers) {
  global.nextHandTimers = new Map();
}
const nextHandTimers = global.nextHandTimers;

function scheduleNextHand(tableId) {
  try {
    if (!global.activeGames || !global.activeGames.has(tableId)) return;
    if (nextHandTimers.has(tableId)) return;
    const engine = global.activeGames.get(tableId);
    const state = engine?.getState?.() || {};
    if (state.stage !== 'showdown') return;
    const players = Array.isArray(state.players) ? state.players : [];
    if (players.length < 2) return;
    const timer = setTimeout(() => {
      try {
        if (!global.activeGames || !global.activeGames.has(tableId)) return;
        const eng = global.activeGames.get(tableId);
        const curr = eng?.getState?.() || {};
        if (curr.stage !== 'showdown') return;

        const tableCfg = global.tableConfigs.get(tableId) || { mode: 'fixed' };
        const isDealersChoice = tableCfg.mode === 'dealers-choice';

        // Rebuild a fresh engine to rotate dealer and clear state
        try { delete require.cache[require.resolve('../src/lib/poker/poker-engine')]; } catch {}
        const { PokerEngine } = require('../src/lib/poker/poker-engine');
        const sb = Number(curr.smallBlind) || 1;
        const bb = Number(curr.bigBlind) || 2;
        // Prepare a neutral player list for the fresh engine
        const rebuilt = (Array.isArray(curr.players) ? curr.players : []).map(p => ({
          id: p.id, name: p.name || p.id, position: p.position, stack: p.stack,
          currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: p.timeBank ?? 30, holeCards: []
        }));
        // Fresh engine baseline (we'll decide variant below)
        const baseFresh = new PokerEngine(tableId, rebuilt, sb, bb, {});
        try { baseFresh.state.dealerPosition = curr.dealerPosition ?? 0; } catch {}

        if (isDealersChoice) {
          // Dealer's Choice: prompt based on completed hands since last prompt
          const st = baseFresh.getState();
          const n = Array.isArray(st.players) ? st.players.length : 0;
          const upcomingDealerIdx = n > 0 ? ((st.dealerPosition + 1) % n) : 0;
          const upcomingDealerId = st.players?.[upcomingDealerIdx]?.id;

          const prevStep = Number(tableCfg.dcStepCount || 0);
          const threshold = (n > 0 ? n : 1) + 1; // number of players + 1
          const nextStep = prevStep + 1;

          if (nextStep >= threshold) {
            // Time to prompt dealer; reset counter and wait for choice
            global.tableConfigs.set(tableId, { ...tableCfg, dcStepCount: 0 });
            global.activeGames.set(tableId, baseFresh);
            const allowed = tableCfg.allowedVariants || ['texas-holdem', 'omaha', 'omaha-hi-lo', 'seven-card-stud', 'seven-card-stud-hi-lo', 'five-card-stud'];
            io.to(`table_${tableId}`).emit('awaiting_dealer_choice', {
              tableId,
              dealerId: upcomingDealerId,
              allowedVariants: allowed,
              current: tableCfg.chosenVariant || 'texas-holdem',
            });
          } else {
            // Auto-start with the last chosen variant and increment counter
            const useVariant = tableCfg.chosenVariant || 'texas-holdem';
            const mode = (useVariant === 'omaha' || useVariant === 'omaha-hi-lo') ? 'pot-limit' : (curr.bettingMode || 'no-limit');
            const withVariant = new PokerEngine(tableId, rebuilt, sb, bb, { variant: useVariant, bettingMode: mode });
            try { withVariant.state.dealerPosition = curr.dealerPosition ?? 0; } catch {}
            global.tableConfigs.set(tableId, { ...tableCfg, dcStepCount: nextStep });
            global.activeGames.set(tableId, withVariant);
            withVariant.startNewHand();
            const newState = withVariant.getState();
            io.to(`table_${tableId}`).emit('game_state_update', {
              gameState: newState,
              lastAction: { action: 'auto_next_hand' },
              timestamp: new Date().toISOString(),
            });
          }
        } else {
          // Fixed variant: start next hand immediately
          const nextVariant = curr.variant || 'texas-holdem';
          const bettingMode = curr.bettingMode || ((nextVariant === 'omaha' || nextVariant === 'omaha-hi-lo') ? 'pot-limit' : 'no-limit');
          const fresh = new PokerEngine(tableId, rebuilt, sb, bb, { variant: nextVariant, bettingMode });
          try { fresh.state.dealerPosition = curr.dealerPosition ?? 0; } catch {}
          global.activeGames.set(tableId, fresh);
          fresh.startNewHand();
          const newState = fresh.getState();
          io.to(`table_${tableId}`).emit('game_state_update', {
            gameState: newState,
            lastAction: { action: 'auto_next_hand' },
            timestamp: new Date().toISOString(),
          });
        }
      } finally {
        nextHandTimers.delete(tableId);
      }
    }, NEXT_HAND_DELAY_MS);
    nextHandTimers.set(tableId, timer);
  } catch (e) {
    console.warn('scheduleNextHand failed:', e);
  }
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id, 'via', socket.conn.transport.name);

  socket.on('join_table', (data) => {
    try {
      const { tableId, playerId } = data || {};
      if (!tableId || !playerId) return;
      socket.join(`table_${tableId}`);
      socket.tableId = tableId;
      socket.playerId = playerId;
      // If this is a Dealer's Choice table and we're awaiting a choice, notify the joiner only
      try {
        const cfg = global.tableConfigs?.get?.(tableId);
        const engine = global.activeGames?.get?.(tableId);
        if (cfg && cfg.mode === 'dealers-choice' && engine && typeof engine.getState === 'function') {
          const st = engine.getState();
          const n = Array.isArray(st.players) ? st.players.length : 0;
          if (n > 0) {
            const awaiting = !st.variant && st.communityCards?.length === 0 && st.stage === 'preflop';
            if (awaiting) {
              const upcomingDealerIdx = ((st.dealerPosition || 0) + 1) % n;
              const dealerId = st.players?.[upcomingDealerIdx]?.id;
              const allowed = cfg.allowedVariants || ['texas-holdem', 'omaha', 'omaha-hi-lo', 'seven-card-stud', 'seven-card-stud-hi-lo', 'five-card-stud'];
              socket.emit('awaiting_dealer_choice', {
                tableId,
                dealerId,
                allowedVariants: allowed,
                current: cfg.chosenVariant || 'texas-holdem',
              });
            }
          }
        }
      } catch {}
    } catch (e) {
      console.warn('join_table error', e);
    }
  });

  socket.on('get_seat_state', (data) => {
    try {
      const { tableId } = data || {};
      if (!tableId) return;
      const seats = initializeRoomSeats(tableId);
      socket.emit('seat_state', { seats });
    } catch (e) {
      console.warn('get_seat_state error', e);
    }
  });

  socket.on('claim_seat', async (data) => {
    try {
      const { tableId, seatNumber, playerId, playerName, chips } = data || {};
      if (!tableId || !seatNumber || !playerId) return;
      const seats = initializeRoomSeats(tableId);

      // Check occupied
      if (seats[seatNumber]) {
        socket.emit('seat_claim_failed', { error: 'Seat already occupied', seatNumber });
        return;
      }
      // Check not already seated
      const already = Object.entries(seats).find(([, a]) => a && a.playerId === playerId);
      if (already) {
        socket.emit('seat_claim_failed', { error: 'Player already has a seat', seatNumber: Number(already[0]) });
        return;
      }
      const rebuyLimit = await fetchRoomRebuyLimit(tableId);
      const previousRecord = getPlayerRebuyInfo(tableId, playerId);
      const isInitial = !previousRecord;
      const rebuysUsed = previousRecord?.rebuys ?? 0;
      const numericLimit = rebuyLimit === 'unlimited' ? Number.POSITIVE_INFINITY : rebuyLimit;

      if (!isInitial && rebuysUsed >= numericLimit) {
        const message = rebuyLimit === 'unlimited'
          ? 'Rebuy not available for this table.'
          : `Rebuy limit (${rebuyLimit}) reached for this room.`;
        socket.emit('seat_claim_failed', { error: message, seatNumber, rebuyLimit, rebuysUsed });
        return;
      }

      seats[seatNumber] = { playerId, playerName, chips: Number(chips) || 20 };
      setRoomSeats(tableId, seats);
      io.to(`table_${tableId}`).emit('seat_claimed', { seatNumber, playerId, playerName, chips: Number(chips) || 20 });
      recordBuyin(tableId, playerId);
      console.log(`Seat ${seatNumber} claimed by ${playerName || playerId} at table ${tableId}`);
    } catch (e) {
      console.warn('claim_seat error', e);
    }
  });

  socket.on('stand_up', (data) => {
    try {
      const { tableId, seatNumber, playerId } = data || {};
      if (!tableId || !seatNumber || !playerId) return;
      const seats = getRoomSeats(tableId);
      if (!seats || !seats[seatNumber] || seats[seatNumber].playerId !== playerId) {
        socket.emit('stand_up_failed', { error: 'Not your seat' });
        return;
      }
      seats[seatNumber] = null;
      setRoomSeats(tableId, seats);
      io.to(`table_${tableId}`).emit('seat_vacated', { seatNumber, playerId });
      console.log(`Seat ${seatNumber} vacated by ${playerId} at table ${tableId}`);
    } catch (e) {
      console.warn('stand_up error', e);
    }
  });

  // Start a game with seated players
  socket.on('start_game', (data) => {
    try {
      const { tableId, playerId, seatedPlayers } = data || {};
      if (!tableId || !Array.isArray(seatedPlayers) || seatedPlayers.length < 2) {
        socket.emit('game_start_failed', { error: 'Not enough players to start game' });
        return;
      }
      // Load PokerEngine dynamically each time to pick up latest code changes
      try { delete require.cache[require.resolve('../src/lib/poker/poker-engine')]; } catch {}
      const { PokerEngine } = require('../src/lib/poker/poker-engine');
      // Sort by seatNumber to define positions
      const sorted = seatedPlayers.slice().sort((a, b) => (a.seatNumber || 0) - (b.seatNumber || 0));
      const players = sorted.map((s, idx) => ({
        id: s.playerId,
        name: s.playerName || s.playerId,
        position: idx + 1,
        stack: Number(s.chips) || 20,
        currentBet: 0,
        hasActed: false,
        isFolded: false,
        isAllIn: false,
        timeBank: 30,
        holeCards: [],
      }));
      // Ingest optional table configuration provided by the client (preferred) or fall back to defaults
      let smallBlind = Number(data?.smallBlind) || Number(data?.sb) || 1;
      let bigBlind = Number(data?.bigBlind) || Number(data?.bb) || 2;
      let variant = data?.variant || 'texas-holdem';
      const allowedVariants = ['texas-holdem', 'omaha', 'omaha-hi-lo', 'seven-card-stud', 'seven-card-stud-hi-lo', 'five-card-stud'];
      const isDealersChoice = String(variant) === 'dealers-choice';
      // Default betting mode depends on effective variant
      const effectiveVariant = isDealersChoice ? (data?.initialChoice || 'texas-holdem') : variant;
      let bettingMode = data?.bettingMode
        || ((effectiveVariant === 'omaha' || effectiveVariant === 'omaha-hi-lo') ? 'pot-limit' : 'no-limit');

      if (isDealersChoice) {
        // Record table config; do NOT pre-set chosenVariant; dealer will pick each hand
        global.tableConfigs.set(tableId, {
          mode: 'dealers-choice',
          chosenVariant: undefined,
          allowedVariants,
          dcStepCount: 0,
        });
      } else {
        global.tableConfigs.set(tableId, { mode: 'fixed' });
      }

      const engine = isDealersChoice
        ? new PokerEngine(tableId, players, smallBlind, bigBlind, {})
        : new PokerEngine(tableId, players, smallBlind, bigBlind, { variant: effectiveVariant, bettingMode });
      if (isDealersChoice) {
        // For the very first hand, let the upcoming dealer choose; set dealerPosition to -1 so first dealer is players[0]
        try { engine.state.dealerPosition = -1; } catch {}
      } else {
        engine.startNewHand();
      }
      if (!global.activeGames) global.activeGames = new Map();
      global.activeGames.set(tableId, engine);
      const gameState = engine.getState();
      const starter = sorted.find(p => p.playerId === playerId);
      io.to(`table_${tableId}`).emit('game_started', {
        startedBy: playerId,
        playerName: starter?.playerName || 'Unknown Player',
        seatedPlayers: sorted,
        gameState,
        timestamp: new Date().toISOString(),
      });
      if (isDealersChoice) {
        const st = engine.getState();
        const n = Array.isArray(st.players) ? st.players.length : 0;
        const upcomingDealerIdx = n > 0 ? ((st.dealerPosition + 1) % n) : 0;
        const dealerId = st.players?.[upcomingDealerIdx]?.id;
        io.to(`table_${tableId}`).emit('awaiting_dealer_choice', {
          tableId,
          dealerId,
          allowedVariants,
          current: global.tableConfigs.get(tableId)?.chosenVariant || 'texas-holdem',
        });
      }
      console.log(`Game started at table ${tableId} with ${players.length} players`);
    } catch (e) {
      console.error('start_game failed:', e);
      socket.emit('game_start_failed', { error: 'Failed to initialize poker game' });
    }
  });

  // Player actions: bet/call/raise/fold/check
  socket.on('player_action', (data) => {
    try {
      const { tableId, playerId, action, amount } = data || {};
      if (!tableId || !playerId || !action) return;
      if (!global.activeGames || !global.activeGames.has(tableId)) {
        socket.emit('action_failed', { error: 'No active game found', playerId, action });
        return;
      }
      const engine = global.activeGames.get(tableId);
      engine.handleAction({ type: action, playerId, tableId, amount: amount || 0, timestamp: Date.now() });
      if (typeof engine.ensureWinByFoldIfSingle === 'function') {
        engine.ensureWinByFoldIfSingle();
      }
      const gameState = engine.getState();
      io.to(`table_${tableId}`).emit('game_state_update', {
        gameState,
        lastAction: { playerId, action, amount },
        timestamp: new Date().toISOString(),
      });
      if (gameState?.stage === 'showdown') {
        scheduleNextHand(tableId);
      }
    } catch (e) {
      console.error('player_action failed:', e);
      socket.emit('action_failed', { error: e?.message || 'Failed to process action' });
    }
  });

  // Defensive settlement when only one player remains
  socket.on('force_settlement', (data) => {
    try {
      const { tableId } = data || {};
      if (!tableId || !global.activeGames || !global.activeGames.has(tableId)) return;
      const engine = global.activeGames.get(tableId);
      const before = engine.getState();
      const activeCount = (before.players || []).filter(p => !(p.isFolded || p.folded)).length;
      if (activeCount === 1 && before.stage !== 'showdown' && typeof engine.ensureWinByFoldIfSingle === 'function') {
        engine.ensureWinByFoldIfSingle();
        const after = engine.getState();
        io.to(`table_${tableId}`).emit('game_state_update', {
          gameState: after,
          lastAction: { action: 'force_settlement' },
          timestamp: new Date().toISOString(),
        });
        if (after?.stage === 'showdown') scheduleNextHand(tableId);
      }
    } catch (e) {
      console.warn('force_settlement failed:', e);
    }
  });

  // Client can request next hand explicitly
  socket.on('request_next_hand', (data) => {
    try {
      const { tableId } = data || {};
      if (!tableId || !global.activeGames || !global.activeGames.has(tableId)) return;
      const engine = global.activeGames.get(tableId);
      const state = engine.getState();
      if (state.stage !== 'showdown') return;
      const players = Array.isArray(state.players) ? state.players : [];
      if (players.length < 2) return;
      const cfg = global.tableConfigs.get(tableId) || { mode: 'fixed' };
      if (cfg.mode === 'dealers-choice') {
        // Rebuild a fresh engine and decide whether to prompt or auto-start based on players+1 threshold
        try { delete require.cache[require.resolve('../src/lib/poker/poker-engine')]; } catch {}
        const { PokerEngine } = require('../src/lib/poker/poker-engine');
        const sb = Number(state.smallBlind) || 1;
        const bb = Number(state.bigBlind) || 2;
        const rebuilt = players.map(p => ({
          id: p.id, name: p.name || p.id, position: p.position, stack: p.stack,
          currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: p.timeBank ?? 30, holeCards: []
        }));
        const freshBase = new PokerEngine(tableId, rebuilt, sb, bb, {});
        try { freshBase.state.dealerPosition = state.dealerPosition ?? 0; } catch {}

        const st = freshBase.getState();
        const n = Array.isArray(st.players) ? st.players.length : 0;
        const upcomingDealerIdx = n > 0 ? ((st.dealerPosition + 1) % n) : 0;
        const upcomingDealerId = st.players?.[upcomingDealerIdx]?.id;

        const prevStep = Number(cfg.dcStepCount || 0);
        const threshold = (n > 0 ? n : 1) + 1;
        const nextStep = prevStep + 1;

        if (nextStep >= threshold) {
          global.tableConfigs.set(tableId, { ...cfg, dcStepCount: 0 });
          global.activeGames.set(tableId, freshBase);
          io.to(`table_${tableId}`).emit('awaiting_dealer_choice', {
            tableId,
            dealerId: upcomingDealerId,
            allowedVariants: cfg.allowedVariants || ['texas-holdem','omaha','omaha-hi-lo','seven-card-stud','seven-card-stud-hi-lo','five-card-stud'],
            current: cfg.chosenVariant || 'texas-holdem',
          });
        } else {
          const useVariant = cfg.chosenVariant || 'texas-holdem';
          const mode = (useVariant === 'omaha' || useVariant === 'omaha-hi-lo') ? 'pot-limit' : (state.bettingMode || 'no-limit');
          const fresh = new PokerEngine(tableId, rebuilt, sb, bb, { variant: useVariant, bettingMode: mode });
          try { fresh.state.dealerPosition = state.dealerPosition ?? 0; } catch {}
          global.tableConfigs.set(tableId, { ...cfg, dcStepCount: nextStep });
          global.activeGames.set(tableId, fresh);
          fresh.startNewHand();
          const newState = fresh.getState();
          io.to(`table_${tableId}`).emit('game_state_update', {
            gameState: newState,
            lastAction: { action: 'request_next_hand' },
            timestamp: new Date().toISOString(),
          });
        }
      } else {
        engine.startNewHand();
        const newState = engine.getState();
        io.to(`table_${tableId}`).emit('game_state_update', {
          gameState: newState,
          lastAction: { action: 'request_next_hand' },
          timestamp: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.warn('request_next_hand failed:', e);
    }
  });

  // Dealer chooses the variant for the upcoming hand (Dealer's Choice tables only)
  socket.on('choose_variant', (data) => {
    try {
      const { tableId, variant } = data || {};
      if (!tableId || !variant) return;
      const cfg = global.tableConfigs.get(tableId);
      if (!cfg || cfg.mode !== 'dealers-choice') return;
      if (!global.activeGames || !global.activeGames.has(tableId)) return;
      const engine = global.activeGames.get(tableId);
      const st = engine.getState();
      const n = Array.isArray(st.players) ? st.players.length : 0;
      const upcomingDealerIdx = n > 0 ? ((st.dealerPosition + 1) % n) : 0;
      const dealerId = st.players?.[upcomingDealerIdx]?.id;
      if (socket.playerId !== dealerId) {
        socket.emit('action_failed', { error: 'Only the dealer can choose the variant for this hand' });
        return;
      }
      const allowed = cfg.allowedVariants || ['texas-holdem', 'omaha', 'omaha-hi-lo', 'seven-card-stud', 'seven-card-stud-hi-lo', 'five-card-stud'];
      if (!allowed.includes(variant)) {
        socket.emit('action_failed', { error: 'Variant not allowed' });
        return;
      }
  // Persist choice and reset prompt counter
  cfg.chosenVariant = variant;
  cfg.dcStepCount = 0;
  global.tableConfigs.set(tableId, cfg);
      const mode = (variant === 'omaha' || variant === 'omaha-hi-lo') ? 'pot-limit' : 'no-limit';
      try { engine.setVariant(variant); } catch {}
      try { engine.setBettingMode(mode); } catch {}
      engine.startNewHand();
      const newState = engine.getState();
      io.to(`table_${tableId}`).emit('game_state_update', {
        gameState: newState,
        lastAction: { action: 'dealer_chose_variant', variant },
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('choose_variant failed:', e);
      socket.emit('action_failed', { error: e?.message || 'Failed to choose variant' });
    }
  });

  socket.on('disconnect', (reason) => {
    console.log('Client disconnected:', socket.id, reason);
  });
});

server.listen(PORT, () => {
  console.log(`Socket server listening on :${PORT} path=${SOCKET_PATH}`);
});
