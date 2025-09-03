import { CollusionAnalyzer } from '../collusion-analyzer';

describe('CollusionAnalyzer (US-060)', () => {
  it('detects grouping and betting anomalies', () => {
    const analyzer = new CollusionAnalyzer();
    const hands = Array.from({ length: 12 }).map((_, i) => ({
      handId: `h${i}`,
      players: ['a', 'b', 'c'],
      actions: [
        { type: 'bet', playerId: 'a', tableId: 't', amount: 100, timestamp: i },
        { type: 'fold', playerId: 'c', tableId: 't', timestamp: i + 1 },
      ],
      winners: ['b'],
      pot: 100,
    }));
    const report = analyzer.analyze({ hands } as any);
    expect(report.patterns.grouping.find(g => g.players.includes('a') && g.players.includes('b'))).toBeDefined();
    expect(report.alerts.length).toBeGreaterThanOrEqual(1);
  });

  it('flags potential chip dumping with concentrated transfers', () => {
    const analyzer = new CollusionAnalyzer();
    const makeHand = (i: number) => ({
      handId: `d${i}`,
      players: ['x', 'y'],
      actions: [
        { type: 'bet', playerId: 'x', tableId: 't', amount: 400, timestamp: i },
        { type: 'call', playerId: 'y', tableId: 't', amount: 50, timestamp: i + 1 },
      ],
      winners: ['y'],
      pot: 500,
    });
    const report = analyzer.analyze({ hands: [makeHand(1), makeHand(2), makeHand(3), makeHand(4)] } as any);
    const dump = report.patterns.chipDumping.find(c => c.from === 'x' && c.to === 'y');
    expect(dump).toBeDefined();
    expect(report.alerts.some(a => a.type === 'chip-dump')).toBe(true);
  });
});
