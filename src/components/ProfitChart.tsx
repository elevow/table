import React, { useMemo, useRef, useState } from 'react';
import type { ProfitPoint } from '../lib/shared/profit-sessions';

interface Props {
  points: ProfitPoint[];
}

const W = 720;
const H = 260;
const PAD = { top: 16, right: 16, bottom: 28, left: 56 };

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n * 100) / 100).toLocaleString()}`;

/** Round tick values covering [min, max], about four of them. */
function niceTicks(min: number, max: number): number[] {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || raw;
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

/**
 * Running total of the player's results, one step per hand. The x axis counts hands rather
 * than time so long breaks between sessions don't squash the play into thin slivers.
 */
export default function ProfitChart({ points }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    const values = [0, ...points.map(p => p.cumulative)];
    const ticks = niceTicks(Math.min(...values), Math.max(...values));
    const lo = ticks[0];
    const hi = ticks[ticks.length - 1];
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    // Point 0 is the starting line at zero, before the first hand
    const x = (i: number) => PAD.left + (points.length ? (i / points.length) * innerW : 0);
    const y = (v: number) => PAD.top + (hi === lo ? innerH / 2 : ((hi - v) / (hi - lo)) * innerH);
    const path = [`M${x(0)},${y(0)}`, ...points.map((p, i) => `L${x(i + 1)},${y(p.cumulative)}`)].join(' ');
    return { ticks, x, y, path };
  }, [points]);

  if (points.length === 0) return null;

  const last = points[points.length - 1];
  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const frac = (vx - PAD.left) / (W - PAD.left - PAD.right);
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(frac * points.length) - 1)));
  };
  const hp = hover != null ? points[hover] : null;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-labelledby="profit-chart-title profit-chart-desc"
      >
        <title id="profit-chart-title">Cumulative profit by hand</title>
        <desc id="profit-chart-desc">
          {`Running total over ${points.length} hands, ending at ${money(last.cumulative)}.`}
        </desc>
        {geo.ticks.map(t => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={geo.y(t)}
              y2={geo.y(t)}
              className={t === 0 ? 'stroke-gray-300 dark:stroke-white/20' : 'stroke-gray-100 dark:stroke-white/5'}
              strokeDasharray={t === 0 ? '4 4' : undefined}
              strokeWidth={1}
            />
            <text x={PAD.left - 8} y={geo.y(t)} dy="0.32em" textAnchor="end" className="fill-gray-400 dark:fill-gray-500 text-[10px]">
              {money(t)}
            </text>
          </g>
        ))}
        <text x={PAD.left} y={H - 8} className="fill-gray-400 dark:fill-gray-500 text-[10px]">Hand 1</text>
        {points.length >= 8 && [0.25, 0.5, 0.75].map(f => {
          const hand = Math.max(1, Math.round(points.length * f));
          return (
            <text key={f} x={geo.x(hand)} y={H - 8} textAnchor="middle" className="fill-gray-400 dark:fill-gray-500 text-[10px]">
              {`Hand ${hand}`}
            </text>
          );
        })}
        <text x={W - PAD.right} y={H - 8} textAnchor="end" className="fill-gray-400 dark:fill-gray-500 text-[10px]">
          {`Hand ${points.length}`}
        </text>
        {/* Above zero is green, below zero is red: the same shapes drawn twice, each clipped to its side */}
        <defs>
          <linearGradient id="profit-above-fill" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={PAD.top} y2={geo.y(0)}>
            <stop offset="0%" stopColor="rgb(16 185 129)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="rgb(16 185 129)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="profit-below-fill" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={geo.y(0)} y2={H - PAD.bottom}>
            <stop offset="0%" stopColor="rgb(239 68 68)" stopOpacity="0" />
            <stop offset="100%" stopColor="rgb(239 68 68)" stopOpacity="0.28" />
          </linearGradient>
          <clipPath id="profit-above"><rect x={0} y={0} width={W} height={geo.y(0)} /></clipPath>
          <clipPath id="profit-below"><rect x={0} y={geo.y(0)} width={W} height={H} /></clipPath>
        </defs>
        {(['above', 'below'] as const).map(side => (
          <g key={side} clipPath={`url(#profit-${side})`}>
            <path
              d={`${geo.path} L${geo.x(points.length)},${geo.y(0)} L${geo.x(0)},${geo.y(0)} Z`}
              fill={`url(#profit-${side}-fill)`}
            />
            <path
              d={geo.path}
              fill="none"
              className={side === 'above' ? 'stroke-emerald-500 dark:stroke-emerald-400' : 'stroke-red-500 dark:stroke-red-400'}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>
        ))}
        {hp && hover != null && (
          <g pointerEvents="none">
            <line x1={geo.x(hover + 1)} x2={geo.x(hover + 1)} y1={PAD.top} y2={H - PAD.bottom} className="stroke-gray-400 dark:stroke-gray-500" strokeWidth={1} />
            <circle cx={geo.x(hover + 1)} cy={geo.y(hp.cumulative)} r={4} className="fill-emerald-500 dark:fill-emerald-400 stroke-white dark:stroke-gray-800" strokeWidth={2} />
          </g>
        )}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={W - PAD.left - PAD.right}
          height={H - PAD.top - PAD.bottom}
          fill="transparent"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        />
      </svg>
      {hp && hover != null && (
        <div
          className="absolute top-0 pointer-events-none rounded-lg bg-white dark:bg-gray-950 border border-gray-200 dark:border-white/10 shadow-card px-2.5 py-1.5 text-xs text-gray-900 dark:text-gray-100 whitespace-nowrap"
          style={{ left: `${(geo.x(hover + 1) / W) * 100}%`, transform: `translateX(${hover > points.length / 2 ? '-105%' : '5%'})` }}
        >
          <div className="font-semibold tabular-nums">{money(hp.cumulative)}</div>
          <div className="text-gray-500 dark:text-gray-400">
            Hand {hover + 1} · {hp.net > 0 ? '+' : ''}{money(hp.net)} · {new Date(hp.t).toLocaleDateString()}
          </div>
        </div>
      )}
    </div>
  );
}
