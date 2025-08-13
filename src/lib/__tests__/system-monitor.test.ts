import { SystemMonitor } from '../system-monitor';
import { SystemAlert } from '../../types/system-metrics';
import os from 'os';

jest.mock('os', () => ({
  cpus: jest.fn(),
  totalmem: jest.fn(),
  freemem: jest.fn(),
  networkInterfaces: jest.fn()
}));

describe('SystemMonitor', () => {
  let monitor: SystemMonitor;

  beforeEach(() => {
    monitor = SystemMonitor.getInstance();
    monitor.enableTestMode();
    monitor.reset();
    
    // Mock OS metrics
    (os.cpus as jest.Mock).mockReturnValue([
      {
        times: {
          user: 100,
          nice: 0,
          sys: 50,
          idle: 50,
          irq: 0
        }
      }
    ]);
    (os.totalmem as jest.Mock).mockReturnValue(8 * 1024 * 1024 * 1024); // 8GB
    (os.freemem as jest.Mock).mockReturnValue(4 * 1024 * 1024 * 1024); // 4GB
    (os.networkInterfaces as jest.Mock).mockReturnValue({
      eth0: [
        {
          address: '192.168.1.1',
          netmask: '255.255.255.0',
          family: 'IPv4',
          mac: '00:00:00:00:00:00',
          internal: false,
          cidr: '192.168.1.1/24'
        }
      ]
    });

    monitor = SystemMonitor.getInstance();
  });

  describe('Table Management', () => {
    it('should register new tables', () => {
      monitor.registerTable('table1');
      const metrics = monitor.getMetrics();
      expect(metrics.activeTables).toBe(1);
    });

    it('should unregister tables', () => {
      monitor.registerTable('table1');
      monitor.unregisterTable('table1');
      const metrics = monitor.getMetrics();
      expect(metrics.activeTables).toBe(0);
    });

    it('should enforce table limit', () => {
      expect(() => {
        monitor.disableTestMode();
        for (let i = 0; i < 1001; i++) {
          monitor.registerTable(`table${i}`);
        }
      }).toThrow('Maximum table limit reached');
    });
  });

  describe('Player Management', () => {
    it('should track player count', () => {
      monitor.registerTable('table1');
      monitor.playerJoined('table1');
      monitor.playerJoined('table1');
      
      const tableMetrics = monitor.getTableMetrics('table1');
      expect(tableMetrics?.playerCount).toBe(2);

      const systemMetrics = monitor.getMetrics();
      expect(systemMetrics.activePlayers).toBe(2);
    });

    it('should update player count when players leave', () => {
      monitor.registerTable('table1');
      monitor.playerJoined('table1');
      monitor.playerJoined('table1');
      monitor.playerLeft('table1');

      const tableMetrics = monitor.getTableMetrics('table1');
      expect(tableMetrics?.playerCount).toBe(1);
    });
  });

  describe('Message Rate Tracking', () => {
    it('should track message rate', () => {
      jest.useFakeTimers();
      
      monitor.registerTable('table1');
      
      // Simulate 100 messages in one second
      for (let i = 0; i < 100; i++) {
        monitor.recordMessage('table1');
      }

      const metrics = monitor.getMetrics();
      expect(metrics.messageRate).toBeGreaterThan(0);

      jest.useRealTimers();
    });
  });

  describe('Resource Monitoring', () => {
    it('should track system resources', async () => {
      const metrics = monitor.getMetrics();
      
      expect(metrics.resourceUtilization).toEqual(
        expect.objectContaining({
          cpu: expect.any(Number),
          memory: expect.any(Number),
          network: expect.any(Number)
        })
      );

      expect(metrics.resourceUtilization.cpu).toBeGreaterThanOrEqual(0);
      expect(metrics.resourceUtilization.cpu).toBeLessThanOrEqual(100);
    });
  });

  describe('Alert System', () => {
    it('should emit alerts when table limit is exceeded', () => {
      const alerts: SystemAlert[] = [];
      monitor.reset();
      monitor.disableTestMode();
      
      monitor.onAlert((alert) => {
        alerts.push(alert);
      });
      
      // Register more than the allowed number of tables
      for (let i = 0; i < 1001; i++) {
        try {
          monitor.registerTable(`table${i}`);
        } catch (e) {
          break;
        }
      }

      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0]).toMatchObject({
        type: 'critical',
        metric: 'activeTables',
        current: 1001,
        threshold: 1000
      });
    });
  });
});
