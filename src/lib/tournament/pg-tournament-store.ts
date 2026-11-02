import { getPool } from '../database/pool';
import type { TournamentState } from '../../types/tournament-management';
import type { TournamentStore } from './tournament-store';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tournaments in Postgres (src/lib/database/schema/tournaments.sql). */
export class PgTournamentStore implements TournamentStore {
  async insert(state: TournamentState): Promise<void> {
    await getPool().query(
      `INSERT INTO tournaments (id, name, status, created_by, state, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), to_timestamp($7 / 1000.0))`,
      [state.id, state.name, state.status, state.createdBy ?? null, JSON.stringify(state), state.createdAt, state.updatedAt]
    );
  }

  async get(id: string): Promise<TournamentState | null> {
    // A malformed id can't match, and Postgres would reject it as a UUID
    if (!UUID_RE.test(id)) return null;
    const result = await getPool().query(`SELECT state FROM tournaments WHERE id = $1`, [id]);
    return result.rows[0]?.state ?? null;
  }

  async update(id: string, apply: (t: TournamentState) => void): Promise<TournamentState> {
    if (!UUID_RE.test(id)) throw new Error('Tournament not found');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(`SELECT state FROM tournaments WHERE id = $1 FOR UPDATE`, [id]);
      const state: TournamentState | undefined = result.rows[0]?.state;
      if (!state) throw new Error('Tournament not found');
      apply(state);
      await client.query(
        `UPDATE tournaments SET state = $2, name = $3, status = $4, updated_at = to_timestamp($5 / 1000.0) WHERE id = $1`,
        [id, JSON.stringify(state), state.name, state.status, state.updatedAt]
      );
      await client.query('COMMIT');
      return state;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}
