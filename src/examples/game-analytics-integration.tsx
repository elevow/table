/**
 * Game Analytics Integration Example - US-042 Implementation
 * 
 * Example demonstrating how to integrate the game analytics system
 * with existing poker table components and game logic.
 * 
 * @author GitHub Copilot
 * @version 1.0.0
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  getGameAnalytics,
  trackRoomCreated,
  trackPlayerAction,
  trackFeatureUsage,
  generateAnalyticsReport,
  type DeviceInfo,
  type AnalyticsFilter
} from '../lib/game-analytics';
import { GameAnalyticsDashboard } from '../components/GameAnalyticsDashboard';

// Example: Poker Table Component with Analytics Integration
interface PokerTableWithAnalyticsProps {
  tableId: string;
  gameType: 'texas-holdem' | 'omaha' | 'seven-card-stud';
  stakes: string;
  maxPlayers: number;
}

export const PokerTableWithAnalytics: React.FC<PokerTableWithAnalyticsProps> = ({
  tableId,
  gameType,
  stakes,
  maxPlayers
}) => {
  const [players, setPlayers] = useState<{ id: string; name: string; stack: number }[]>([]);
  const [gameState, setGameState] = useState<'waiting' | 'playing' | 'ended'>('waiting');
  const [currentHand, setCurrentHand] = useState<number>(0);
  const [pot, setPot] = useState<number>(0);
  const [actionTimer, setActionTimer] = useState<number | null>(null);
  const [lastActionTime, setLastActionTime] = useState<number>(0);

  const analytics = getGameAnalytics();

  // Initialize analytics tracking when table is created
  useEffect(() => {
    trackRoomCreated(tableId, gameType, stakes);
    
    // Set up performance monitoring
    const performanceObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'measure' && entry.name.startsWith('table-')) {
          analytics.trackFeaturePerformance('table-operations', 'loadTimes', entry.duration);
        }
      }
    });
    
    try {
      performanceObserver.observe({ entryTypes: ['measure'] });
    } catch (error) {
      console.warn('Performance Observer not supported:', error);
    }

    return () => {
      performanceObserver.disconnect();
    };
  }, [tableId, gameType, stakes, analytics]);

  // Track when game ends
  useEffect(() => {
    return () => {
      if (gameState === 'ended') {
        analytics.trackRoomEnded(tableId);
      }
    };
  }, [gameState, tableId, analytics]);

  // Detect device information for analytics
  const getDeviceInfo = useCallback((): DeviceInfo => {
    const userAgent = navigator.userAgent;
    const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
    const isTablet = /iPad|Android(?=.*Mobile)/i.test(userAgent);
    
    return {
      type: isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop',
      os: getOperatingSystem(),
      browser: getBrowserName(),
      screenResolution: `${screen.width}x${screen.height}`,
      connectionType: getConnectionType()
    };
  }, []);

  const getOperatingSystem = (): string => {
    const userAgent = navigator.userAgent;
    if (userAgent.includes('Windows')) return 'Windows';
    if (userAgent.includes('Mac')) return 'macOS';
    if (userAgent.includes('Linux')) return 'Linux';
    if (userAgent.includes('Android')) return 'Android';
    if (userAgent.includes('iOS')) return 'iOS';
    return 'Unknown';
  };

  const getBrowserName = (): string => {
    const userAgent = navigator.userAgent;
    if (userAgent.includes('Chrome')) return 'Chrome';
    if (userAgent.includes('Firefox')) return 'Firefox';
    if (userAgent.includes('Safari')) return 'Safari';
    if (userAgent.includes('Edge')) return 'Edge';
    return 'Unknown';
  };

  const getConnectionType = (): string => {
    // @ts-ignore - Navigator.connection is experimental
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return connection ? connection.effectiveType || 'unknown' : 'unknown';
  };

  // Player management with analytics
  const addPlayer = useCallback((playerId: string, playerName: string) => {
    const deviceInfo = getDeviceInfo();
    
    setPlayers(prev => {
      if (prev.length >= maxPlayers) return prev;
      
      const newPlayer = { id: playerId, name: playerName, stack: 1000 };
      const updatedPlayers = [...prev, newPlayer];
      
      // Track player joining
      analytics.trackPlayerJoinedRoom(playerId, tableId, deviceInfo);
      
      return updatedPlayers;
    });
  }, [maxPlayers, tableId, analytics, getDeviceInfo]);

  const removePlayer = useCallback((playerId: string) => {
    setPlayers(prev => {
      const updatedPlayers = prev.filter(p => p.id !== playerId);
      
      // Track player leaving
      analytics.trackPlayerLeftRoom(playerId, tableId);
      
      return updatedPlayers;
    });
  }, [tableId, analytics]);

  // Game action tracking
  const handlePlayerAction = useCallback((
    playerId: string,
    action: 'fold' | 'call' | 'raise' | 'bet' | 'check',
    amount?: number
  ) => {
    const actionEndTime = Date.now();
    const timeTaken = lastActionTime ? actionEndTime - lastActionTime : 0;
    
    // Mark start time for measuring action timing
    performance.mark('action-start');
    
    // Update game state
    if (action === 'bet' || action === 'raise' || action === 'call') {
      setPot(prev => prev + (amount || 0));
    }
    
    // Get player info for analytics
    const player = players.find(p => p.id === playerId);
    if (!player) return;
    
    // Determine position (simplified)
    const playerIndex = players.findIndex(p => p.id === playerId);
    const position = getPositionName(playerIndex, players.length);
    
    // Determine street (simplified - would be more complex in real implementation)
    const street = getCurrentStreet();
    
    // Track the action
    trackPlayerAction(
      playerId,
      tableId,
      action,
      timeTaken,
      pot,
      position,
      street,
      player.stack
    );
    
    // Mark end time and measure
    performance.mark('action-end');
    performance.measure('table-action-processing', 'action-start', 'action-end');
    
    setLastActionTime(actionEndTime);
  }, [lastActionTime, players, pot, tableId]);

  // Hand completion tracking
  const completeHand = useCallback((handData: {
    winners: string[];
    totalPot: number;
    rake: number;
    showdown: boolean;
  }) => {
    const handEndTime = Date.now();
    const handStartTime = lastActionTime; // Simplified
    const handDuration = handEndTime - handStartTime;
    
    // Track hand completion
    analytics.trackHandCompleted(tableId, {
      playersCount: players.length,
      potSize: handData.totalPot,
      rake: handData.rake,
      flopSeen: true, // Would determine this from actual game state
      showdown: handData.showdown,
      duration: handDuration
    });
    
    // Reset for next hand
    setPot(0);
    setCurrentHand(prev => prev + 1);
  }, [lastActionTime, players.length, tableId, analytics]);

  // Feature usage tracking
  const handleChatMessage = useCallback((playerId: string, message: string) => {
    trackFeatureUsage('chat', playerId, { 
      message: message.substring(0, 50), // Only log first 50 chars for privacy
      messageLength: message.length,
      timestamp: new Date().toISOString()
    });
  }, []);

  const handleEmoteUsage = useCallback((playerId: string, emoteType: string) => {
    trackFeatureUsage('emotes', playerId, { 
      emoteType,
      timestamp: new Date().toISOString()
    });
  }, []);

  const handleHandHistoryView = useCallback((playerId: string) => {
    trackFeatureUsage('handHistory', playerId, {
      handsViewed: currentHand,
      timestamp: new Date().toISOString()
    });
  }, [currentHand]);

  const handleStatisticsView = useCallback((playerId: string) => {
    trackFeatureUsage('statistics', playerId, {
      sessionLength: Date.now() - lastActionTime,
      timestamp: new Date().toISOString()
    });
  }, [lastActionTime]);

  // Helper functions
  const getPositionName = (index: number, totalPlayers: number): string => {
    if (totalPlayers <= 2) return index === 0 ? 'small-blind' : 'big-blind';
    
    const positions = ['small-blind', 'big-blind', 'under-the-gun', 'middle', 'cut-off', 'button'];
    return positions[index] || 'middle';
  };

  const getCurrentStreet = (): 'preflop' | 'flop' | 'turn' | 'river' => {
    // Simplified - would determine from actual game state
    return 'preflop';
  };

  // Render the table interface
  return (
    <div className="poker-table-container">
      <div className="table-header">
        <h2>{gameType.toUpperCase()} - {stakes}</h2>
        <div className="table-stats">
          <span>Hand #{currentHand}</span>
          <span>Pot: ${pot}</span>
          <span>Players: {players.length}/{maxPlayers}</span>
        </div>
      </div>
      
      <div className="game-area">
        {/* Game visualization would go here */}
        <div className="community-cards">
          {/* Community cards display */}
        </div>
        
        <div className="pot-display">
          <span>Pot: ${pot}</span>
        </div>
      </div>
      
      <div className="player-seats">
        {Array.from({ length: maxPlayers }, (_, index) => {
          const player = players[index];
          return (
            <div key={index} className={`seat ${player ? 'occupied' : 'empty'}`}>
              {player ? (
                <div className="player-info">
                  <span className="player-name">{player.name}</span>
                  <span className="player-stack">${player.stack}</span>
                  <div className="action-buttons">
                    <button onClick={() => handlePlayerAction(player.id, 'fold')}>
                      Fold
                    </button>
                    <button onClick={() => handlePlayerAction(player.id, 'call', 10)}>
                      Call $10
                    </button>
                    <button onClick={() => handlePlayerAction(player.id, 'raise', 20)}>
                      Raise $20
                    </button>
                  </div>
                </div>
              ) : (
                <button 
                  className="join-seat"
                  onClick={() => addPlayer(`player-${Date.now()}`, `Player ${index + 1}`)}
                >
                  Join
                </button>
              )}
            </div>
          );
        })}
      </div>
      
      <div className="table-controls">
        <div className="chat-section">
          <input 
            type="text" 
            placeholder="Chat..."
            onKeyPress={(e) => {
              if (e.key === 'Enter' && players.length > 0) {
                handleChatMessage(players[0].id, e.currentTarget.value);
                e.currentTarget.value = '';
              }
            }}
          />
          <div className="emote-buttons">
            <button onClick={() => players.length > 0 && handleEmoteUsage(players[0].id, 'smile')}>
              😊
            </button>
            <button onClick={() => players.length > 0 && handleEmoteUsage(players[0].id, 'thumbsup')}>
              👍
            </button>
          </div>
        </div>
        
        <div className="feature-buttons">
          <button onClick={() => players.length > 0 && handleHandHistoryView(players[0].id)}>
            Hand History
          </button>
          <button onClick={() => players.length > 0 && handleStatisticsView(players[0].id)}>
            Statistics
          </button>
        </div>
        
        <button 
          className="complete-hand"
          onClick={() => completeHand({
            winners: players.slice(0, 1).map(p => p.id),
            totalPot: pot,
            rake: Math.floor(pot * 0.05),
            showdown: Math.random() > 0.5
          })}
          disabled={pot === 0}
        >
          Complete Hand
        </button>
      </div>
    </div>
  );
};

