// Who wrote each table chat message, and who at the table can't be muted. Muting is each viewer's
// own choice and happens in their browser; the server only says whose messages can't be hidden.
import { getPool } from '../database/pool';
import { loadPlayerNames } from '../tournament/pg-tournament-store';
import type { ChatMessage } from '../../types/chat';

/** The messages with each sender's username, where the sender is a known user. */
export async function withSenderNames<T extends ChatMessage>(messages: T[]): Promise<T[]> {
  const names: Record<string, string> = await Promise.resolve()
    .then(() => loadPlayerNames(messages.map(m => m.senderId)))
    .then(n => n || {}, () => ({}));
  return messages.map(m => (names[m.senderId] ? { ...m, senderName: names[m.senderId] } : m));
}

/** The director of the tournament this table belongs to, whom players can't mute; null for other tables. */
export async function tableDirectorId(room: { configuration?: unknown } | null): Promise<string | null> {
  // Tournament tables carry their tournament's ID (see tournamentTableOf, kept out of chat's imports)
  const config = room?.configuration && typeof room.configuration === 'object' ? room.configuration as Record<string, unknown> : {};
  if (typeof config.tournamentId !== 'string' || typeof config.tournamentTableId !== 'string') return null;
  const result = await getPool()
    .query(`SELECT state->>'createdBy' AS director FROM tournaments WHERE id::text = $1`, [config.tournamentId])
    .catch(() => null);
  return result?.rows?.[0]?.director ?? null;
}
