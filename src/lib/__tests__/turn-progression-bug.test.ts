/**
 * Integration test for the turn progression bug fix.
 * 
 * This test reproduces the scenario where a player Calls or Bets,
 * but the next player who would normally act is folded or all-in,
 * causing the game to hang because no valid activePlayer is set.
 */

import { PokerEngine } from '../poker/poker-engine';
import { Player } from '../../types/poker';

describe('Turn Progression Bug Fix', () => {
  let engine: PokerEngine;
  let players: Player[];

  beforeEach(() => {
    // Set up a 3-player game
    players = [
      {
        id: 'player1',
        name: 'Player 1',
        position: 0,
        stack: 1000,
        currentBet: 0,
        hasActed: false,
        isFolded: false,
        isAllIn: false,
      },
      {
        id: 'player2',
        name: 'Player 2',
        position: 1,
        stack: 1000,
        currentBet: 0,
        hasActed: false,
        isFolded: false,
        isAllIn: false,
      },
      {
        id: 'player3',
        name: 'Player 3',
        position: 2,
        stack: 1000,
        currentBet: 0,
        hasActed: false,
        isFolded: false,
        isAllIn: false,
      },
    ];

    engine = new PokerEngine('test-table', players, 10, 20);
  });

  it('should correctly progress turn when next player post-flop has folded', () => {
    // Start a hand
    engine.startNewHand();
    const state1 = engine.getState();
    
    // Preflop actions - everyone calls
    engine.handleAction({ type: 'call', playerId: state1.activePlayer, tableId: 'test-table', timestamp: Date.now() });
    const state2 = engine.getState();
    engine.handleAction({ type: 'call', playerId: state2.activePlayer, tableId: 'test-table', timestamp: Date.now() });
    const state3 = engine.getState();
    engine.handleAction({ type: 'call', playerId: state3.activePlayer, tableId: 'test-table', timestamp: Date.now() });
    
    // Should now be at flop
    const flopState = engine.getState();
    expect(flopState.stage).toBe('flop');
    expect(flopState.communityCards).toHaveLength(3);
    
    // First player to act post-flop folds
    const firstToAct = flopState.activePlayer;
    engine.handleAction({ type: 'fold', playerId: firstToAct, tableId: 'test-table', timestamp: Date.now() });
    
    // Second player bets
    const afterFoldState = engine.getState();
    const secondToAct = afterFoldState.activePlayer;
    expect(secondToAct).not.toBe(firstToAct); // Should have moved to next player
    engine.handleAction({ type: 'bet', playerId: secondToAct, tableId: 'test-table', timestamp: Date.now(), amount: 50 });
    
    // Third player calls
    const afterBetState = engine.getState();
    const thirdToAct = afterBetState.activePlayer;
    expect(thirdToAct).not.toBe(secondToAct);
    expect(thirdToAct).not.toBe(firstToAct);
    engine.handleAction({ type: 'call', playerId: thirdToAct, tableId: 'test-table', timestamp: Date.now() });
    
    // Should progress to turn street
    const turnState = engine.getState();
    expect(turnState.stage).toBe('turn');
    expect(turnState.communityCards).toHaveLength(4);
    
    // CRITICAL: activePlayer should be set to a valid player (not the folded one)
    expect(turnState.activePlayer).toBeTruthy();
    expect(turnState.activePlayer).not.toBe(firstToAct); // Not the folded player
    
    // The active player should be able to act
    const turnPlayers = turnState.players.filter(p => !p.isFolded && !p.isAllIn);
    const activePlayerObj = turnState.players.find(p => p.id === turnState.activePlayer);
    expect(activePlayerObj).toBeDefined();
    expect(activePlayerObj!.isFolded).toBe(false);
    expect(activePlayerObj!.isAllIn).toBe(false);
  });

  it('should correctly progress turn when next player is all-in', () => {
    // Set up scenario where player 2 has only 20 chips (will go all-in calling the big blind)
    players[1].stack = 20;
    engine = new PokerEngine('test-table', players, 10, 20);
    
    // Start hand
    engine.startNewHand();
    const state1 = engine.getState();
    
    // Player 1 calls
    engine.handleAction({ type: 'call', playerId: state1.activePlayer, tableId: 'test-table', timestamp: Date.now() });
    
    // Player 2 calls (goes all-in with 20)
    const state2 = engine.getState();
    engine.handleAction({ type: 'call', playerId: state2.activePlayer, tableId: 'test-table', timestamp: Date.now() });
    
    // Player 3 (big blind) calls the remaining amount
    const state3 = engine.getState();
    engine.handleAction({ type: 'call', playerId: state3.activePlayer, tableId: 'test-table', timestamp: Date.now() });
    
    // Should be at flop now
    const flopState = engine.getState();
    expect(flopState.stage).toBe('flop');
    
    // Verify player 2 is all-in
    const player2 = flopState.players.find(p => p.id === 'player2');
    expect(player2!.isAllIn).toBe(true);
    
    // CRITICAL: activePlayer should NOT be player 2 (who is all-in)
    expect(flopState.activePlayer).not.toBe('player2');
    
    // Active player should be either player 1 or player 3 (not all-in)
    expect(['player1', 'player3']).toContain(flopState.activePlayer);
    
    // The active player should be able to act
    const activePlayerObj = flopState.players.find(p => p.id === flopState.activePlayer);
    expect(activePlayerObj).toBeDefined();
    expect(activePlayerObj!.isFolded).toBe(false);
    expect(activePlayerObj!.isAllIn).toBe(false);
  });

  it('should handle multiple inactive players when starting new betting round', () => {
    // Set up a 4-player game
    const fourPlayers: Player[] = [
      {
        id: 'p1',
        name: 'Player 1',
        position: 0,
        stack: 1000,
        currentBet: 0,
        hasActed: false,
        isFolded: false,
        isAllIn: false,
      },
      {
        id: 'p2',
        name: 'Player 2',
        position: 1,
        stack: 1000,
        currentBet: 0,
        hasActed: false,
        isFolded: false,
        isAllIn: false,
      },
      {
        id: 'p3',
        name: 'Player 3',
        position: 2,
        stack: 50, // Will go all-in
        currentBet: 0,
        hasActed: false,
        isFolded: false,
        isAllIn: false,
      },
      {
        id: 'p4',
        name: 'Player 4',
        position: 3,
        stack: 1000,
        currentBet: 0,
        hasActed: false,
        isFolded: false,
        isAllIn: false,
      },
    ];

    engine = new PokerEngine('test-table', fourPlayers, 10, 20);
    engine.startNewHand();
    
    // Preflop: p1 folds
    const state1 = engine.getState();
    engine.handleAction({ type: 'fold', playerId: state1.activePlayer, tableId: 'test-table', timestamp: Date.now() });
    
    // p2 raises to 100
    const state2 = engine.getState();
    engine.handleAction({ type: 'raise', playerId: state2.activePlayer, tableId: 'test-table', timestamp: Date.now(), amount: 100 });
    
    // p3 calls (goes all-in with 50)
    const state3 = engine.getState();
    engine.handleAction({ type: 'call', playerId: state3.activePlayer, tableId: 'test-table', timestamp: Date.now() });
    
    // p4 calls 100
    const state4 = engine.getState();
    engine.handleAction({ type: 'call', playerId: state4.activePlayer, tableId: 'test-table', timestamp: Date.now() });
    
    // Should be at flop now with p1 folded and p3 all-in
    const flopState = engine.getState();
    expect(flopState.stage).toBe('flop');
    
    // CRITICAL: activePlayer should skip p1 (folded) and p3 (all-in)
    expect(flopState.activePlayer).not.toBe('p1');
    expect(flopState.activePlayer).not.toBe('p3');
    
    // Should be either p2 or p4
    expect(['p2', 'p4']).toContain(flopState.activePlayer);
    
    // Active player should be able to act
    const activePlayerObj = flopState.players.find(p => p.id === flopState.activePlayer);
    expect(activePlayerObj).toBeDefined();
    expect(activePlayerObj!.isFolded).toBe(false);
    expect(activePlayerObj!.isAllIn).toBe(false);
    expect(activePlayerObj!.stack).toBeGreaterThan(0);
  });
});
