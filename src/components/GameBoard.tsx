/**
 * This is a mock component for demonstration purposes.
 * In a real implementation, you would have a fully functional game board component.
 */
import { useEffect, memo } from 'react';

interface GameBoardProps {
  gameId: string;
}

function GameBoard({ gameId }: GameBoardProps) {
  useEffect(() => {
    // Log when the component is loaded to demonstrate code splitting
    console.log('GameBoard component loaded for game:', gameId);
    
    // In a real implementation, this would load game resources, connect to game server, etc.
  }, [gameId]);
  
  return (
    <div className="game-board">
      <h1>Game Board</h1>
      <p>Game ID: {gameId}</p>
      {/* Game board content would go here */}
    </div>
  );
}

// Use memo to prevent unnecessary re-renders
export default memo(GameBoard);