// Example: Analytics Dashboard Integration
export const AnalyticsDashboardPage: React.FC = () => {
  const [dateFilter, setDateFilter] = useState<AnalyticsFilter>({
    dateRange: {
      start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
      end: new Date()
    }
  });

  const [reportType, setReportType] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [generatedReport, setGeneratedReport] = useState<any>(null);

  const handleGenerateReport = useCallback(async () => {
    try {
      const report = generateAnalyticsReport(reportType);
      setGeneratedReport(report);
    } catch (error) {
      console.error('Failed to generate report:', error);
    }
  }, [reportType]);

  return (
    <div className="analytics-page">
      <div className="page-header">
        <h1>Poker Room Analytics</h1>
        <div className="controls">
          <div className="date-filter">
            <label>Date Range:</label>
            <input
              type="date"
              value={dateFilter.dateRange?.start.toISOString().split('T')[0]}
              onChange={(e) => setDateFilter(prev => ({
                ...prev,
                dateRange: {
                  start: new Date(e.target.value),
                  end: prev.dateRange?.end || new Date()
                }
              }))}
            />
            <span> to </span>
            <input
              type="date"
              value={dateFilter.dateRange?.end.toISOString().split('T')[0]}
              onChange={(e) => setDateFilter(prev => ({
                ...prev,
                dateRange: {
                  start: prev.dateRange?.start || new Date(),
                  end: new Date(e.target.value)
                }
              }))}
            />
          </div>
          
          <div className="report-controls">
            <select 
              value={reportType} 
              onChange={(e) => setReportType(e.target.value as any)}
            >
              <option value="daily">Daily Report</option>
              <option value="weekly">Weekly Report</option>
              <option value="monthly">Monthly Report</option>
            </select>
            <button onClick={handleGenerateReport}>
              Generate Report
            </button>
          </div>
        </div>
      </div>

      <GameAnalyticsDashboard
        refreshInterval={10000} // 10 seconds
        showAdvancedMetrics={true}
        allowExport={true}
        customFilters={dateFilter}
        className="main-dashboard"
      />

      {generatedReport && (
        <div className="generated-report">
          <h2>Generated Report: {generatedReport.title}</h2>
          <div className="report-summary">
            <h3>Summary</h3>
            <ul>
              {generatedReport.summary.keyInsights.map((insight: string, index: number) => (
                <li key={index}>{insight}</li>
              ))}
            </ul>
          </div>
          
          {generatedReport.recommendations.length > 0 && (
            <div className="recommendations">
              <h3>Recommendations</h3>
              <ul>
                {generatedReport.recommendations.map((rec: string, index: number) => (
                  <li key={index}>{rec}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Example: Real-time Analytics Monitoring
export const RealTimeMonitor: React.FC = () => {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [events, setEvents] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<string[]>([]);

  const analytics = getGameAnalytics();

  useEffect(() => {
    if (!isMonitoring) return;

    const handleAnalyticsEvent = (event: any) => {
      setEvents(prev => [event, ...prev.slice(0, 49)]); // Keep last 50 events
      
      // Simple alerting logic
      if (event.type === 'room_created' && event.data.gameType === 'high-stakes') {
        setAlerts(prev => [`High stakes room created: ${event.data.roomId}`, ...prev.slice(0, 9)]);
      }
    };

    const handleMetricsUpdate = (metrics: any) => {
      // Check for concerning metrics
      if (metrics.players.behavior.dropoutRate > 0.3) {
        setAlerts(prev => [`High dropout rate detected: ${(metrics.players.behavior.dropoutRate * 100).toFixed(1)}%`, ...prev.slice(0, 9)]);
      }
    };

    analytics.on('analyticsEvent', handleAnalyticsEvent);
    analytics.on('metricsUpdated', handleMetricsUpdate);

    return () => {
      analytics.off('analyticsEvent', handleAnalyticsEvent);
      analytics.off('metricsUpdated', handleMetricsUpdate);
    };
  }, [isMonitoring, analytics]);

  return (
    <div className="realtime-monitor">
      <div className="monitor-header">
        <h2>Real-time Analytics Monitor</h2>
        <button 
          onClick={() => setIsMonitoring(!isMonitoring)}
          className={isMonitoring ? 'monitoring' : 'stopped'}
        >
          {isMonitoring ? 'Stop Monitoring' : 'Start Monitoring'}
        </button>
      </div>

      {alerts.length > 0 && (
        <div className="alerts-section">
          <h3>Alerts</h3>
          {alerts.map((alert, index) => (
            <div key={index} className="alert">
              {alert}
            </div>
          ))}
        </div>
      )}

      <div className="events-section">
        <h3>Recent Events</h3>
        <div className="events-list">
          {events.map((event, index) => (
            <div key={index} className="event-item">
              <span className="event-timestamp">
                {event.timestamp.toLocaleTimeString()}
              </span>
              <span className="event-type">{event.type}</span>
              <span className="event-data">
                {JSON.stringify(event.data, null, 2)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// Example: Performance Analytics Hook
export const usePerformanceAnalytics = () => {
  const analytics = getGameAnalytics();

  const trackComponentRender = useCallback((componentName: string, renderTime: number) => {
    analytics.trackFeaturePerformance(componentName, 'loadTimes', renderTime);
  }, [analytics]);

  const trackUserInteraction = useCallback((interactionType: string, duration: number) => {
    analytics.trackFeaturePerformance(interactionType, 'loadTimes', duration);
  }, [analytics]);

  const trackError = useCallback((errorType: string, componentName: string) => {
    analytics.trackFeaturePerformance(componentName, 'errorRates', 1);
  }, [analytics]);

  return {
    trackComponentRender,
    trackUserInteraction,
    trackError
  };
};

// Example: Custom Analytics Hook for Game Components
export const useGameAnalyticsIntegration = (gameId: string) => {
  const analytics = getGameAnalytics();
  const perf = usePerformanceAnalytics();

  const trackGameStart = useCallback(() => {
    const start = performance.now();
    perf.trackComponentRender('game-initialization', start);
  }, [perf]);

  const trackGameAction = useCallback((playerId: string, action: string, metadata?: any) => {
    const actionTime = Date.now();
    trackPlayerAction(playerId, gameId, action, actionTime, metadata?.potSize || 0, metadata?.position || 'unknown', metadata?.street || 'preflop', metadata?.stack || 0);
  }, [gameId]);

  const trackFeature = useCallback((feature: string, playerId: string, metadata?: any) => {
    trackFeatureUsage(feature as any, playerId, metadata);
  }, []);

  return {
    trackGameStart,
    trackGameAction,
    trackFeature,
    analytics
  };
};

const GameAnalyticsIntegration = {
  PokerTableWithAnalytics,
  AnalyticsDashboardPage,
  RealTimeMonitor,
  usePerformanceAnalytics,
  useGameAnalyticsIntegration
};

export default GameAnalyticsIntegration;
