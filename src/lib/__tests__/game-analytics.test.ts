/**
 * Game Analytics Test Suite - US-042 Implementation
 * 
 * Comprehensive test coverage for the game analytics system including
 * unit tests, integration tests, and component tests.
 * 
 * @author GitHub Copilot
 * @version 1.0.0
 */

import { jest } from '@jest/globals';
import {
  GameAnalyticsCollector,
  getGameAnalytics,
  trackRoomCreated,
  trackPlayerAction,
  trackFeatureUsage,
  generateAnalyticsReport,
  type GameAnalytics,
  type RoomStatistics,
  type PlayerSession,
  type ActionTiming,
  type AnalyticsFilter,
  type DeviceInfo
} from '../game-analytics';

// Mock EventEmitter for testing
jest.mock('events', () => ({
  EventEmitter: class MockEventEmitter {
    private listeners: Record<string, Function[]> = {};
    
    on(event: string, listener: Function) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(listener);
    }
    
    off(event: string, listener: Function) {
      if (this.listeners[event]) {
        this.listeners[event] = this.listeners[event].filter(l => l !== listener);
      }
    }
    
    emit(event: string, ...args: any[]) {
      if (this.listeners[event]) {
        this.listeners[event].forEach(listener => listener(...args));
      }
    }
    
    removeAllListeners() {
      this.listeners = {};
    }
  }
}));

