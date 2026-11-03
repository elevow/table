import {
  addLevel, addPayoutPlace, formatMinutes, levelStartMinutes, niceAmount, normalizeLevels, removeLastPayoutPlace,
  removeLevel, setBreak, setPayoutPercentage, updateLevel,
} from '../structure-editor';
import { createRebuyAddOnConfig, createDefaultFreezeoutConfig, validateTournamentConfig } from '../tournament-utils';

// Rebuy preset: levels 1-5 of 12 minutes, break after 3, rebuys until 4, add-on at the break after 3, late reg until 5
const rebuyConfig = () => createRebuyAddOnConfig();

describe('structure editor', () => {
  test('addLevel continues the schedule with chip-friendly blinds', () => {
    const cfg = addLevel(createDefaultFreezeoutConfig()); // last level 400/800 ante 100, 12 minutes
    expect(cfg.blindLevels[4]).toEqual({ level: 5, durationMinutes: 12, smallBlind: 600, bigBlind: 1200, ante: 150 });
    expect(validateTournamentConfig(cfg).valid).toBe(true);
  });

  test('removeLevel renumbers and moves breaks and level references with their levels', () => {
    const cfg = removeLevel(rebuyConfig(), 0);
    expect(cfg.blindLevels.map(l => [l.level, l.bigBlind])).toEqual([[1, 400], [2, 600], [3, 800], [4, 1200]]);
    expect(cfg.breaks).toEqual([{ afterLevel: 2, durationMinutes: 10 }]);
    expect(cfg.addOn!.availableAtBreakAfterLevel).toBe(2);
    expect(cfg.rebuys!.availableUntilLevel).toBe(3);
    expect(cfg.lateRegistration.endLevel).toBe(4);
    expect(validateTournamentConfig(cfg).valid).toBe(true);
  });

  test('removing the level before a break takes the break, and the add-on needs a new one', () => {
    const cfg = removeLevel(rebuyConfig(), 2);
    expect(cfg.breaks).toEqual([]);
    expect(cfg.addOn!.availableAtBreakAfterLevel).toBeUndefined();
    expect(validateTournamentConfig(cfg).errors).toContain('Choose the break the add-on is offered at');
  });

  test('a break that would follow the new last level is dropped', () => {
    const base = setBreak(createDefaultFreezeoutConfig(), 3, 5); // breaks after 2 and 3 of 4
    const cfg = removeLevel(base, 3);
    expect(cfg.breaks.map(b => b.afterLevel)).toEqual([2]);
    expect(validateTournamentConfig(cfg).valid).toBe(true);
  });

  test('level references never fall below level 1', () => {
    const cfg = createDefaultFreezeoutConfig();
    cfg.lateRegistration.endLevel = 1;
    expect(removeLevel(cfg, 0).lateRegistration.endLevel).toBe(1);
  });

  test('normalizeLevels renumbers a schedule from 1 keeping its breaks in place', () => {
    const cfg = createDefaultFreezeoutConfig();
    cfg.blindLevels = cfg.blindLevels.map(l => ({ ...l, level: l.level * 10 }));
    cfg.breaks = [{ afterLevel: 20, durationMinutes: 10 }];
    cfg.lateRegistration.endLevel = 40;
    const out = normalizeLevels(cfg);
    expect(out.blindLevels.map(l => l.level)).toEqual([1, 2, 3, 4]);
    expect(out.breaks).toEqual([{ afterLevel: 2, durationMinutes: 10 }]);
    expect(out.lateRegistration.endLevel).toBe(4);
  });

  test('updateLevel changes one level and drops an emptied ante', () => {
    const cfg = updateLevel(createDefaultFreezeoutConfig(), 2, { smallBlind: 350, ante: undefined });
    expect(cfg.blindLevels[2]).toEqual({ level: 3, durationMinutes: 12, smallBlind: 350, bigBlind: 600 });
  });

  test('setBreak adds, changes and removes breaks, and removing the add-on break clears the add-on choice', () => {
    let cfg = setBreak(rebuyConfig(), 1, 5);
    expect(cfg.breaks.map(b => [b.afterLevel, b.durationMinutes])).toEqual([[1, 5], [3, 10]]);
    cfg = setBreak(cfg, 1, 15);
    expect(cfg.breaks[0].durationMinutes).toBe(15);
    cfg = setBreak(cfg, 3, null);
    expect(cfg.breaks.map(b => b.afterLevel)).toEqual([1]);
    expect(cfg.addOn!.availableAtBreakAfterLevel).toBeUndefined();
  });

  test('levelStartMinutes counts levels and the breaks between them', () => {
    // 12-minute levels with a 10-minute break after level 2
    expect(levelStartMinutes(createDefaultFreezeoutConfig())).toEqual([0, 12, 34, 46]);
    expect(formatMinutes(0)).toBe('0:00');
    expect(formatMinutes(85)).toBe('1:25');
  });

  test('payout places can be added, set and removed', () => {
    let cfg = addPayoutPlace(createDefaultFreezeoutConfig());
    expect(cfg.payoutStructure[3]).toEqual({ place: 4, percentage: 0 });
    cfg = setPayoutPercentage(cfg, 4, 5);
    expect(cfg.payoutStructure[3].percentage).toBe(5);
    expect(removeLastPayoutPlace(cfg).payoutStructure).toHaveLength(3);
  });

  test.each([[150, 150], [375, 400], [1100, 1200], [1300, 1500], [0.7, 0.8], [45, 50], [9000, 10000]])('niceAmount(%p) is %p', (n, nice) => {
    expect(niceAmount(n)).toBe(nice);
  });

  test('editing never changes the config passed in', () => {
    const cfg = rebuyConfig();
    const before = JSON.stringify(cfg);
    addLevel(cfg); removeLevel(cfg, 1); updateLevel(cfg, 0, { ante: 5 }); setBreak(cfg, 1, 5); addPayoutPlace(cfg);
    expect(JSON.stringify(cfg)).toBe(before);
  });
});
