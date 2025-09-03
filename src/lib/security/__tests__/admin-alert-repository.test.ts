// Tests for AdminAlertRepository using a mocked DB pool
import type { AdminAlert } from '../../../types';

// Mock the database connection module that the repository requires at import-time
const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};

const mockPool = {
  connect: jest.fn().mockResolvedValue(mockClient),
};

jest.mock('../../database/database-connection', () => {
  return {
    createDatabasePool: jest.fn(() => mockPool),
    DatabaseConfig: class {},
  };
});

// Import after mock so the singleton pool is created from our mock
import { AdminAlertRepository } from '../admin-alert-repository';

describe('AdminAlertRepository', () => {
  const repo = new AdminAlertRepository();

  const sample: AdminAlert = {
    id: 'a1',
    type: 'slow_queries',
    severity: 'medium',
    message: 'Slow queries detected',
    at: 1730000000000,
    involved: ['u1', 'u2'],
    source: 'db-monitor',
    status: 'open',
    evidence: ['q1', 'q2'],
    createdAt: 1730000000000,
    updatedAt: 1730000100000,
  } as AdminAlert;

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('creates an admin alert (INSERT params serialized correctly)', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await repo.create(sample);

    expect(mockPool.connect).toHaveBeenCalled();
    expect(mockClient.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mockClient.query.mock.calls[0];
    expect(String(sql)).toContain('INSERT INTO admin_alerts');
    expect(params[0]).toBe(sample.id);
    expect(params[1]).toBe(sample.type);
    expect(params[2]).toBe(sample.severity);
    expect(params[3]).toBe(sample.message);
    expect(params[4]).toBe(sample.at); // TO_TIMESTAMP($5/1000.0)
    expect(params[5]).toBe(JSON.stringify(sample.involved));
    expect(params[6]).toBe(sample.source);
    expect(params[7]).toBe(sample.status);
    expect(params[8]).toBe(JSON.stringify(sample.evidence));
    expect(params[9]).toBe(sample.createdAt);
    expect(params[10]).toBe(sample.updatedAt);
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('lists alerts and maps DB rows to domain objects', async () => {
    const at = new Date(1730000000000);
    const createdAt = new Date(1730000000000);
    const updatedAt = new Date(1730000100000);
    mockClient.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'a2',
          type: 'security_incident',
          severity: 'high',
          message: 'Breach detected',
          at,
          involved: [123, 456], // numeric -> string mapping expected
          source: 'waf',
          status: 'open',
          evidence: ['ip:1.2.3.4'],
          created_at: createdAt,
          updated_at: updatedAt,
        },
      ],
      rowCount: 1,
    });

    const res = await repo.list();
    expect(res).toHaveLength(1);
    const alert = res[0];
    expect(alert.id).toBe('a2');
    expect(alert.type).toBe('security_incident');
    expect(alert.severity).toBe('high');
    expect(alert.message).toBe('Breach detected');
    expect(alert.at).toBe(at.getTime());
    expect(alert.createdAt).toBe(createdAt.getTime());
    expect(alert.updatedAt).toBe(updatedAt.getTime());
    expect(alert.involved).toEqual(['123', '456']);
    expect(alert.evidence).toEqual(['ip:1.2.3.4']);
    expect(alert.source).toBe('waf');
    expect(alert.status).toBe('open');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('gets a single alert by id or returns null when not found', async () => {
    // found
    const at = new Date(1730001000000);
    const createdAt = new Date(1730001000000);
    const updatedAt = new Date(1730001100000);
    mockClient.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'a3', type: 'slow_queries', severity: 'low', message: 'minor', at,
          involved: null, source: 'db', status: 'closed', evidence: null,
          created_at: createdAt, updated_at: updatedAt,
        },
      ],
      rowCount: 1,
    });
    const found = await repo.get('a3');
    expect(found?.id).toBe('a3');
    expect(found?.involved).toEqual([]); // non-array -> []
    expect(found?.evidence).toEqual([]); // null -> []

    // not found
    mockClient.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const notFound = await repo.get('missing');
    expect(notFound).toBeNull();
  });

  it('updates status and returns mapped row (or null when no row)', async () => {
    const at = new Date(1730002000000);
    const createdAt = new Date(1730002000000);
    const updatedAt = new Date(1730002100000);

    mockClient.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'a4', type: 'security_incident', severity: 'critical', message: 'rooted', at,
            involved: [], source: 'ids', status: 'ack', evidence: [], created_at: createdAt, updated_at: updatedAt,
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const updated = await repo.updateStatus('a4', 'ack' as any);
    expect(mockClient.query).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/UPDATE admin_alerts SET status = \$2/),
      ['a4', 'ack']
    );
    expect(updated?.id).toBe('a4');
    expect(updated?.status).toBe('ack');

    const missing = await repo.updateStatus('missing', 'open' as any);
    expect(missing).toBeNull();
  });
});
