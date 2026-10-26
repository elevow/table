/** Quick reactions a seated player can show over their seat. */
export const TABLE_REACTIONS = ['👍', '😂', '😮', '😡', '🔥', 'GG'] as const;

export type TableReaction = typeof TABLE_REACTIONS[number];

/** How long a reaction bubble stays over the seat. */
export const REACTION_SHOW_MS = 3000;

/** One reaction per player per this many ms (the server enforces it; the client waits too). */
export const REACTION_COOLDOWN_MS = 2000;

/** localStorage key for hiding other players' reactions. */
export const REACTIONS_MUTED_KEY = 'tableReactionsMuted';

export function isTableReaction(value: unknown): value is TableReaction {
  return typeof value === 'string' && (TABLE_REACTIONS as readonly string[]).includes(value);
}
