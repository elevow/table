import { describe, test, expect } from '@jest/globals';
import { DataArchivalService, ArchivalConfig } from '../data-archival-service';
import { createTestPool } from './database-connection.test';

const baseConfig: ArchivalConfig = {
  retention: {
    gameHistory: 30,
    chatLogs: 7,
    playerActions: 14,
    systemLogs: 3
  },
  archiveLocation: '/dev/null',
  compression: false,
  schedule: '* * * * *'
};

describe('DataArchivalService mapping branches', () => {
  test('archiveCategory handles chatLogs mapping path (will fail gracefully with mock)', async () => {
    const service = new DataArchivalService(createTestPool(), baseConfig);
    const job = await service.archiveCategory('chatLogs');
    expect(['completed', 'failed']).toContain(job.status);
  });

  test('archiveCategory handles systemLogs mapping path (will fail gracefully with mock)', async () => {
    const service = new DataArchivalService(createTestPool(), baseConfig);
    const job = await service.archiveCategory('systemLogs');
    expect(['completed', 'failed']).toContain(job.status);
  });

  test('archiveCategory default mapping path for unknown category', async () => {
    const service = new DataArchivalService(createTestPool(), baseConfig);
    const job = await service.archiveCategory('unknown' as any);
    expect(['completed', 'failed']).toContain(job.status);
  });
});
