import { NextApiRequest, NextApiResponse } from 'next';
import { WebSocketManager } from '../../src/lib/websocket-manager';
import { Server as HttpServer } from 'http';
import { fetchRoomRebuyLimit } from '../../src/lib/shared/rebuy-limit';
import { getPlayerRebuyInfo, recordBuyin } from '../../src/lib/shared/rebuy-tracker';

// Extend the response type to include the socket server
interface NextApiResponseServerIO extends NextApiResponse {
  socket: any & {
    server: HttpServer & {
      io?: any;
    };
  };
}

// In-memory seat storage (in production, this would be in a database)
const gameSeats: Map<string, Record<number, { playerId: string; playerName: string; chips: number } | null>> = new Map();

export default function handler(req: NextApiRequest, res: NextApiResponseServerIO) {
  // Ensure WebSocket server is initialized
  if (!res.socket.server.io) {
    return res.status(500).json({ error: 'WebSocket server not initialized' });
  }

  const io = res.socket.server.io;

  // Add seat management event handlers if not already added
  if (!io._seatHandlersAdded) {
    console.log('Adding seat management handlers...');
    
    io.on('connection', (socket: any) => {
      console.log('Client connected for seat management:', socket.id);

      // Handle joining a table
      socket.on('join_table', (data: { tableId: string; playerId: string }) => {
        // console.log('Player joining table:', data);
        const { tableId, playerId } = data;
        
        // Join the table room
        socket.join(`table_${tableId}`);
        
        // Store player info on socket
        socket.tableId = tableId;
        socket.playerId = playerId;
        
        // console.log(`Player ${playerId} joined table ${tableId}`);
      });

      // Handle seat claim requests
      socket.on('claim_seat', async (data: { tableId: string; seatNumber: number; playerId: string; playerName: string; chips: number }) => {
        console.log('Seat claim request:', data.tableId, data.seatNumber, data.playerId);
        const { tableId, seatNumber, playerId, playerName, chips } = data;
        
        // Initialize game seats if not exists
        if (!gameSeats.has(tableId)) {
          gameSeats.set(tableId, {
            1: null, 2: null, 3: null, 4: null, 5: null, 6: null
          });
        }
        
        const seats = gameSeats.get(tableId)!;
        
        // Check if seat is available
        if (seats[seatNumber] !== null) {
          socket.emit('seat_claim_failed', { 
            error: 'Seat already occupied', 
            seatNumber 
          });
          return;
        }
        
        // Check if player already has a seat
        const playerCurrentSeat = Object.entries(seats).find(([_, assignment]) => 
          assignment?.playerId === playerId
        );
        
        if (playerCurrentSeat) {
          socket.emit('seat_claim_failed', { 
            error: 'Player already has a seat', 
            seatNumber: parseInt(playerCurrentSeat[0])
          });
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
          socket.emit('seat_claim_failed', {
            error: message,
            seatNumber,
            rebuyLimit,
            rebuysUsed,
          });
          return;
        }

        // Claim the seat
        seats[seatNumber] = { playerId, playerName, chips };
        gameSeats.set(tableId, seats);
        
        // Broadcast to all players in the table
        io.to(`table_${tableId}`).emit('seat_claimed', {
          seatNumber,
          playerId,
          playerName,
          chips
        });

        recordBuyin(tableId, playerId);
        
        console.log(`Seat ${seatNumber} claimed by ${playerName} (${playerId}) at table ${tableId}`);
      });

      // Handle stand up requests
      socket.on('stand_up', (data: { tableId: string; seatNumber: number; playerId: string }) => {
        console.log('Stand up request:', data);
        const { tableId, seatNumber, playerId } = data;
        
        const seats = gameSeats.get(tableId);
        if (!seats) {
          socket.emit('stand_up_failed', { error: 'Table not found' });
          return;
        }
        
        // Verify the player owns this seat
        if (seats[seatNumber]?.playerId !== playerId) {
          socket.emit('stand_up_failed', { error: 'Not your seat' });
          return;
        }
        
        // Vacate the seat
        seats[seatNumber] = null;
        gameSeats.set(tableId, seats);
        
        // Broadcast to all players in the table
        io.to(`table_${tableId}`).emit('seat_vacated', {
          seatNumber,
          playerId
        });
        
        console.log(`Seat ${seatNumber} vacated by ${playerId} at table ${tableId}`);
      });

      // Handle seat state requests
      socket.on('get_seat_state', (data: { tableId: string }) => {
        console.log('Seat state request:', data);
        const { tableId } = data;
        
        // Initialize if not exists
        if (!gameSeats.has(tableId)) {
          gameSeats.set(tableId, {
            1: null, 2: null, 3: null, 4: null, 5: null, 6: null
          });
        }
        
        const seats = gameSeats.get(tableId)!;
        
        // Send current seat state to requesting client
        socket.emit('seat_state', { seats });
        
        console.log(`Sent seat state for table ${tableId}:`, seats);
      });

      // Handle disconnect
      socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        
        // Optional: Handle cleanup if player disconnects
        // You might want to keep their seat reserved for a short time
        if (socket.tableId && socket.playerId) {
          console.log(`Player ${socket.playerId} disconnected from table ${socket.tableId}`);
          // Could implement automatic stand up after timeout here
        }
      });
    });
    
    // Mark handlers as added
    io._seatHandlersAdded = true;
    console.log('Seat management handlers added successfully');
  }

  res.status(200).json({ status: 'Seat management handlers initialized' });
}

export const config = {
  api: {
    bodyParser: false,
  },
};