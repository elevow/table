import {
  ACIDCompliance,
  BusinessRuleValidators,
  OptimisticConcurrencyControl,
  PessimisticConcurrencyControl,
  SagaPattern,
  DistributedLock,
} from '../../database/acid-compliance';
import type { TransactionContext, TransactionManager } from '../../database/transaction-manager';
import type { DatabaseClient } from '../../database/database-connection';

class MockClient implements DatabaseClient {
  calls: Array<{ text: string; params?: any[] }> = [];
  constructor(private handler: (text: string, params?: any[]) => any) {}
  async query(text: string, params?: any[]): Promise<{ rows: any[]; rowCount: number }> {
    this.calls.push({ text, params });
    const res = await this.handler(text, params);
    return res ?? { rows: [], rowCount: 0 };
  }
  release(): void {}
}

const makeContext = (client: DatabaseClient): TransactionContext => ({
  id: 'txn_test',
  client,
  config: {
    isolationLevel: 'read_committed',
    timeout: 1000,
    retryPolicy: { maxAttempts: 1, baseDelay: 1, backoffFactor: 2, jitter: false },
    autoCommit: false,
    readOnly: false,
  },
  startTime: new Date(),
  operations: [],
  status: 'active',
  savepoints: new Map(),
});

const fakeTM = (ctx: TransactionContext): TransactionManager => ({
  // Only the method we use in these tests
  async withTransaction<T>(op: (context: TransactionContext) => Promise<T>) {
    return op(ctx);
  },
} as unknown as TransactionManager);

describe('ACIDCompliance utilities - branches', () => {
  test('ensureAtomicity resolves all operation results and propagates error', async () => {
    const client = new MockClient(async () => ({ rows: [], rowCount: 0 }));
    const ctx = makeContext(client);
    const tm = fakeTM(ctx);

    const ops = [
      async () => 1,
      async () => 2,
      async () => 3,
    ];
    await expect(ACIDCompliance.ensureAtomicity(tm, ops)).resolves.toEqual([1, 2, 3]);

    const failing = [async () => 1, async () => { throw new Error('boom'); }];
    await expect(ACIDCompliance.ensureAtomicity(tm, failing)).rejects.toThrow('boom');
  });

  test('enforceConsistency aggregates violations and catches validator errors', async () => {
    const client = new MockClient(async () => ({ rows: [], rowCount: 0 }));
    const ctx = makeContext(client);

    const okValidator = { name: 'ok', validate: async () => ({ isValid: true, violations: [] }) };
    const badValidator = { name: 'bad', validate: async () => ({ isValid: false, violations: [{ rule: 'r', message: 'm', severity: 'error' as const }] }) };
    const throwValidator = { name: 'thrower', validate: async () => { throw new Error('fail'); } };

    const result = await ACIDCompliance.enforceConsistency(ctx, [okValidator, badValidator, throwValidator]);
    expect(result.isValid).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
    expect(result.violations.some(v => v.rule === 'thrower')).toBe(true);
  });

  test('verifyIsolation returns true on match, false on mismatch and on error', async () => {
    const clientOK = new MockClient(async (text) => {
      if (text.includes('SHOW transaction_isolation')) return { rows: [{ transaction_isolation: 'serializable' }], rowCount: 1 };
    });
    const clientMismatch = new MockClient(async () => ({ rows: [{ transaction_isolation: 'read committed' }], rowCount: 1 }));
    const clientError = new MockClient(async () => { throw new Error('db'); });

    const ctxOK = makeContext(clientOK);
    const ctxMismatch = makeContext(clientMismatch);
    const ctxError = makeContext(clientError);

    await expect(ACIDCompliance.verifyIsolation(ctxOK, 'serializable')).resolves.toBe(true);
    await expect(ACIDCompliance.verifyIsolation(ctxMismatch, 'serializable')).resolves.toBe(false);
    await expect(ACIDCompliance.verifyIsolation(ctxError, 'serializable')).resolves.toBe(false);
  });

  test('ensureDurability returns true when WAL and checks succeed; false on error', async () => {
    const clientOK = new MockClient(async (text) => {
      if (text.includes('pg_walfile_name')) return { rows: [{ ok: 1 }], rowCount: 1 };
      return { rows: [{ ok: 1 }], rowCount: 1 };
    });
    const clientFailWal = new MockClient(async (text) => {
      if (text.includes('pg_walfile_name')) throw new Error('wal fail');
      return { rows: [], rowCount: 0 };
    });
    const clientFailCheck = new MockClient(async (text) => {
      if (text.includes('pg_walfile_name')) return { rows: [{ ok: 1 }], rowCount: 1 };
      if (text.includes('check_bad')) throw new Error('bad');
      return { rows: [], rowCount: 0 };
    });

    await expect(ACIDCompliance.ensureDurability(makeContext(clientOK), ['check1'])).resolves.toBe(true);
    await expect(ACIDCompliance.ensureDurability(makeContext(clientFailWal), ['check1'])).resolves.toBe(false);
    await expect(ACIDCompliance.ensureDurability(makeContext(clientFailCheck), ['check_good', 'check_bad'])).resolves.toBe(false);
  });
});

