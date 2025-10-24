// Minimal standalone Socket.IO server for seating events.
// Deploy this to a persistent host (Railway/Render/Fly/VM) and point the
// frontend via NEXT_PUBLIC_SOCKET_IO_URL (and optionally NEXT_PUBLIC_SOCKET_IO_PATH).

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

  socket.on('disconnect', (reason) => {
    console.log('Client disconnected:', socket.id, reason);
  });
});

server.listen(PORT, () => {
  console.log(`Socket server listening on :${PORT} path=${SOCKET_PATH}`);
});
