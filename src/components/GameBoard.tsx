/**
 * This is a mock component for demonstration purposes.
 * In a real implementation, you would have a fully functional game board component.
 */
import { useEffect, memo } from 'react';
import VariantControls from './VariantControls';
import VariantHelpPanel from './VariantHelpPanel';
import type { TableState } from '../types/poker';

interface GameBoardProps {
  gameId: string;
  headerSlot?: React.ReactNode;
  // Optional table state preview to render variant UI; remains backward compatible
  tableState?: Pick<TableState, 'variant' | 'stage' | 'lowHandQualifier' | 'hiLoDeclarations'>;
}

function GameBoard({ gameId, headerSlot, tableState }: GameBoardProps) {
  useEffect(() => {
    // Log when the component is loaded to demonstrate code splitting
    // console.log('GameBoard component loaded for game:', gameId);
    
    // In a real implementation, this would load game resources, connect to game server, etc.
  }, [gameId]);
  
  return (
    <div className="game-board text-gray-900 dark:text-gray-100">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Game Board</h1>
        {headerSlot}
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400">Game ID: {gameId}</p>
      {/* Game board content would go here */}
      {tableState?.variant && tableState.stage && (
        <div className="mt-4">
          <VariantControls
            variant={tableState.variant}
            stage={tableState.stage}
            declarationsEnabled={!!tableState.hiLoDeclarations}
          />
          <div className="mt-2">
            <VariantHelpPanel variant={tableState.variant} />
          </div>
        </div>
      )}
    </div>
  );
}

// Use memo to prevent unnecessary re-renders
export default memo(GameBoard);
