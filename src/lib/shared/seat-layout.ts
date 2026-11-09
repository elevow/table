import type { CSSProperties } from 'react';

/** Gap between the seat's centre and its info box on a phone (half the 48px seat plus a little). */
export const NARROW_INFO_GAP_PX = 28;

const percent = (value: string | number | undefined): number | null => {
  if (value === undefined || value === null) return null;
  const n = parseFloat(String(value).replace('%', ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * Where a seat's name/stack box goes on a phone: right next to the seat, on the side away from
 * the table centre (above seats in the top half, below seats in the bottom half), so it never
 * covers the board or the cards dealt toward the middle. Boxes near the left or right edge are
 * shifted inwards so they stay on screen. Wider screens use the same layout with a bigger gap
 * for their bigger seats.
 */
export function narrowInfoBoxStyle(seat?: CSSProperties, gapPx: number = NARROW_INFO_GAP_PX): CSSProperties {
  const left = percent(seat?.left as string | number | undefined);
  const top = percent(seat?.top as string | number | undefined);
  if (left === null || top === null) {
    return { position: 'absolute', left: '50%', top: '100%', transform: 'translate(-50%, 4px)', pointerEvents: 'none' };
  }
  const shiftX = left < 25 ? '-25%' : left > 75 ? '-75%' : '-50%';
  const above = top < 50;
  return {
    position: 'absolute',
    left: `${left}%`,
    top: above ? `calc(${top}% - ${gapPx}px)` : `calc(${top}% + ${gapPx}px)`,
    transform: `translate(${shiftX}, ${above ? '-100%' : '0'})`,
    pointerEvents: 'none',
  };
}

/** Seats this close to the middle of the table's width are the top and bottom seats. */
const CENTRE_BAND_PCT = 5;

/** Whether a seat sits at the top or bottom middle of the table, rather than around its sides. */
export function isCentreSeat(seat: CSSProperties | undefined): boolean {
  const left = percent(seat?.left as string | number | undefined);
  return left !== null && Math.abs(left - 50) < CENTRE_BAND_PCT;
}

/**
 * Where a seat's name plate goes. The top and bottom seats have theirs beside the avatar, on the
 * left, so it stays off the board and leaves room under your own seat; their cards go on the
 * right. Every other seat's plate is centred just under its avatar, with plates near the left or
 * right edge shifted inwards so they stay on screen; their cards sit beside the avatar (toward the
 * middle), so the plate never covers them.
 */
export function seatPlateStyle(seat: CSSProperties | undefined, gapPx: number): CSSProperties {
  const left = percent(seat?.left as string | number | undefined);
  const top = percent(seat?.top as string | number | undefined);
  if (left === null || top === null) {
    return { position: 'absolute', left: '50%', top: '100%', transform: 'translate(-50%, 4px)', pointerEvents: 'none' };
  }
  if (isCentreSeat(seat)) {
    return {
      position: 'absolute',
      left: `calc(${left}% - ${gapPx}px)`,
      top: `${top}%`,
      transform: 'translate(-100%, -50%)',
      pointerEvents: 'none',
    };
  }
  const shiftX = left < 15 ? '-25%' : left > 85 ? '-75%' : '-50%';
  return {
    position: 'absolute',
    left: `${left}%`,
    top: `calc(${top}% + ${gapPx}px)`,
    transform: `translate(${shiftX}, 0)`,
    pointerEvents: 'none',
  };
}
