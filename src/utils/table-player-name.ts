/**
 * The name to show for the signed-in player at a table: the name they chose in Account Settings,
 * otherwise their account username, otherwise the fallback.
 */
export function tablePlayerName(fallback: string): string {
  try {
    const chosen = localStorage.getItem('playerName')?.trim();
    if (chosen) return chosen;
    const raw = localStorage.getItem('user');
    const username = raw ? JSON.parse(raw)?.username : null;
    if (typeof username === 'string' && username.trim()) return username.trim();
  } catch {
    /* storage blocked or the saved user is not valid JSON */
  }
  return fallback;
}
