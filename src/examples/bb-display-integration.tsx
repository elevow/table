/**
 * Example component showing how to use the Big Blinds display setting
 * This demonstrates the integration of showStackInBB setting with player stack display
 */
import React from 'react';
import { formatChips } from '../utils/chip-display';
import type { GameSettings } from '../components/GameSettings';
import type { Player } from '../types/poker';

interface PlayerStackDisplayProps {
  player: Player;
  bigBlind: number;
  settings: GameSettings;
}

/**
 * Component to display a player's stack with BB formatting option
 */
export function PlayerStackDisplay({ player, bigBlind, settings }: PlayerStackDisplayProps) {
  const displayStack = formatChips(player.stack, bigBlind, settings.showStackInBB);
  
  return (
    <div className="player-stack-display">
      <span className="player-name">{player.name}</span>
      <span className="player-stack">{displayStack}</span>
    </div>
  );
}

interface GameTableDisplayProps {
  players: Player[];
  bigBlind: number;
  settings: GameSettings;
}

/**
 * Example component showing how to display multiple players with BB formatting
 */
export function GameTableDisplay({ players, bigBlind, settings }: GameTableDisplayProps) {
  return (
    <div className="game-table">
      {players.map((player) => (
        <PlayerStackDisplay
          key={player.id}
          player={player}
          bigBlind={bigBlind}
          settings={settings}
        />
      ))}
    </div>
  );
}
