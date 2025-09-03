import { v4 as uuidv4 } from 'uuid';
import type { CollusionDetection, BettingPattern, PlayerGrouping, FoldingPattern, ChipDumpingMetric, SecurityAlert } from '../../types/collusion';
import type { PlayerAction } from '../../types/poker';

export interface HandSummary {
  handId: string;
  players: string[];
  actions: PlayerAction[]; // ordered by time
  winners?: string[];
  pot?: number;
}

export interface AnalyzeInput {
  hands: HandSummary[];
}

export class CollusionAnalyzer {
  analyze(input: AnalyzeInput): CollusionDetection {
    const betting = this.analyzeBetting(input.hands);
    const grouping = this.analyzeGrouping(input.hands);
    const folding = this.analyzeFolding(input.hands);
    const chipDumping = this.analyzeChipDumping(input.hands);

    const alerts: SecurityAlert[] = [];
    for (const p of betting.filter(b => b.suspicious)) {
      alerts.push({ id: uuidv4(), type: 'betting', severity: 'low', message: `Unusual aggression for ${p.playerId}`, at: Date.now(), involved: [p.playerId] });
    }
    for (const g of grouping.filter(g => g.suspicious)) {
      alerts.push({ id: uuidv4(), type: 'grouping', severity: 'medium', message: `Frequent co-play: ${g.players[0]} & ${g.players[1]}`, at: Date.now(), involved: [...g.players] });
    }
    for (const f of folding.filter(f => f.suspicious)) {
      alerts.push({ id: uuidv4(), type: 'folding', severity: 'medium', message: `High fold-to-agg: ${f.target} vs ${f.vsPlayer}`, at: Date.now(), involved: [f.target, f.vsPlayer] });
    }
    for (const c of chipDumping.filter(c => c.suspicious)) {
      alerts.push({ id: uuidv4(), type: 'chip-dump', severity: 'high', message: `Chip flow ${c.from} -> ${c.to}: ${c.totalAmount}`, at: Date.now(), involved: [c.from, c.to] });
    }

    const suspicionSignals = alerts.length;
    const confidence = Math.min(1, suspicionSignals / 10);

    return {
      patterns: { betting, grouping, folding, chipDumping },
      alerts,
      confidence,
      evidence: [{ type: 'summary', description: 'Aggregated heuristics', data: { signals: suspicionSignals } }],
    };
  }

  private analyzeBetting(hands: HandSummary[]): BettingPattern[] {
    const stats = new Map<string, { hands: number; vpip: number; raises: number; calls: number; bets: number }>();
    for (const h of hands) {
      const seen = new Set<string>();
      for (const p of h.players) {
        const s = stats.get(p) || { hands: 0, vpip: 0, raises: 0, calls: 0, bets: 0 };
        if (!seen.has(p)) { s.hands += 1; seen.add(p); }
        stats.set(p, s);
      }
      for (const a of h.actions) {
        const s = stats.get(a.playerId) || { hands: 0, vpip: 0, raises: 0, calls: 0, bets: 0 };
        if (['bet', 'raise', 'call'].includes(a.type)) s.vpip += 1;
        if (a.type === 'raise') s.raises += 1;
        if (a.type === 'bet') s.bets += 1;
        if (a.type === 'call') s.calls += 1;
        stats.set(a.playerId, s);
      }
    }
    const patterns: BettingPattern[] = [];
    for (const [playerId, s] of stats.entries()) {
      const vpip = s.hands ? s.vpip / s.hands : 0;
      const pfr = s.hands ? s.raises / s.hands : 0;
      const calls = s.calls || 1;
      const aggression = (s.bets + s.raises) / calls;
      const suspicious = (vpip < 0.05 && pfr > 0.3) || aggression > 3.5;
      patterns.push({ playerId, hands: s.hands, vpip, pfr, aggression, suspicious });
    }
    return patterns;
  }

