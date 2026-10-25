import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../../../src/lib/database/pool';
import { getAuthenticatedUserId } from '../../../src/lib/auth/auth-utils';
import { NOTE_COLORS } from '../../../src/lib/shared/note-colors';
const MAX_NOTE_LENGTH = 2000;

/**
 * Private player notes. Only the signed-in owner ever reads or writes their notes.
 *
 * GET  /api/notes?subjects=id1,id2   -> { notes: { [subjectId]: { note, color } } }
 * PUT  /api/notes { subjectId, note, color } -> saves; an empty note with no color deletes it
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return res.status(401).json({ error: 'Authentication required' });

  try {
    if (req.method === 'GET') {
      const subjects = String(req.query.subjects || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .slice(0, 50);
      if (subjects.length === 0) return res.status(200).json({ notes: {} });
      const result = await getPool().query(
        'SELECT subject_id, note, color FROM player_notes WHERE owner_id = $1 AND subject_id = ANY($2::text[])',
        [ownerId, subjects]
      );
      const notes: Record<string, { note: string; color: string | null }> = {};
      result.rows.forEach((r: any) => { notes[r.subject_id] = { note: r.note, color: r.color }; });
      return res.status(200).json({ notes });
    }

    if (req.method === 'PUT') {
      const { subjectId, note, color } = (req.body || {}) as { subjectId?: string; note?: string; color?: string | null };
      if (!subjectId || typeof subjectId !== 'string') return res.status(400).json({ error: 'Missing subjectId' });
      if (subjectId === ownerId) return res.status(400).json({ error: 'Notes are for other players' });
      const text = typeof note === 'string' ? note.slice(0, MAX_NOTE_LENGTH) : '';
      const tag = color && (NOTE_COLORS as readonly string[]).includes(color) ? color : null;
      if (!text.trim() && !tag) {
        await getPool().query('DELETE FROM player_notes WHERE owner_id = $1 AND subject_id = $2', [ownerId, subjectId]);
        return res.status(200).json({ ok: true, deleted: true });
      }
      await getPool().query(
        `INSERT INTO player_notes (owner_id, subject_id, note, color, updated_at) VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (owner_id, subject_id) DO UPDATE SET note = EXCLUDED.note, color = EXCLUDED.color, updated_at = NOW()`,
        [ownerId, subjectId, text, tag]
      );
      return res.status(200).json({ ok: true, note: text, color: tag });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Error handling notes:', err);
    return res.status(500).json({ error: 'Unable to save notes' });
  }
}
