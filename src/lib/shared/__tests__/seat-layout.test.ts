import { NARROW_INFO_GAP_PX, isCentreSeat, narrowInfoBoxStyle, seatPlateStyle } from '../seat-layout';

describe('narrowInfoBoxStyle', () => {
  it('puts the box above seats in the top half', () => {
    expect(narrowInfoBoxStyle({ left: '50%', top: '2%' })).toMatchObject({
      left: '50%',
      top: `calc(2% - ${NARROW_INFO_GAP_PX}px)`,
      transform: 'translate(-50%, -100%)',
      pointerEvents: 'none',
    });
  });

  it('puts the box below seats in the bottom half, including our own seat under the table', () => {
    expect(narrowInfoBoxStyle({ left: '50%', top: '104%' })).toMatchObject({
      top: `calc(104% + ${NARROW_INFO_GAP_PX}px)`,
      transform: 'translate(-50%, 0)',
    });
  });

  it('shifts boxes near the sides inwards', () => {
    expect(narrowInfoBoxStyle({ left: '-2%', top: '50%' }).transform).toBe('translate(-25%, 0)');
    expect(narrowInfoBoxStyle({ left: '96.5%', top: '30%' }).transform).toBe('translate(-75%, -100%)');
  });

  it('falls back to under the seat without coordinates', () => {
    expect(narrowInfoBoxStyle(undefined)).toMatchObject({ left: '50%', top: '100%' });
    expect(narrowInfoBoxStyle({ left: 'auto', top: '10%' })).toMatchObject({ left: '50%', top: '100%' });
  });
});

describe('seatPlateStyle', () => {
  it('puts the plate left of the avatar for the top and bottom seats', () => {
    // The top seat's angle leaves it a hair off 50%
    expect(seatPlateStyle({ left: '49.99999999999999%', top: '2%' }, 40)).toMatchObject({
      left: 'calc(49.99999999999999% - 40px)',
      top: '2%',
      transform: 'translate(-100%, -50%)',
    });
    expect(seatPlateStyle({ left: '50%', top: '104%' }, 40)).toMatchObject({ left: 'calc(50% - 40px)', top: '104%' });
  });

  it('puts the plate under the avatar for the seats around the sides', () => {
    expect(seatPlateStyle({ left: '32%', top: '5%' }, 40)).toMatchObject({ left: '32%', top: 'calc(5% + 40px)', transform: 'translate(-50%, 0)' });
  });

  it('keeps plates near the edges on screen', () => {
    expect(seatPlateStyle({ left: '5%', top: '26%' }, 40).transform).toBe('translate(-25%, 0)');
    expect(seatPlateStyle({ left: '95%', top: '26%' }, 40).transform).toBe('translate(-75%, 0)');
  });

  it('falls back to below the seat without coordinates', () => {
    expect(seatPlateStyle(undefined, 40)).toMatchObject({ left: '50%', top: '100%' });
  });
});

describe('isCentreSeat', () => {
  it('picks out the top and bottom seats only', () => {
    expect(isCentreSeat({ left: '50%', top: '104%' })).toBe(true);
    expect(isCentreSeat({ left: '50.00000000000001%', top: '2%' })).toBe(true);
    expect(isCentreSeat({ left: '32.2%', top: '4%' })).toBe(false);
    expect(isCentreSeat(undefined)).toBe(false);
  });
});