describe('GameAnalyticsCollector', () => {
  let collector: GameAnalyticsCollector;
  
  beforeEach(() => {
    // Create fresh instance for each test
    collector = new GameAnalyticsCollector({
      maxEventHistory: 100,
      maxActionHistory: 500,
      collectionIntervalMs: 1000
    });
  });
  
  afterEach(() => {
    collector.destroy();
  });

  describe('Initialization', () => {
    it('should initialize with default metrics', () => {
      const analytics = collector.getAnalytics();
      
      expect(analytics.rooms.active).toBe(0);
      expect(analytics.players.active).toBe(0);
      expect(analytics.revenue.grossRevenue).toBe(0);
      expect(analytics.features.usage.chat.usage).toBe(0);
      expect(analytics.gameplay.handsPerHour).toBe(0);
    });

    it('should accept configuration options', () => {
      const customCollector = new GameAnalyticsCollector({
        maxEventHistory: 50,
        maxActionHistory: 200
      });
      
      expect(customCollector).toBeDefined();
      customCollector.destroy();
    });
  });

  describe('Room Analytics', () => {
    it('should track room creation', () => {
      collector.trackRoomCreated('room-1', 'texas-holdem', '1/2');
      
      const analytics = collector.getAnalytics();
      expect(analytics.rooms.active).toBe(1);
      expect(analytics.rooms.roomTypes['texas-holdem']).toBe(1);
      
      const roomStats = collector.getRoomStatistics('room-1');
      expect(roomStats).toHaveLength(1);
      expect(roomStats[0].roomId).toBe('room-1');
      expect(roomStats[0].gameType).toBe('texas-holdem');
      expect(roomStats[0].stakes).toBe('1/2');
    });

    it('should track multiple room types', () => {
      collector.trackRoomCreated('room-1', 'texas-holdem', '1/2');
      collector.trackRoomCreated('room-2', 'omaha', '2/5');
      collector.trackRoomCreated('room-3', 'texas-holdem', '5/10');
      
      const analytics = collector.getAnalytics();
      expect(analytics.rooms.active).toBe(3);
      expect(analytics.rooms.roomTypes['texas-holdem']).toBe(2);
      expect(analytics.rooms.roomTypes['omaha']).toBe(1);
    });

    it('should track room end and calculate duration', () => {
      collector.trackRoomCreated('room-1', 'texas-holdem', '1/2');
      
      // Simulate time passing
      setTimeout(() => {
        collector.trackRoomEnded('room-1');
        
        const analytics = collector.getAnalytics();
        expect(analytics.rooms.active).toBe(0);
        expect(analytics.rooms.avgDuration).toBeGreaterThan(0);
      }, 10);
    });

    it('should track player joining and leaving rooms', () => {
      collector.trackRoomCreated('room-1', 'texas-holdem', '1/2');
      
      const deviceInfo: DeviceInfo = {
        type: 'desktop',
        os: 'Windows',
        browser: 'Chrome',
        screenResolution: '1920x1080',
        connectionType: 'wifi'
      };
      
      collector.trackPlayerJoinedRoom('player-1', 'room-1', deviceInfo);
      collector.trackPlayerJoinedRoom('player-2', 'room-1');
      
      let analytics = collector.getAnalytics();
      expect(analytics.players.active).toBe(2);
      expect(analytics.players.demographics.byDevice['desktop']).toBe(1);
      
      const roomStats = collector.getRoomStatistics('room-1');
      expect(roomStats[0].playerCount).toBe(2);
      expect(roomStats[0].peakPlayers).toBe(2);
      
      collector.trackPlayerLeftRoom('player-1', 'room-1');
      
      analytics = collector.getAnalytics();
      expect(analytics.players.active).toBe(1);
      
      const updatedRoomStats = collector.getRoomStatistics('room-1');
      expect(updatedRoomStats[0].playerCount).toBe(1);
      expect(updatedRoomStats[0].playerTurnover).toBe(1);
    });
  });

  describe('Player Action Analytics', () => {
    beforeEach(() => {
      collector.trackRoomCreated('room-1', 'texas-holdem', '1/2');
      collector.trackPlayerJoinedRoom('player-1', 'room-1');
    });

    it('should track player actions with timing', () => {
      collector.trackPlayerAction(
        'player-1', 
        'room-1', 
        'bet', 
        2500, // 2.5 seconds
        100,  // pot size
        'button',
        'preflop',
        1000  // stack size
      );
      
      const actionTimings = collector.getActionTimings();
      expect(actionTimings).toHaveLength(1);
      
      const action = actionTimings[0];
      expect(action.playerId).toBe('player-1');
      expect(action.action).toBe('bet');
      expect(action.timeTaken).toBe(2500);
      expect(action.potSize).toBe(100);
      expect(action.position).toBe('button');
      expect(action.street).toBe('preflop');
      expect(action.stackSize).toBe(1000);
      
      const analytics = collector.getAnalytics();
      expect(analytics.gameplay.actionDistribution['bet']).toBe(1);
    });

    it('should calculate player session metrics', () => {
      // Simulate multiple actions for VPIP/PFR calculation
      collector.trackPlayerAction('player-1', 'room-1', 'fold', 1000, 10, 'big-blind', 'preflop', 1000);
      collector.trackPlayerAction('player-1', 'room-1', 'call', 1500, 20, 'small-blind', 'preflop', 980);
      collector.trackPlayerAction('player-1', 'room-1', 'raise', 2000, 40, 'button', 'preflop', 960);
      collector.trackPlayerAction('player-1', 'room-1', 'bet', 1800, 80, 'cut-off', 'flop', 900);
      
      const sessions = collector.getPlayerSessions('player-1');
      expect(sessions).toHaveLength(1);
      
      const session = sessions[0];
      expect(session.handsPlayed).toBe(4);
      expect(session.actionsCount['fold']).toBe(1);
      expect(session.actionsCount['call']).toBe(1);
      expect(session.actionsCount['raise']).toBe(1);
      expect(session.actionsCount['bet']).toBe(1);
      expect(session.vpip).toBeGreaterThan(0); // Should be > 0 since player called/bet/raised
      expect(session.pfr).toBeGreaterThan(0);  // Should be > 0 since player raised
    });

    it('should track hand completion metrics', () => {
      collector.trackHandCompleted('room-1', {
        playersCount: 3,
        potSize: 150,
        rake: 5,
        flopSeen: true,
        showdown: false,
        duration: 45000 // 45 seconds
      });
      
      const roomStats = collector.getRoomStatistics('room-1');
      expect(roomStats[0].handsPlayed).toBe(1);
      expect(roomStats[0].totalPot).toBe(150);
      expect(roomStats[0].rakeCollected).toBe(5);
      
      const analytics = collector.getAnalytics();
      expect(analytics.revenue.rakeCollected).toBe(5);
      expect(analytics.revenue.grossRevenue).toBe(5);
      expect(analytics.gameplay.averagePotSize).toBe(150);
      expect(analytics.gameplay.handsPlayed).toBe(1);
    });
  });

  describe('Feature Usage Tracking', () => {
    it('should track feature usage', () => {
      collector.trackFeatureUsage('chat', 'player-1', { message: 'Hello' });
      collector.trackFeatureUsage('emotes', 'player-1', { emote: 'smile' });
      collector.trackFeatureUsage('chat', 'player-2', { message: 'Good game' });
      
      const analytics = collector.getAnalytics();
      expect(analytics.features.usage.chat.usage).toBe(2);
      expect(analytics.features.usage.emotes.usage).toBe(1);
    });

    it('should track feature performance metrics', () => {
      collector.trackFeaturePerformance('chat', 'loadTimes', 150);
      collector.trackFeaturePerformance('chat', 'errorRates', 0.02);
      collector.trackFeaturePerformance('handHistory', 'loadTimes', 300);
      
      const analytics = collector.getAnalytics();
      expect(analytics.features.performance.loadTimes['chat']).toBe(150);
      expect(analytics.features.performance.errorRates['chat']).toBe(0.02);
      expect(analytics.features.performance.loadTimes['handHistory']).toBe(300);
    });
  });

  describe('Trend Analysis', () => {
    it('should generate trend data', () => {
      // Create some test events
      collector.trackRoomCreated('room-1', 'texas-holdem', '1/2');
      collector.trackPlayerJoinedRoom('player-1', 'room-1');
      collector.trackPlayerJoinedRoom('player-2', 'room-1');
      
      const trends = collector.getTrendData('active_players', 'hour');
      expect(Array.isArray(trends)).toBe(true);
    });

    it('should filter trend data by date range', () => {
      const filter: AnalyticsFilter = {
        dateRange: {
          start: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
          end: new Date()
        }
      };
      
      const actionTimings = collector.getActionTimings(filter);
      expect(Array.isArray(actionTimings)).toBe(true);
    });
  });

  describe('Report Generation', () => {
    beforeEach(() => {
      // Set up test data
      collector.trackRoomCreated('room-1', 'texas-holdem', '1/2');
      collector.trackPlayerJoinedRoom('player-1', 'room-1');
      collector.trackPlayerAction('player-1', 'room-1', 'bet', 2000, 100, 'button', 'preflop', 1000);
      collector.trackHandCompleted('room-1', {
        playersCount: 1,
        potSize: 100,
        rake: 3,
        flopSeen: true,
        showdown: false,
        duration: 30000
      });
    });

    it('should generate daily report', () => {
      const report = collector.generateReport('daily', {
        includeCharts: true,
        includeRecommendations: true
      });
      
      expect(report.title).toContain('Daily');
      expect(report.summary.totalPlayers).toBe(1);
      expect(report.summary.totalHands).toBe(1);
      expect(report.summary.totalRevenue).toBe(3);
      expect(report.sections).toHaveLength(3);
      expect(report.charts).toHaveLength(2);
      expect(Array.isArray(report.recommendations)).toBe(true);
    });

    it('should generate weekly report', () => {
      const report = collector.generateReport('weekly');
      expect(report.title).toContain('Weekly');
      expect(report.period).toMatch(/\d{4}-W\d{2}/); // Week format: 2024-W32
    });

    it('should generate monthly report', () => {
      const report = collector.generateReport('monthly');
      expect(report.title).toContain('Monthly');
      expect(report.period).toMatch(/\d{4}-\d{2}/); // Month format: 2024-08
    });
  });

  describe('Data Export', () => {
    beforeEach(() => {
      collector.trackRoomCreated('room-1', 'texas-holdem', '1/2');
      collector.trackPlayerJoinedRoom('player-1', 'room-1');
    });

    it('should export data as JSON', () => {
      const jsonData = collector.exportData('json');
      
      expect(() => JSON.parse(jsonData)).not.toThrow();
      
      const parsed = JSON.parse(jsonData);
      expect(parsed.analytics).toBeDefined();
      expect(parsed.roomStats).toBeDefined();
      expect(parsed.playerSessions).toBeDefined();
      expect(parsed.actionTimings).toBeDefined();
    });

    it('should export data as CSV', () => {
      const csvData = collector.exportData('csv');
      
      expect(typeof csvData).toBe('string');
      expect(csvData).toContain('timestamp');
      expect(csvData).toContain('metric');
      expect(csvData).toContain('value');
      expect(csvData.split('\n').length).toBeGreaterThan(1);
    });

    it('should apply filters when exporting', () => {
      const filter: AnalyticsFilter = {
        gameTypes: ['texas-holdem'],
        dateRange: {
          start: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
          end: new Date()
        }
      };
      
      const filteredData = collector.exportData('json', filter);
      expect(() => JSON.parse(filteredData)).not.toThrow();
    });
  });

  describe('Real-time Updates', () => {
    it('should emit events when metrics are updated', (done) => {
      let eventReceived = false;
      
      collector.on('metricsUpdated', (analytics: GameAnalytics) => {
        expect(analytics).toBeDefined();
        expect(analytics.rooms).toBeDefined();
        eventReceived = true;
        done();
      });
      
      // Trigger an update
      collector.trackRoomCreated('room-1', 'texas-holdem', '1/2');
      
      // Wait a bit for the event
      setTimeout(() => {
        if (!eventReceived) {
          done(new Error('Event not received'));
        }
      }, 100);
    });

    it('should emit analytics events for tracking', (done) => {
      collector.on('analyticsEvent', (event) => {
        expect(event.type).toBe('room_created');
        expect(event.data.roomId).toBe('room-1');
        expect(event.timestamp).toBeInstanceOf(Date);
        done();
      });
      
      collector.trackRoomCreated('room-1', 'texas-holdem', '1/2');
    });
  });

  describe('Memory Management', () => {
    it('should maintain event history within limits', () => {
      const smallCollector = new GameAnalyticsCollector({
        maxEventHistory: 5,
        maxActionHistory: 5
      });
      
      // Add more events than the limit
      for (let i = 0; i < 10; i++) {
        smallCollector.trackRoomCreated(`room-${i}`, 'texas-holdem', '1/2');
      }
      
      // Events should be limited
      const events = (smallCollector as any).events;
      expect(events.length).toBeLessThanOrEqual(5);
      
      smallCollector.destroy();
    });

    it('should maintain action history within limits', () => {
      const smallCollector = new GameAnalyticsCollector({
        maxEventHistory: 100,
        maxActionHistory: 3
      });
      
      smallCollector.trackRoomCreated('room-1', 'texas-holdem', '1/2');
      smallCollector.trackPlayerJoinedRoom('player-1', 'room-1');
      
      // Add more actions than the limit
      for (let i = 0; i < 10; i++) {
        smallCollector.trackPlayerAction('player-1', 'room-1', 'fold', 1000, 10, 'button', 'preflop', 1000);
      }
      
      const actionTimings = smallCollector.getActionTimings();
      expect(actionTimings.length).toBeLessThanOrEqual(3);
      
      smallCollector.destroy();
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid room operations gracefully', () => {
      // Try to end a room that doesn't exist
      expect(() => collector.trackRoomEnded('non-existent-room')).not.toThrow();
      
      // Try to add player to non-existent room
      expect(() => collector.trackPlayerJoinedRoom('player-1', 'non-existent-room')).not.toThrow();
    });

    it('should handle invalid player operations gracefully', () => {
      // Try to remove player from non-existent room
      expect(() => collector.trackPlayerLeftRoom('player-1', 'non-existent-room')).not.toThrow();
      
      // Try to track action for non-existent session
      expect(() => {
        collector.trackPlayerAction('player-1', 'room-1', 'bet', 1000, 10, 'button', 'preflop', 1000);
      }).not.toThrow();
    });
  });

  describe('Data Integrity', () => {
    it('should maintain consistent player counts', () => {
      collector.trackRoomCreated('room-1', 'texas-holdem', '1/2');
      
      // Add players
      collector.trackPlayerJoinedRoom('player-1', 'room-1');
      collector.trackPlayerJoinedRoom('player-2', 'room-1');
      collector.trackPlayerJoinedRoom('player-3', 'room-1');
      
      let analytics = collector.getAnalytics();
      expect(analytics.players.active).toBe(3);
      
      // Remove players
      collector.trackPlayerLeftRoom('player-1', 'room-1');
      collector.trackPlayerLeftRoom('player-2', 'room-1');
      
      analytics = collector.getAnalytics();
      expect(analytics.players.active).toBe(1);
      
      // Remove last player
      collector.trackPlayerLeftRoom('player-3', 'room-1');
      
      analytics = collector.getAnalytics();
      expect(analytics.players.active).toBe(0);
    });

    it('should maintain consistent room counts', () => {
      collector.trackRoomCreated('room-1', 'texas-holdem', '1/2');
      collector.trackRoomCreated('room-2', 'omaha', '2/5');
      
      let analytics = collector.getAnalytics();
      expect(analytics.rooms.active).toBe(2);
      
      collector.trackRoomEnded('room-1');
      
      analytics = collector.getAnalytics();
      expect(analytics.rooms.active).toBe(1);
      
      collector.trackRoomEnded('room-2');
      
      analytics = collector.getAnalytics();
      expect(analytics.rooms.active).toBe(0);
    });
  });

  describe('Performance Calculations', () => {
    it('should calculate accurate VPIP percentages', () => {
      collector.trackRoomCreated('room-1', 'texas-holdem', '1/2');
      collector.trackPlayerJoinedRoom('player-1', 'room-1', { 
        type: 'desktop', 
        os: 'Windows', 
        browser: 'Chrome', 
        screenResolution: '1920x1080',
        connectionType: 'wifi'
      });
      
      // Simulate 3 hands with specific VPIP patterns
      // Hand 1: VPIP (call)
      collector.trackHandCompleted('room-1', {
        playersCount: 2,
        potSize: 20,
        rake: 1,
        flopSeen: false,
        showdown: false,
        duration: 30000,
        playerActions: {
          'player-1': { voluntaryPutInPot: true, raisedPreflop: false }
        }
      });
      
      // Hand 2: Not VPIP (fold)
      collector.trackHandCompleted('room-1', {
        playersCount: 2,
        potSize: 10,
        rake: 0,
        flopSeen: false,
        showdown: false,
        duration: 15000,
        playerActions: {
          'player-1': { voluntaryPutInPot: false, raisedPreflop: false }
        }
      });
      
      // Hand 3: VPIP (raise)
      collector.trackHandCompleted('room-1', {
        playersCount: 2,
        potSize: 40,
        rake: 2,
        flopSeen: true,
        showdown: false,
        duration: 45000,
        playerActions: {
          'player-1': { voluntaryPutInPot: true, raisedPreflop: true }
        }
      });
      
      const sessions = collector.getPlayerSessions('player-1');
      expect(sessions.length).toBe(1);
      const session = sessions[0];
      
      // VPIP should be 66.67% (2 out of 3 hands)
      expect(session.vpip).toBeCloseTo(66.67, 1);
      expect(session.handsPlayed).toBe(3);
    });

    it('should calculate accurate PFR percentages', () => {
      collector.trackRoomCreated('room-1', 'texas-holdem', '1/2');
      collector.trackPlayerJoinedRoom('player-1', 'room-1', { 
        type: 'desktop', 
        os: 'Windows', 
        browser: 'Chrome', 
        screenResolution: '1920x1080',
        connectionType: 'wifi'
      });
      
      // Simulate 5 hands with specific PFR patterns
      // Hands 1-3: No raise preflop
      for (let i = 0; i < 3; i++) {
        collector.trackHandCompleted('room-1', {
          playersCount: 2,
          potSize: 20,
          rake: 1,
          flopSeen: false,
          showdown: false,
          duration: 30000,
          playerActions: {
            'player-1': { voluntaryPutInPot: false, raisedPreflop: false }
          }
        });
      }
      
      // Hands 4-5: Raised preflop
      for (let i = 0; i < 2; i++) {
        collector.trackHandCompleted('room-1', {
          playersCount: 2,
          potSize: 40,
          rake: 2,
          flopSeen: true,
          showdown: false,
          duration: 45000,
          playerActions: {
            'player-1': { voluntaryPutInPot: true, raisedPreflop: true }
          }
        });
      }
      
      const sessions = collector.getPlayerSessions('player-1');
      const session = sessions[0];
      
      // PFR should be 40% (2 out of 5 hands)
      expect(session.pfr).toBeCloseTo(40, 1);
      expect(session.handsPlayed).toBe(5);
    });
  });
});

