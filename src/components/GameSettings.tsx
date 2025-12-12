/**
 * This is a mock component for demonstration purposes.
 * In a real implementation, you would have a fully functional game settings component.
 */
import { useEffect, useState, useRef, memo } from 'react';

export interface GameSettings {
  soundEnabled: boolean;
  chatEnabled: boolean;
  notificationsEnabled: boolean;
  autoFoldEnabled: boolean;
  rabbitHuntEnabled: boolean;
  timeBank: number;
  highContrastCards: boolean;
  showPotOdds: boolean;
}

interface GameSettingsProps {
  gameId: string;
  onSettingsChange?: (settings: GameSettings) => void;
}

function GameSettings({ gameId, onSettingsChange }: GameSettingsProps) {
  const [settings, setSettings] = useState<GameSettings>({
    soundEnabled: true,
    chatEnabled: true,
    notificationsEnabled: true,
    autoFoldEnabled: false,
    rabbitHuntEnabled: false,
    timeBank: 30,
    highContrastCards: false,
    showPotOdds: true,
  });

  // Use a ref to store the callback to avoid re-triggering effects
  const onSettingsChangeRef = useRef(onSettingsChange);
  useEffect(() => {
    onSettingsChangeRef.current = onSettingsChange;
  }, [onSettingsChange]);
  
  useEffect(() => {
    // Log when the component is loaded to demonstrate code splitting
    // console.log('GameSettings component loaded for game:', gameId);
    
    // Load saved settings for this game if present
    try {
      const raw = localStorage.getItem(`game_settings_${gameId}`);
      if (raw) {
        const saved = JSON.parse(raw);
        setSettings(prev => {
          const merged = { ...prev, ...saved };
          // Notify parent of initial load with merged settings
          if (typeof onSettingsChangeRef.current === 'function') {
            onSettingsChangeRef.current(merged);
          }
          return merged;
        });
      } else {
        // No saved settings, notify parent with current default settings
        setSettings(prev => {
          if (typeof onSettingsChangeRef.current === 'function') {
            onSettingsChangeRef.current(prev);
          }
          return prev;
        });
      }
    } catch {}
  }, [gameId]);

  // Persist settings when they change
  useEffect(() => {
    try {
      localStorage.setItem(`game_settings_${gameId}`, JSON.stringify(settings));
    } catch {}
    // Notify parent on any change
    if (typeof onSettingsChangeRef.current === 'function') {
      onSettingsChangeRef.current(settings);
    }
  }, [gameId, settings]);
  
  const handleSettingChange = (setting: string, value: boolean | number) => {
    setSettings(prev => ({ ...prev, [setting]: value }));
  };
  
  return (
    <div className="game-settings">
      <h2>Game Settings</h2>
      
      <div className="settings-group">
        <h3>Audio Settings</h3>
        <div className="setting-item">
          <label>
            <input 
              type="checkbox"
              checked={settings.soundEnabled}
              onChange={(e) => handleSettingChange('soundEnabled', e.target.checked)}
            />
            Enable Sound Effects
          </label>
        </div>
      </div>
      
      <div className="settings-group">
        <h3>Chat Settings</h3>
        <div className="setting-item">
          <label>
            <input 
              type="checkbox"
              checked={settings.chatEnabled}
              onChange={(e) => handleSettingChange('chatEnabled', e.target.checked)}
            />
            Enable Chat
          </label>
        </div>
      </div>
      
      <div className="settings-group">
        <h3>Gameplay Settings</h3>
        <div className="setting-item">
          <label>
            <input 
              type="checkbox"
              checked={settings.autoFoldEnabled}
              onChange={(e) => handleSettingChange('autoFoldEnabled', e.target.checked)}
            />
            Auto-fold when inactive
          </label>
        </div>
        <div className="setting-item">
          <label>
            <input
              type="checkbox"
              checked={settings.rabbitHuntEnabled}
              onChange={(e) => handleSettingChange('rabbitHuntEnabled', e.target.checked)}
            />
            Rabbit Hunt (preview)
          </label>
        </div>
        <div className="setting-item">
          <label>
            <input
              type="checkbox"
              checked={settings.highContrastCards}
              onChange={(e) => handleSettingChange('highContrastCards', e.target.checked)}
            />
            High Contrast Cards
          </label>
          <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
            When enabled: Hearts = Red, Diamonds = Yellow, Spades = Black, Clubs = Blue.
          </div>
        </div>
        <div className="setting-item">
          <label>
            <input
              type="checkbox"
              checked={settings.showPotOdds}
              onChange={(e) => handleSettingChange('showPotOdds', e.target.checked)}
            />
            Show Pot Odds
          </label>
          <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
            Display the ratio between the pot size and the bet you are facing.
          </div>
        </div>
        <div className="setting-item">
          <label>
            Time bank (seconds):
            <input 
              type="range"
              min="10"
              max="60"
              value={settings.timeBank}
              onChange={(e) => handleSettingChange('timeBank', parseInt(e.target.value))}
            />
            {settings.timeBank}
          </label>
        </div>
      </div>
      
      <button className="save-settings">Save Settings</button>
    </div>
  );
}

// Use memo to prevent unnecessary re-renders
export default memo(GameSettings);
