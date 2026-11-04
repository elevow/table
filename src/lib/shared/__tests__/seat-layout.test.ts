import { NARROW_INFO_GAP_PX, narrowInfoBoxStyle, seatPlateStyle } from '../seat-layout';

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
  it('puts the plate under the avatar for every seat', () => {
    expect(seatPlateStyle({ left: '50%', top: '2%' }, 40)).toMatchObject({ left: '50%', top: 'calc(2% + 40px)', transform: 'translate(-50%, 0)' });
    expect(seatPlateStyle({ left: '50%', top: '104%' }, 40)).toMatchObject({ top: 'calc(104% + 40px)' });
  });

  it('keeps plates near the edges on screen', () => {
    expect(seatPlateStyle({ left: '5%', top: '26%' }, 40).transform).toBe('translate(-25%, 0)');
    expect(seatPlateStyle({ left: '95%', top: '26%' }, 40).transform).toBe('translate(-75%, 0)');
  });

  it('falls back to below the seat without coordinates', () => {
    expect(seatPlateStyle(undefined, 40)).toMatchObject({ left: '50%', top: '100%' });
  });
});