// Integration Tests
describe('Game Analytics Integration', () => {
  let collector: GameAnalyticsCollector;
  
  beforeEach(() => {
    collector = new GameAnalyticsCollector();
  });
  
  afterEach(() => {
    collector.destroy();
  });

  it('should track a complete game session', () => {
    // Create room
    collector.trackRoomCreated('room-1', 'texas-holdem', '1/2');
    
    // Players join
    collector.trackPlayerJoinedRoom('player-1', 'room-1', {
      type: 'desktop',
      os: 'Windows',
      browser: 'Chrome',
      screenResolution: '1920x1080',
      connectionType: 'wifi'
    });
    
    collector.trackPlayerJoinedRoom('player-2', 'room-1', {
      type: 'mobile',
      os: 'iOS',
      browser: 'Safari',
      screenResolution: '375x812',
      connectionType: '4g'
    });
    
    // Play some hands
    for (let hand = 0; hand < 5; hand++) {
      // Preflop actions
      collector.trackPlayerAction('player-1', 'room-1', 'raise', 1500, 3, 'button', 'preflop', 1000);
      collector.trackPlayerAction('player-2', 'room-1', 'call', 1200, 6, 'big-blind', 'preflop', 1000);
      
      // Flop actions
      collector.trackPlayerAction('player-2', 'room-1', 'check', 800, 6, 'big-blind', 'flop', 997);
      collector.trackPlayerAction('player-1', 'room-1', 'bet', 1100, 10, 'button', 'flop', 997);
      collector.trackPlayerAction('player-2', 'room-1', 'fold', 600, 10, 'big-blind', 'flop', 997);
      
      // Complete hand
      collector.trackHandCompleted('room-1', {
        playersCount: 2,
        potSize: 16,
        rake: 1,
        flopSeen: true,
        showdown: false,
        duration: 45000
      });
    }
    
    // Use features
    collector.trackFeatureUsage('chat', 'player-1', { message: 'Nice hand!' });
    collector.trackFeatureUsage('emotes', 'player-2', { emote: 'thumbsup' });
    collector.trackFeatureUsage('handHistory', 'player-1');
    
    // Players leave
    collector.trackPlayerLeftRoom('player-1', 'room-1');
    collector.trackPlayerLeftRoom('player-2', 'room-1');
    
    // End room
    collector.trackRoomEnded('room-1');
    
    // Verify analytics
    const analytics = collector.getAnalytics();
    expect(analytics.rooms.active).toBe(0);
    expect(analytics.players.active).toBe(0);
    expect(analytics.revenue.rakeCollected).toBe(5); // 5 hands × $1 rake
    expect(analytics.features.usage.chat.usage).toBe(1);
    expect(analytics.features.usage.emotes.usage).toBe(1);
    expect(analytics.features.usage.handHistory.usage).toBe(1);
    
    const roomStats = collector.getRoomStatistics('room-1');
    expect(roomStats[0].handsPlayed).toBe(5);
    expect(roomStats[0].peakPlayers).toBe(2);
    expect(roomStats[0].rakeCollected).toBe(5);
    expect(roomStats[0].endedAt).toBeDefined();
  });
});

