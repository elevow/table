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
        // Rebuild a fresh engine to rotate dealer and clear state
        try { delete require.cache[require.resolve('../src/lib/poker/poker-engine')]; } catch {}
        const { PokerEngine } = require('../src/lib/poker/poker-engine');
        const sb = Number(curr.smallBlind) || 1;
        const bb = Number(curr.bigBlind) || 2;
        const variant = curr.variant || 'texas-holdem';
        const bettingMode = curr.bettingMode || (variant === 'omaha' || variant === 'omaha-hi-lo' ? 'pot-limit' : 'no-limit');
        const rebuilt = (Array.isArray(curr.players) ? curr.players : []).map(p => ({
          id: p.id, name: p.name || p.id, position: p.position, stack: p.stack,
          currentBet: 0, hasActed: false, isFolded: false, isAllIn: false, timeBank: p.timeBank ?? 30, holeCards: []
        }));
        const fresh = new PokerEngine(tableId, rebuilt, sb, bb, { variant, bettingMode });
        try { fresh.state.dealerPosition = curr.dealerPosition ?? 0; } catch {}
        fresh.startNewHand();
        global.activeGames.set(tableId, fresh);
        const newState = fresh.getState();
        io.to(`table_${tableId}`).emit('game_state_update', {
          gameState: newState,
          lastAction: { action: 'auto_next_hand' },
          timestamp: new Date().toISOString(),
        });
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

  socket.on('claim_seat', (data) => {
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
      seats[seatNumber] = { playerId, playerName, chips: Number(chips) || 20 };
      setRoomSeats(tableId, seats);
      io.to(`table_${tableId}`).emit('seat_claimed', { seatNumber, playerId, playerName, chips: Number(chips) || 20 });
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
      // Default betting mode: pot-limit for Omaha variants unless explicitly provided, else no-limit
      let bettingMode = data?.bettingMode
        || ((variant === 'omaha' || variant === 'omaha-hi-lo') ? 'pot-limit' : 'no-limit');

      const engine = new PokerEngine(tableId, players, smallBlind, bigBlind, { variant, bettingMode });
      engine.startNewHand();
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
      engine.startNewHand();
      const newState = engine.getState();
      io.to(`table_${tableId}`).emit('game_state_update', {
        gameState: newState,
        lastAction: { action: 'request_next_hand' },
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('request_next_hand failed:', e);
    }
  });

  socket.on('disconnect', (reason) => {
    console.log('Client disconnected:', socket.id, reason);
  });
});

server.listen(PORT, () => {
  console.log(`Socket server listening on :${PORT} path=${SOCKET_PATH}`);
});
