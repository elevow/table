import { studCardOrder } from '../stud-cards';

describe('studCardOrder', () => {
  it('puts the seventh street card last, not third', () => {
    expect(studCardOrder(['d1', 'd2', 'd7'], ['u3', 'u4', 'u5', 'u6'])).toEqual(['d1', 'd2', 'u3', 'u4', 'u5', 'u6', 'd7']);
  });

  it('keeps the down cards first before seventh street', () => {
    expect(studCardOrder(['d1', 'd2'], ['u3'])).toEqual(['d1', 'd2', 'u3']);
  });

  it('leads with the single down card in five-card stud', () => {
    expect(studCardOrder(['d1'], ['u2', 'u3', 'u4', 'u5'])).toEqual(['d1', 'u2', 'u3', 'u4', 'u5']);
  });

  it('handles a hand with no down cards', () => {
    expect(studCardOrder([], ['u1'])).toEqual(['u1']);
  });
});
