import { getPool } from '../database/pool';

export type LedgerKind = 'buy_in' | 'rebuy' | 'cash_out';

export interface LedgerEntry {
  playerId: string;
  playerName: string | null;
  kind: LedgerKind;
  amount: number;
  createdAt: string;
}

export interface LedgerLine {
  playerId: string;
  playerName: string;
  boughtIn: number;
  cashedOut: number;
  // Chips still in play at the table
  onTable: number;
  net: number;
}

/** Record chips coming to or leaving the table. Never fails the caller: the ledger is a report. */
export async function recordLedger(entry: {
  roomId: string;
  playerId: string;
  playerName?: string | null;
  kind: LedgerKind;
  amount: number;
}): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO chip_ledger (room_id, player_id, player_name, kind, amount) VALUES ($1, $2, $3, $4, $5)`,
      [entry.roomId, entry.playerId, entry.playerName ?? null, entry.kind, entry.amount]
    );
  } catch (err) {
    console.warn('[chip-ledger] Failed to record entry:', err);
  }
}

export async function loadLedger(roomId: string): Promise<LedgerEntry[]> {
  const result = await getPool().query(
    `SELECT player_id, player_name, kind, amount, created_at FROM chip_ledger WHERE room_id = $1 ORDER BY created_at`,
    [roomId]
  );
  return result.rows.map((r: any) => ({
    playerId: r.player_id,
    playerName: r.player_name,
    kind: r.kind,
    amount: Number(r.amount),
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

/**
 * Per-player settlement: what they brought, what they took away, what is still in front of them
 * and the difference. `onTable` maps players still in the game to their current stacks.
 */
export function summarizeLedger(entries: LedgerEntry[], onTable: Map<string, { name: string; stack: number }>): LedgerLine[] {
  const lines = new Map<string, LedgerLine>();
  const line = (playerId: string, name?: string | null) => {
    let l = lines.get(playerId);
    if (!l) {
      l = { playerId, playerName: name || playerId.slice(0, 6), boughtIn: 0, cashedOut: 0, onTable: 0, net: 0 };
      lines.set(playerId, l);
    }
    if (name) l.playerName = name;
    return l;
  };
  for (const e of entries) {
    const l = line(e.playerId, e.playerName);
    if (e.kind === 'cash_out') l.cashedOut += e.amount;
    else l.boughtIn += e.amount;
  }
  onTable.forEach((p, playerId) => {
    line(playerId, p.name).onTable = p.stack;
  });
  const result = Array.from(lines.values());
  result.forEach(l => { l.net = l.cashedOut + l.onTable - l.boughtIn; });
  return result.sort((a, b) => b.net - a.net);
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function ledgerToCsv(lines: LedgerLine[]): string {
  const header = ['Player', 'Bought in', 'Cashed out', 'On table', 'Net'];
  const rows = lines.map(l => [l.playerName, l.boughtIn, l.cashedOut, l.onTable, l.net]);
  return [header, ...rows].map(r => r.map(csvCell).join(',')).join('\n') + '\n';
}

/**
 * Who pays whom to settle up, with as few payments as possible (largest loser pays largest
 * winner first).
 */
export function settlementPayments(lines: LedgerLine[]): Array<{ from: string; to: string; amount: number }> {
  const losers = lines.filter(l => l.net < 0).map(l => ({ name: l.playerName, owe: -l.net })).sort((a, b) => b.owe - a.owe);
  const winners = lines.filter(l => l.net > 0).map(l => ({ name: l.playerName, due: l.net })).sort((a, b) => b.due - a.due);
  const payments: Array<{ from: string; to: string; amount: number }> = [];
  let i = 0;
  let j = 0;
  while (i < losers.length && j < winners.length) {
    const amount = Math.min(losers[i].owe, winners[j].due);
    if (amount > 0) payments.push({ from: losers[i].name, to: winners[j].name, amount });
    losers[i].owe -= amount;
    winners[j].due -= amount;
    if (losers[i].owe <= 0) i++;
    if (winners[j].due <= 0) j++;
  }
  return payments;
}
