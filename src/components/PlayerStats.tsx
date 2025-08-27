/**
 * This is a mock component for demonstration purposes.
 * In a real implementation, you would have a fully functional player stats component.
 */
import { useEffect, memo } from 'react';

interface PlayerStatsProps {
  gameId: string;
}

function PlayerStats({ gameId }: PlayerStatsProps) {
  useEffect(() => {
    // Log when the component is loaded to demonstrate code splitting
    // console.log('PlayerStats component loaded for game:', gameId);
    
    // In a real implementation, this would fetch player statistics
  }, [gameId]);
  
  return (
    <div className="player-stats">
      <h2>Player Statistics</h2>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-title">Win Rate</div>
          <div className="stat-value">64%</div>
        </div>
        <div className="stat-card">
          <div className="stat-title">Hands Played</div>
          <div className="stat-value">248</div>
        </div>
        <div className="stat-card">
          <div className="stat-title">Avg. Pot Size</div>
          <div className="stat-value">$12.40</div>
        </div>
        <div className="stat-card">
          <div className="stat-title">Biggest Win</div>
          <div className="stat-value">$325.00</div>
        </div>
      </div>
    </div>
  );
}

// Use memo to prevent unnecessary re-renders
export default memo(PlayerStats);