// Utility function tests
describe('Game Analytics Utility Functions', () => {
  afterEach(() => {
    // Reset singleton instance
    (getGameAnalytics() as any).destroy();
  });

  it('should provide singleton access', () => {
    const collector1 = getGameAnalytics();
    const collector2 = getGameAnalytics();
    
    expect(collector1).toBe(collector2);
  });

  it('should provide utility functions for tracking', () => {
    trackRoomCreated('room-1', 'texas-holdem', '1/2');
    
    const analytics = getGameAnalytics().getAnalytics();
    expect(analytics.rooms.active).toBe(1);
  });

  it('should provide utility for player actions', () => {
    trackRoomCreated('room-1', 'texas-holdem', '1/2');
    trackPlayerAction('player-1', 'room-1', 'bet', 2000, 100, 'button', 'preflop', 1000);
    
    const actionTimings = getGameAnalytics().getActionTimings();
    expect(actionTimings).toHaveLength(1);
  });

  it('should provide utility for feature tracking', () => {
    trackFeatureUsage('chat', 'player-1', { message: 'Hello' });
    
    const analytics = getGameAnalytics().getAnalytics();
    expect(analytics.features.usage.chat.usage).toBe(1);
  });

  it('should provide utility for report generation', () => {
    trackRoomCreated('room-1', 'texas-holdem', '1/2');
    
    const report = generateAnalyticsReport('daily');
    expect(report.title).toContain('Daily');
    expect(report.summary).toBeDefined();
  });
});
