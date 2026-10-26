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
 * shifted inwards so they stay on screen.
 */
export function narrowInfoBoxStyle(seat?: CSSProperties): CSSProperties {
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
    top: above ? `calc(${top}% - ${NARROW_INFO_GAP_PX}px)` : `calc(${top}% + ${NARROW_INFO_GAP_PX}px)`,
    transform: `translate(${shiftX}, ${above ? '-100%' : '0'})`,
    pointerEvents: 'none',
  };
}
