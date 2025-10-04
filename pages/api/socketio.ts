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

// Import shared game seats management
import * as GameSeats from '../../src/lib/shared/game-seats';

// Initialize seat management handlers
function initializeSeatHandlers(res: NextApiResponseServerIO) {
  const io = res.socket.server.io;
  if (!io) return;

  // Support hot-reload: version the handlers and rebind when changed
  const HANDLERS_VERSION = 2; // bump to force reinit after code changes
  if (io._handlersVersion !== HANDLERS_VERSION) {
    if (io._seatHandlersAdded) {
      try {
        console.log(`Rebinding Socket.IO handlers (old version=${io._handlersVersion}, new=${HANDLERS_VERSION})`);
        io.removeAllListeners('connection');
      } catch (e) {
        console.warn('Failed to remove previous connection listeners:', e);
      }
      io._seatHandlersAdded = false;
    }
    io._handlersVersion = HANDLERS_VERSION;
  } else if (io._seatHandlersAdded) {
    // Already initialized with current version
    return;
  }
  
  console.log('Adding seat management handlers...');

  // Auto next-hand scheduler (per table)
  const NEXT_HAND_DELAY_MS = 5000;
  if (!(global as any).nextHandTimers) {
    (global as any).nextHandTimers = new Map<string, NodeJS.Timeout>();
  }
  const nextHandTimers: Map<string, NodeJS.Timeout> = (global as any).nextHandTimers;

  const scheduleNextHand = (tableId: string) => {
    try {
      // Ensure a game exists and we're not already scheduled
      if (!(global as any).activeGames || !(global as any).activeGames.has(tableId)) {
        console.log(`[auto] Not scheduling: no active game for table ${tableId}`);
        return;
      }
      if (nextHandTimers.has(tableId)) {
        console.log(`[auto] Not scheduling: timer already exists for table ${tableId}`);
        return;
      }

      const engine = (global as any).activeGames.get(tableId);
      const state = engine?.getState?.() || {};
      // Only schedule from showdown state
      if (state.stage !== 'showdown') {
        console.log(`[auto] Not scheduling: stage is ${state.stage}, require showdown (table ${tableId})`);
        return;
      }
      const schedulePlayers = Array.isArray(state.players) ? state.players.length : 0;
      console.log(`[auto] Scheduling next hand in ${NEXT_HAND_DELAY_MS}ms (table ${tableId}); players=${schedulePlayers}`);

      const timer = setTimeout(() => {
        try {
          if (!(global as any).activeGames || !(global as any).activeGames.has(tableId)) return;
          const engineNow = (global as any).activeGames.get(tableId);
          const curr = engineNow?.getState?.() || {};
          // If a new hand already started, skip
          if (curr.stage !== 'showdown') {
            console.log(`[auto] Timer fired but stage is ${curr.stage}; skipping start (table ${tableId})`);
            return;
          }
          const players = Array.isArray(curr.players) ? curr.players : [];
          // Require at least two players to continue
          if (players.length < 2) {
            console.log(`[auto] Timer fired but not enough players (${players.length}) to start next hand (table ${tableId})`);
            return;
          }

          // Start next hand (rotates dealer -> blinds)
          console.log(`[auto] Starting next hand for table ${tableId}`);
          engineNow.startNewHand();
          const newState = engineNow.getState();
          io.to(`table_${tableId}`).emit('game_state_update', {
            gameState: newState,
            lastAction: { action: 'auto_next_hand' },
            timestamp: new Date().toISOString(),
          });
          console.log(`[auto] Emitted game_state_update auto_next_hand (stage=${newState?.stage}, pot=${newState?.pot}) for table ${tableId}`);
        } catch (e) {
          console.error('Auto next hand failed:', e);
        } finally {
          nextHandTimers.delete(tableId);
        }
      }, NEXT_HAND_DELAY_MS);

      nextHandTimers.set(tableId, timer);
    } catch (err) {
      console.error('scheduleNextHand error:', err);
    }
  };
  
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
      
      // Initialize and get game seats for this table
      const seats = GameSeats.initializeRoomSeats(tableId);
      
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
      GameSeats.setRoomSeats(tableId, seats);
      
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
      
      const seats = GameSeats.getRoomSeats(tableId);
      if (!seats || Object.keys(seats).length === 0) {
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
      GameSeats.setRoomSeats(tableId, seats);
      
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
      
      // Initialize if not exists and get seats
      const seats = GameSeats.initializeRoomSeats(tableId);
      
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
          position: index + 1, // Use 1-based indexing: 1, 2, 3, ... (position 1 = small blind, position 2 = big blind)
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
        // Defensive: if action caused everyone else to fold, end hand immediately
        if (typeof pokerEngine.ensureWinByFoldIfSingle === 'function') {
          pokerEngine.ensureWinByFoldIfSingle();
        }
        // Get updated game state
        let gameState = pokerEngine.getState();
        // Extra safety: if we still have only one active player but stage hasn't advanced, finalize now
        const activeCount = (gameState.players || []).filter((p: any) => !(p.isFolded || (p as any).folded)).length;
        if (activeCount === 1 && gameState.stage !== 'showdown') {
          console.log(`[safety] Forcing win-by-fold settlement (stage=${gameState.stage}, pot=${gameState.pot}, currentBet=${gameState.currentBet})`);
          if (typeof pokerEngine.ensureWinByFoldIfSingle === 'function') {
            pokerEngine.ensureWinByFoldIfSingle();
            gameState = pokerEngine.getState();
            console.log(`[safety] Post-settlement (stage=${gameState.stage}, pot=${gameState.pot}, currentBet=${gameState.currentBet})`);
          }
        }
        
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

        // If hand is over, schedule next hand
        if (gameState?.stage === 'showdown') {
          scheduleNextHand(tableId);
        }
        
      } catch (error: any) {
        console.error('Error processing player action:', error);
        socket.emit('action_failed', { 
          error: error?.message || 'Failed to process action',
          playerId: playerId,
          action: action
        });
      }
    });

    // Allow clients to explicitly request settlement when only one player remains (defensive fallback)
    socket.on('force_settlement', (data: { tableId: string }) => {
      try {
        const { tableId } = data || ({} as any);
        if (!tableId) return;
        if (!(global as any).activeGames || !(global as any).activeGames.has(tableId)) {
          return;
        }
        const pokerEngine = (global as any).activeGames.get(tableId);
        if (typeof pokerEngine.ensureWinByFoldIfSingle === 'function') {
          const before = pokerEngine.getState();
          const activeCount = (before.players || []).filter((p: any) => !(p.isFolded || (p as any).folded)).length;
          if (activeCount === 1 && before.stage !== 'showdown') {
            console.log(`[client] force_settlement requested; applying (stage=${before.stage}, pot=${before.pot})`);
            pokerEngine.ensureWinByFoldIfSingle();
            const after = pokerEngine.getState();
            io.to(`table_${tableId}`).emit('game_state_update', {
              gameState: after,
              lastAction: { action: 'force_settlement' },
              timestamp: new Date().toISOString()
            });
            // If hand is over, schedule next hand
            if (after?.stage === 'showdown') {
              scheduleNextHand(tableId);
            }
          }
        }
      } catch (err) {
        console.error('force_settlement failed:', err);
      }
    });

    // Client fallback: request starting the next hand after a delay on their side
    socket.on('request_next_hand', (data: { tableId: string }) => {
      try {
        const { tableId } = data || ({} as any);
        if (!tableId) return;
        if (!(global as any).activeGames || !(global as any).activeGames.has(tableId)) return;
        const engine = (global as any).activeGames.get(tableId);
        const state = engine?.getState?.() || {};
        console.log(`[auto] request_next_hand received (stage=${state?.stage}, players=${Array.isArray(state?.players) ? state.players.length : 0}) for table ${tableId}`);
        if (state.stage !== 'showdown') {
          console.log(`[auto] request_next_hand ignored: stage=${state.stage} (table ${tableId})`);
          return;
        }
        const players = Array.isArray(state.players) ? state.players : [];
        if (players.length < 2) {
          console.log(`[auto] request_next_hand ignored: not enough players (${players.length}) (table ${tableId})`);
          return;
        }
        console.log(`[auto] request_next_hand accepted: starting next hand now (table ${tableId})`);
        engine.startNewHand();
        const newState = engine.getState();
        io.to(`table_${tableId}`).emit('game_state_update', {
          gameState: newState,
          lastAction: { action: 'request_next_hand' },
          timestamp: new Date().toISOString(),
        });
        console.log(`[auto] Emitted game_state_update request_next_hand (stage=${newState?.stage}, pot=${newState?.pot}) for table ${tableId}`);
      } catch (err) {
        console.error('request_next_hand failed:', err);
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
    // Re-run handler initialization to support hot-reload / new event bindings
    try {
      initializeSeatHandlers(res);
    } catch (e) {
      console.warn('Re-initialization of seat handlers failed:', e);
    }
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
