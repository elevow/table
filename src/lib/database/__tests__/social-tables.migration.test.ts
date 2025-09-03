import { SOCIAL_TABLES as cfg } from '../migrations/social-tables';

describe('social tables migration', () => {
  it('describes tables and steps', () => {
    expect(cfg.description).toMatch(/social_shares and social_engagement/i);
    const createShares = cfg.steps.find(s => (s as any).table === 'social_shares');
    const createEng = cfg.steps.find(s => (s as any).table === 'social_engagement');
    expect(createShares).toBeTruthy();
    expect(createEng).toBeTruthy();
    expect((createShares as any).details.sql).toContain('CREATE TABLE IF NOT EXISTS social_shares');
    expect((createEng as any).details.sql).toContain('CREATE TABLE IF NOT EXISTS social_engagement');
  });

  it('has post checks and rollback', () => {
    const names = cfg.postChecks?.map(p => p.name) || [];
    expect(names).toEqual(expect.arrayContaining(['social_shares_exists', 'social_engagement_exists']));
    expect(cfg.rollback?.length).toBeGreaterThanOrEqual(2);
  });
});