describe('BusinessRuleValidators', () => {
  test('bankroll validator detects negative and large bankrolls and handles errors', async () => {
    // Case: both negative and large balances present
    const client = new MockClient(async (text, params) => {
      if ((text as string).includes('bankroll < 0')) {
        return { rows: [{ id: 1, username: 'alice', bankroll: -10 }], rowCount: 1 };
      }
      if ((text as string).includes('bankroll >')) {
        expect(params?.[0]).toBe(1000000);
        return { rows: [{ id: 2, username: 'bob', bankroll: 1500000 }], rowCount: 1 };
      }
    });
    const ctx = makeContext(client);
    const res = await BusinessRuleValidators.createBankrollValidator().validate(ctx);
    expect(res.isValid).toBe(false);
    expect(res.violations.some(v => v.rule === 'no_negative_bankroll')).toBe(true);
    expect(res.violations.some(v => v.rule === 'max_bankroll_limit' && v.severity === 'warning')).toBe(true);

    // Case: error path
    const clientErr = new MockClient(async () => { throw new Error('db'); });
    const resErr = await BusinessRuleValidators.createBankrollValidator().validate(makeContext(clientErr));
    expect(resErr.isValid).toBe(false);
    expect(resErr.violations.some(v => v.rule === 'validation_error')).toBe(true);
  });

  test('game state validator finds orphaned and invalid timestamp records and handles errors', async () => {
    const client = new MockClient(async (text) => {
      if ((text as string).includes('LEFT JOIN game_tables')) {
        return { rows: [{ id: 'gh1', table_id: 'tX' }], rowCount: 1 };
      }
      if ((text as string).includes('ended_at < started_at')) {
        return { rows: [{ id: 'g1', started_at: 's', ended_at: 'e' }], rowCount: 1 };
      }
    });
    const res = await BusinessRuleValidators.createGameStateValidator().validate(makeContext(client));
    expect(res.isValid).toBe(false);
    expect(res.violations.some(v => v.rule === 'no_orphaned_game_history')).toBe(true);
    expect(res.violations.some(v => v.rule === 'valid_timestamps')).toBe(true);

    const clientErr = new MockClient(async () => { throw new Error('db'); });
    const resErr = await BusinessRuleValidators.createGameStateValidator().validate(makeContext(clientErr));
    expect(resErr.isValid).toBe(false);
    expect(resErr.violations.some(v => v.rule === 'validation_error')).toBe(true);
  });

  test('referential integrity validator detects invalid references and handles errors', async () => {
    const client = new MockClient(async () => ({ rows: [{ id: 's1', player_id: 'pX' }], rowCount: 1 }));
    const res = await BusinessRuleValidators.createReferentialIntegrityValidator().validate(makeContext(client));
    expect(res.isValid).toBe(false);
    expect(res.violations.some(v => v.rule === 'valid_player_references')).toBe(true);

    const clientErr = new MockClient(async () => { throw new Error('db'); });
    const resErr = await BusinessRuleValidators.createReferentialIntegrityValidator().validate(makeContext(clientErr));
    expect(resErr.isValid).toBe(false);
    expect(resErr.violations.some(v => v.rule === 'validation_error')).toBe(true);
  });
});

