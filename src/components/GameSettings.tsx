/**
 * This is a mock component for demonstration purposes.
 * In a real implementation, you would have a fully functional game settings component.
 */
import { useEffect, useState, useRef, memo, useCallback } from 'react';

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
  isAdmin?: boolean;
}

function GameSettings({ gameId, onSettingsChange, isAdmin = false }: GameSettingsProps) {
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
  
  // Admin-only settings (stored in room configuration on server)
  const [timeBetweenRounds, setTimeBetweenRounds] = useState<number>(5);
  const [savingTimeBetweenRounds, setSavingTimeBetweenRounds] = useState(false);
  const [timeBetweenRoundsError, setTimeBetweenRoundsError] = useState<string | null>(null);
  const [timeBetweenRoundsSuccess, setTimeBetweenRoundsSuccess] = useState(false);

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
        // We intentionally use the initial settings value here, not a dependency
        if (typeof onSettingsChangeRef.current === 'function') {
          onSettingsChangeRef.current(settings);
        }
      }
    } catch {}
    // settings is intentionally not in dependencies - we want the initial value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  // Fetch admin-only settings (timeBetweenRounds) from server when admin
  useEffect(() => {
    if (!isAdmin || !gameId) return;
    
    const fetchRoomConfig = async () => {
      try {
        const response = await fetch(`/api/games/rooms/${gameId}`);
        if (response.ok) {
          const data = await response.json();
          const configuredTime = data?.configuration?.timeBetweenRounds;
          if (typeof configuredTime === 'number' && configuredTime >= 1 && configuredTime <= 60) {
            setTimeBetweenRounds(configuredTime);
          }
        }
      } catch (err) {
        console.warn('Failed to fetch room configuration:', err);
      }
    };
    
    fetchRoomConfig();
  }, [gameId, isAdmin]);

  // Handler to save timeBetweenRounds to server (admin only)
  const handleSaveTimeBetweenRounds = useCallback(async () => {
    if (!isAdmin || !gameId) return;
    
    setSavingTimeBetweenRounds(true);
    setTimeBetweenRoundsError(null);
    setTimeBetweenRoundsSuccess(false);
    
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
      const response = await fetch('/api/games/rooms/update-config', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          roomId: gameId,
          timeBetweenRounds,
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to update setting');
      }
      
      setTimeBetweenRoundsSuccess(true);
      setTimeout(() => setTimeBetweenRoundsSuccess(false), 3000);
    } catch (err: any) {
      setTimeBetweenRoundsError(err?.message || 'Failed to save setting');
    } finally {
      setSavingTimeBetweenRounds(false);
    }
  }, [isAdmin, gameId, timeBetweenRounds]);

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
      
      {/* Admin-only settings section */}
      {isAdmin && (
        <div className="settings-group mt-6 border-t border-gray-300 dark:border-gray-600 pt-4">
          <h3 className="text-amber-600 dark:text-amber-400 font-semibold">Admin Settings</h3>
          <div className="setting-item mt-3">
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Time between rounds (seconds):</span>
              <div className="flex items-center gap-3 mt-2">
                <input 
                  type="range"
                  min="1"
                  max="60"
                  value={timeBetweenRounds}
                  onChange={(e) => setTimeBetweenRounds(parseInt(e.target.value))}
                  className="flex-1"
                />
                <span className="w-8 text-center font-mono">{timeBetweenRounds}</span>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Controls the delay before the next hand starts after a round ends (1-60 seconds).
              </div>
            </label>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={handleSaveTimeBetweenRounds}
                disabled={savingTimeBetweenRounds}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white text-sm font-medium rounded transition-colors"
              >
                {savingTimeBetweenRounds ? 'Saving...' : 'Save Admin Setting'}
              </button>
              {timeBetweenRoundsSuccess && (
                <span className="text-sm text-green-600 dark:text-green-400">✓ Saved successfully</span>
              )}
              {timeBetweenRoundsError && (
                <span className="text-sm text-red-600 dark:text-red-400">{timeBetweenRoundsError}</span>
              )}
            </div>
          </div>
        </div>
      )}
      
      <button className="save-settings">Save Settings</button>
    </div>
  );
}

// Use memo to prevent unnecessary re-renders
export default memo(GameSettings);
