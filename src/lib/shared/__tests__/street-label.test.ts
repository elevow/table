import { streetLabel } from '../hand-replay';

describe('streetLabel', () => {
  test('five-card stud starts on 2nd street and ends on 5th', () => {
    expect(['third', 'fourth', 'fifth', 'sixth'].map(s => streetLabel(s as any, 'five-card-stud')))
      .toEqual(['2nd street', '3rd street', '4th street', '5th street']);
  });

  test('seven-card stud and razz keep 3rd to 7th street', () => {
    expect(streetLabel('third', 'seven-card-stud')).toBe('3rd street');
    expect(streetLabel('seventh', 'razz')).toBe('7th street');
  });

  test('board games, and hands with no variant recorded', () => {
    expect(streetLabel('flop', 'texas-holdem')).toBe('Flop');
    expect(streetLabel('preflop')).toBe('Preflop');
    expect(streetLabel('showdown', 'five-card-stud')).toBe('Showdown');
  });
});