describe('Concurrency controls', () => {
  test('Optimistic updateWithVersionCheck returns true/false and uses correct params', async () => {
    const clientTrue = new MockClient(async (text, params) => {
      expect(text).toContain('UPDATE users');
      expect(text).toContain('version = version + 1');
      expect(params?.[0]).toBe('id1');
      expect(params?.[1]).toBe(7);
      expect(params?.slice(2)).toEqual(['alice', 100]);
      return { rows: [{ version: 8 }], rowCount: 1 };
    });
    const ok = await OptimisticConcurrencyControl.updateWithVersionCheck(
      makeContext(clientTrue), 'users', 'id1', { username: 'alice', bankroll: 100 }, 7
    );
    expect(ok).toBe(true);

    const clientFalse = new MockClient(async () => ({ rows: [], rowCount: 0 }));
    const notOk = await OptimisticConcurrencyControl.updateWithVersionCheck(
      makeContext(clientFalse), 'users', 'id2', { username: 'bob' }, 1
    );
    expect(notOk).toBe(false);
  });

  test('Optimistic selectForUpdateWithVersion returns null or data+version', async () => {
    const clientEmpty = new MockClient(async () => ({ rows: [], rowCount: 0 }));
    const none = await OptimisticConcurrencyControl.selectForUpdateWithVersion(makeContext(clientEmpty), 'users', 'idX');
    expect(none).toBeNull();

    const clientRow = new MockClient(async () => ({ rows: [{ id: 'id1', username: 'a', version: 3 }], rowCount: 1 }));
    const got = await OptimisticConcurrencyControl.selectForUpdateWithVersion(makeContext(clientRow), 'users', 'id1');
    expect(got).toEqual({ data: { id: 'id1', username: 'a' }, version: 3 });
  });

  test('Pessimistic locks call expected SQL statements', async () => {
    const client = new MockClient(async (text) => {
      return { rows: [{ ok: 1 }], rowCount: 1 };
    });
    const ctx = makeContext(client);
    await PessimisticConcurrencyControl.lockRow(ctx, 'users', 'id1');
    await PessimisticConcurrencyControl.lockRowShared(ctx, 'users', 'id2');
    await PessimisticConcurrencyControl.lockTable(ctx, 'users', 'EXCLUSIVE');

    const texts = client.calls.map(c => c.text);
    expect(texts.some(t => t.includes('FOR UPDATE'))).toBe(true);
    expect(texts.some(t => t.includes('FOR SHARE'))).toBe(true);
    expect(texts.some(t => t.includes('LOCK TABLE users IN EXCLUSIVE MODE'))).toBe(true);
  });
});

describe('SagaPattern', () => {
  test('executes steps and compensates on failure in reverse order', async () => {
    const client = new MockClient(async () => ({ rows: [], rowCount: 0 }));
    const ctx = makeContext(client);
    const tm = fakeTM(ctx);
    const saga = new SagaPattern();
    const comp1 = jest.fn(async () => {});
    const comp2 = jest.fn(async () => {});

    saga.addStep({ name: 's1', execute: async () => 'r1' });
    saga.registerCompensation('s1', comp1);
  saga.addStep({ name: 's2', execute: async () => { throw new Error('boom'); } });
    saga.registerCompensation('s2', comp2);

    await expect(saga.execute(tm)).rejects.toThrow('boom');
  // Only previously executed steps are compensated, in reverse order
  expect(comp2).not.toHaveBeenCalled();
  expect(comp1).toHaveBeenCalled();
  });

  test('executes all steps successfully', async () => {
    const client = new MockClient(async () => ({ rows: [], rowCount: 0 }));
    const ctx = makeContext(client);
    const tm = fakeTM(ctx);
    const saga = new SagaPattern();
    saga.addStep({ name: 's1', execute: async () => 'r1' });
    saga.addStep({ name: 's2', execute: async () => 'r2' });
    await expect(saga.execute(tm)).resolves.toEqual(['r1', 'r2']);
  });
});

describe('DistributedLock', () => {
  test('acquire/release return flags from db', async () => {
    const client = new MockClient(async (text) => {
      if ((text as string).includes('pg_try_advisory_lock')) {
        return { rows: [{ pg_try_advisory_lock: true }], rowCount: 1 };
      }
      if ((text as string).includes('pg_advisory_unlock')) {
        return { rows: [{ pg_advisory_unlock: false }], rowCount: 1 };
      }
    });
    const ctx = makeContext(client);
    await expect(DistributedLock.acquire(ctx, 'abc')).resolves.toBe(true);
    await expect(DistributedLock.release(ctx, 'abc')).resolves.toBe(false);
  });
});
