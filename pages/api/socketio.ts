import { NextApiRequest, NextApiResponse } from 'next';
import { Server as SocketServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { WebSocketManager } from '../../src/lib/websocket-manager';

// Extend the response type to include the socket server
interface NextApiResponseServerIO extends NextApiResponse {
  socket: any & {
    server: HttpServer & {
      io?: SocketServer;
    };
  };
}

// In-memory seat storage (in production, this would be in a database)
const gameSeats: Map<string, Record<number, { playerId: string; playerName: string; chips: number } | null>> = new Map();

// Initialize seat management handlers
function initializeSeatHandlers(res: NextApiResponseServerIO) {
  const io = res.socket.server.io;
  
  if (!io || io._seatHandlersAdded) return;
  
  console.log('Adding seat management handlers...');
  
  io.on('connection', (socket: any) => {
    console.log('Client connected for seat management:', socket.id);

    // Handle joining a table
    socket.on('join_table', (data: { tableId: string; playerId: string }) => {
      console.log('Player joining table:', data);
      const { tableId, playerId } = data;
      
      // Join the table room
      socket.join(`table_${tableId}`);
      
      // Store player info on socket
      socket.tableId = tableId;
      socket.playerId = playerId;
      
      console.log(`Player ${playerId} joined table ${tableId}`);
    });

    // Handle seat claim requests
    socket.on('claim_seat', (data: { tableId: string; seatNumber: number; playerId: string; playerName: string; chips: number }) => {
      console.log('Seat claim request:', data);
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

    // Handle game start requests
    socket.on('start_game', (data: { tableId: string; playerId: string; seatedPlayers: any[] }) => {
      console.log('Game start request:', data);
      const { tableId, playerId, seatedPlayers } = data;
      
      // Validate that the player is seated and there are enough players
      if (seatedPlayers.length < 2) {
        socket.emit('game_start_failed', { error: 'Not enough players to start game' });
        return;
      }
      
      try {
        // Import poker engine dynamically to avoid build issues
        const { PokerEngine } = require('../../src/lib/poker/poker-engine');
        const { Player } = require('../../src/types/poker');
        
        // Convert seated players to Player objects required by poker engine
        // Sort by seat number to ensure consistent position ordering
        const sortedSeatedPlayers = seatedPlayers.sort((a, b) => a.seatNumber - b.seatNumber);
        
        const players = sortedSeatedPlayers.map((seated, index) => ({
          id: seated.playerId,
          name: seated.playerName,
          position: index, // Always use 0-based indexing: 0, 1, 2, ...
          stack: seated.chips || 20, // Default $20 stack
          currentBet: 0,
          hasActed: false,
          isFolded: false,
          isAllIn: false,
          timeBank: 30, // 30 seconds to act
          holeCards: []
        }));
        
        // Create poker engine instance with standard blind structure
        const smallBlind = 1; // $1 small blind
        const bigBlind = 2;   // $2 big blind
        
        const pokerEngine = new PokerEngine(tableId, players, smallBlind, bigBlind, {
          variant: 'texas-holdem', // Default to Texas Hold'em
          bettingMode: 'no-limit'
        });
        
        // Start a new hand
        pokerEngine.startNewHand();
        
        // Get the current game state
        const gameState = pokerEngine.getState();
        
        // Store the poker engine instance (you might want to use a proper storage solution)
        if (!(global as any).activeGames) {
          (global as any).activeGames = new Map();
        }
        (global as any).activeGames.set(tableId, pokerEngine);
        
        // Get player name who started the game
        const playerInfo = seatedPlayers.find(p => p.playerId === playerId);
        const playerName = playerInfo?.playerName || 'Unknown Player';
        
        // Broadcast game start to all players in the table with initial game state
        io.to(`table_${tableId}`).emit('game_started', {
          startedBy: playerId,
          playerName: playerName,
          seatedPlayers: seatedPlayers,
          gameState: gameState,
          timestamp: new Date().toISOString()
        });
        
        console.log(`Texas Hold'em game started at table ${tableId} by ${playerName} (${playerId}) with ${seatedPlayers.length} players`);
        console.log('Initial game state:', {
          stage: gameState.stage,
          activePlayer: gameState.activePlayer,
          pot: gameState.pot,
          currentBet: gameState.currentBet,
          communityCards: gameState.communityCards.length
        });
        
      } catch (error) {
        console.error('Error starting poker game:', error);
        socket.emit('game_start_failed', { error: 'Failed to initialize poker game' });
      }
    });

    // Handle player actions (bet, call, raise, fold, check)
    socket.on('player_action', (data: { tableId: string; playerId: string; action: string; amount?: number }) => {
      console.log('Player action:', data);
      const { tableId, playerId, action, amount } = data;
      
      try {
        // Get the active poker game
        if (!(global as any).activeGames || !(global as any).activeGames.has(tableId)) {
          socket.emit('action_failed', { error: 'No active game found' });
          return;
        }
        
        const pokerEngine = (global as any).activeGames.get(tableId);
        
        // Create player action object
        const playerAction = {
          type: action as 'bet' | 'call' | 'raise' | 'fold' | 'check',
          playerId: playerId,
          tableId: tableId,
          amount: amount || 0,
          timestamp: Date.now()
        };
        
        // Process the action through the poker engine
        pokerEngine.handleAction(playerAction);
        
        // Get updated game state
        const gameState = pokerEngine.getState();
        
        // Broadcast updated game state to all players
        io.to(`table_${tableId}`).emit('game_state_update', {
          gameState: gameState,
          lastAction: {
            playerId: playerId,
            action: action,
            amount: amount
          },
          timestamp: new Date().toISOString()
        });
        
        console.log(`Player ${playerId} performed ${action}${amount ? ` for ${amount}` : ''} at table ${tableId}`);
        
      } catch (error: any) {
        console.error('Error processing player action:', error);
        socket.emit('action_failed', { 
          error: error?.message || 'Failed to process action',
          playerId: playerId,
          action: action
        });
      }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
      
      // Optional: Handle cleanup if player disconnects
      if (socket.tableId && socket.playerId) {
        console.log(`Player ${socket.playerId} disconnected from table ${socket.tableId}`);
      }
    });
  });
  
  // Mark handlers as added
  io._seatHandlersAdded = true;
  console.log('Seat management handlers added successfully');
}

export default function handler(req: NextApiRequest, res: NextApiResponseServerIO) {
  // Only initialize Socket.IO server once
  if (!res.socket.server.io) {
    console.log('Initializing Socket.IO server...');
    
    // Get the HTTP server from the Next.js response
    const httpServer = res.socket.server;
    
    // Initialize WebSocketManager (this will create the Socket.IO server)
    const wsManager = WebSocketManager.getInstance(httpServer, {
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 10000,
      pingInterval: 25000,
      transport: 'websocket'
    });

    // Store the Socket.IO server instance for other API routes
    res.socket.server.io = wsManager.getSocketServer();
    
    // Initialize seat management handlers
    initializeSeatHandlers(res);
    
    console.log('Socket.IO server initialized successfully');
  } else {
    console.log('Socket.IO server already running');
  }

  // Send success response
  res.status(200).json({ status: 'Socket.IO server running' });
}

// Disable body parsing for this endpoint
export const config = {
  api: {
    bodyParser: false,
  },
};