  private analyzeGrouping(hands: HandSummary[]): PlayerGrouping[] {
    const pairCounts = new Map<string, { pair: [string, string]; count: number }>();
    const totalHandsByPlayer = new Map<string, number>();
    for (const h of hands) {
      for (const p of h.players) totalHandsByPlayer.set(p, (totalHandsByPlayer.get(p) || 0) + 1);
      for (let i = 0; i < h.players.length; i++) {
        for (let j = i + 1; j < h.players.length; j++) {
          const a = h.players[i], b = h.players[j];
          const key = [a, b].sort().join('|');
          const rec = pairCounts.get(key) || { pair: [a, b].sort() as [string, string], count: 0 };
          rec.count += 1;
          pairCounts.set(key, rec);
        }
      }
    }
    const out: PlayerGrouping[] = [];
    for (const { pair, count } of pairCounts.values()) {
      const maxHands = Math.max(totalHandsByPlayer.get(pair[0]) || 1, totalHandsByPlayer.get(pair[1]) || 1);
      const ratio = count / maxHands;
      const suspicious = count >= 10 && ratio > 0.6; // frequently at same tables/hands
      out.push({ players: pair, coHands: count, ratio, suspicious, reason: suspicious ? 'High co-play ratio' : undefined });
    }
    return out;
  }

  private analyzeFolding(hands: HandSummary[]): FoldingPattern[] {
    const map = new Map<string, { opps: number; folds: number }>();
    for (const h of hands) {
      // Very rough: if player B bets/raises and player A folds later in same street
      for (const a of h.actions) {
        if (a.type === 'bet' || a.type === 'raise') {
          for (const b of h.actions) {
            if (b.playerId !== a.playerId && b.type === 'fold') {
              const key = `${b.playerId}|${a.playerId}`;
              const rec = map.get(key) || { opps: 0, folds: 0 };
              rec.opps += 1; rec.folds += 1;
              map.set(key, rec);
            }
          }
        }
      }
    }
    const out: FoldingPattern[] = [];
    for (const [key, rec] of map.entries()) {
      const [target, vsPlayer] = key.split('|');
      const foldToAggPct = rec.opps ? rec.folds / rec.opps : 0;
      const suspicious = rec.opps >= 8 && foldToAggPct > 0.85;
      out.push({ target, vsPlayer, opportunities: rec.opps, foldToAggPct, suspicious });
    }
    return out;
  }

  private analyzeChipDumping(hands: HandSummary[]): ChipDumpingMetric[] {
    const flows = new Map<string, { amount: number; count: number }>();
    for (const h of hands) {
      if (!h.winners || h.winners.length !== 1) continue;
      const to = h.winners[0];
      // Estimate contributions per player based on action amounts
      const contrib = new Map<string, number>();
      for (const a of h.actions) {
        if (['bet', 'raise', 'call'].includes(a.type)) {
          const amt = typeof a.amount === 'number' ? a.amount : 0;
          contrib.set(a.playerId, (contrib.get(a.playerId) || 0) + amt);
        }
      }
      // Find top contributor who is not the winner
      let from: string | null = null;
      let maxAmt = 0;
      for (const [pid, amt] of contrib.entries()) {
        if (pid === to) continue;
        if (amt > maxAmt) { maxAmt = amt; from = pid; }
      }
      if (!from || maxAmt <= 0) continue;
      const pot = h.pot || Array.from(contrib.values()).reduce((s, v) => s + v, 0);
      const concentration = pot > 0 ? maxAmt / pot : 0;
      if (concentration >= 0.7 && pot >= 300) {
        const key = `${from}|${to}`;
        const rec = flows.get(key) || { amount: 0, count: 0 };
        rec.amount += pot; rec.count += 1;
        flows.set(key, rec);
      }
    }
    const out: ChipDumpingMetric[] = [];
    for (const [key, rec] of flows.entries()) {
      const [from, to] = key.split('|');
      const suspicious = rec.count >= 3 && rec.amount >= 1000;
      out.push({ from, to, totalAmount: rec.amount, occurrences: rec.count, suspicious, reason: suspicious ? 'Repeated large unilateral transfers' : undefined });
    }
    return out;
  }
}
