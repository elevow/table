import { DataTransformationService, SchemaDefinition, DataTransformation } from '../data-transformation-service';
import { TransactionManager } from '../transaction-manager';

// In-memory TransactionManager mock
const mockTx = {
  withTransaction: jest.fn().mockImplementation(async (cb) => {
    const ctx = { client: { query: jest.fn().mockResolvedValue({ rows: [{ cnt: 0 }], rowCount: 0 }) } };
    return cb(ctx);
  })
} as unknown as TransactionManager;

const sourceSchema: SchemaDefinition = {
  name: 'players_v1',
  columns: [
    { name: 'id', type: 'INTEGER', primaryKey: true },
    { name: 'username', type: 'TEXT' },
    { name: 'email', type: 'TEXT' }
  ]
};

const targetSchema: SchemaDefinition = {
  name: 'players_v2',
  columns: [
    { name: 'id', type: 'INTEGER', primaryKey: true },
    { name: 'username', type: 'TEXT' },
    { name: 'email_lower', type: 'TEXT' }
  ]
};

describe('DataTransformationService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('plans schema changes and data steps', () => {
    const svc = new DataTransformationService(mockTx);
    const t: DataTransformation = {
      source: { table: 'players_v1', version: '1', schema: sourceSchema },
      target: { table: 'players_v2', version: '2', schema: targetSchema },
      mapping: [
        { source: 'id', target: 'id' },
        { source: 'username', target: 'username' },
        { source: 'email', target: 'email_lower', transform: 'LOWER(s.email)' }
      ],
      validation: []
    };

    const plan = svc.plan(t);
    expect(plan.schemaChanges.length).toBe(0);
    expect(plan.dataSteps[0].sql).toContain('INSERT INTO players_v2 (id, username, email_lower)');
    expect(plan.dataSteps[0].sql).toContain('SELECT s.id, s.username, LOWER(s.email)');
    expect(plan.dataSteps[0].sql).toContain('LIMIT {LIMIT} OFFSET {OFFSET}');
  });

  it('executes plan with batch replacements and validation', async () => {
    const svc = new DataTransformationService(mockTx);
    const t: DataTransformation = {
      source: { table: 'players_v1', version: '1', schema: sourceSchema },
      target: { table: 'players_v2', version: '2', schema: targetSchema },
      mapping: [
        { source: 'id', target: 'id' },
        { source: 'username', target: 'username' },
        { source: 'email', target: 'email_lower', transform: 'LOWER(s.email)' }
      ],
      validation: [
        { name: 'count_check', sql: 'SELECT 0 as cnt', expected: { cnt: 0 } }
      ]
    };

    const res = await svc.execute(t, { batchSize: 500, offset: 100, validate: true });
    expect(res.executed).toBe(true);
    // ensure replacements applied
    const lastCall = (mockTx.withTransaction as jest.Mock).mock.calls.pop();
    const queryCalled = lastCall?.[0];
    const ctx = { client: { query: jest.fn() } } as any;
    await queryCalled(ctx);
    expect(ctx.client.query).toHaveBeenCalled();
  });

  it('fails when validation detects an error', async () => {
    const failingTx = {
      withTransaction: jest.fn().mockImplementation(async (cb) => {
        const ctx = { client: { query: jest.fn().mockResolvedValue({ rows: [{ cnt: 1 }], rowCount: 1 }) } };
        return cb(ctx);
      })
    } as unknown as TransactionManager;

    const svc = new DataTransformationService(failingTx);
    const t: DataTransformation = {
      source: { table: 'players_v1', version: '1', schema: sourceSchema },
      target: { table: 'players_v2', version: '2', schema: targetSchema },
      mapping: [ { source: 'id', target: 'id' } ],
      validation: [ { name: 'nonzero', sql: 'SELECT 1 as cnt', expected: { cnt: 0 } } ]
    };

    await expect(svc.execute(t, { validate: true })).rejects.toThrow('Validation failed: nonzero');
  });
});
