import { useState } from 'react';
import { catColors, useThemeVersion } from '../theme.ts';
import convergence from '../data/convergence.json';
import { METHODS, type Method } from '../model/integrators.ts';

const ORDER: Method[] = ['sbdf2', 'etd2', 'sbdf1', 'etd1'];

export function ConvergenceChart({ active }: { active: Method }) {
  useThemeVersion();
  const colors = catColors();
  const [hover, setHover] = useState<{ m: Method; dt: number; e: number; x: number; y: number } | null>(null);
  const W = 420, H = 250, P = { l: 52, r: 16, t: 12, b: 38 };
  const x0 = Math.log10(0.0015), x1 = Math.log10(0.13);
  const y0 = -4.5, y1 = 0.5;
  const sx = (dt: number) => P.l + ((Math.log10(dt) - x0) / (x1 - x0)) * (W - P.l - P.r);
  const sy = (e: number) => P.t + (1 - (Math.log10(e) - y0) / (y1 - y0)) * (H - P.t - P.b);
  const data = convergence as Record<string, Record<string, number>>;

  return (
    <figure className="chart convergence">
      <figcaption>
        <span className="chart-title">Convergence against a Radau reference</span>
        <span className="chart-unit">max error in Ca²⁺ over 50 min, rings 10–80 µm, relative to response amplitude</span>
      </figcaption>
      <ul className="legend">
        {ORDER.map((m, i) => (
          <li key={m} className={m === active ? 'active' : ''}>
            <i style={{ background: colors[i] }} />{METHODS.find((x) => x.id === m)!.short}
          </li>
        ))}
        <li className="legend-ref"><i className="dash" />slope 1 and 2</li>
      </ul>
      <div className="svg-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Log-log plot of error versus time step for four integrators">
          {[-4, -3, -2, -1, 0].map((p) => (
            <g key={p}>
              <line x1={P.l} x2={W - P.r} y1={sy(10 ** p)} y2={sy(10 ** p)} className="grid" />
              <text x={P.l - 6} y={sy(10 ** p)} className="tick" textAnchor="end" dominantBaseline="middle">
                {p === 0 ? '1' : `1e${p}`}
              </text>
            </g>
          ))}
          {[0.002, 0.005, 0.01, 0.02, 0.05, 0.1].map((dt) => (
            <text key={dt} x={sx(dt)} y={H - P.b + 16} className="tick" textAnchor="middle">{dt}</text>
          ))}
          <text x={W - P.r} y={H - 6} className="tick" textAnchor="end">time step Δt [s]</text>
          {/* reference slopes */}
          <line x1={sx(0.002)} y1={sy(0.006)} x2={sx(0.1)} y2={sy(0.3)} className="slope" />
          <line x1={sx(0.002)} y1={sy(4e-5)} x2={sx(0.05)} y2={sy(4e-5 * 625)} className="slope" />
          {ORDER.map((m, i) => {
            const pts = Object.entries(data[m] ?? {}).map(([dt, e]) => [Number(dt), e] as const).sort((a, b) => a[0] - b[0]);
            return (
              <g key={m} opacity={m === active ? 1 : 0.55}>
                <polyline fill="none" stroke={colors[i]} strokeWidth={m === active ? 2.5 : 2}
                  points={pts.map(([dt, e]) => `${sx(dt)},${sy(e)}`).join(' ')} />
                {pts.map(([dt, e]) => (
                  <circle key={dt} cx={sx(dt)} cy={sy(e)} r={4} fill={colors[i]} className="pt"
                    onPointerEnter={() => setHover({ m, dt, e, x: sx(dt), y: sy(e) })}
                    onPointerLeave={() => setHover(null)} />
                ))}
              </g>
            );
          })}
          <line x1={P.l} x2={W - P.r} y1={H - P.b} y2={H - P.b} className="axis" />
        </svg>
        {hover && (
          <div className="tooltip" style={{ left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100}%` }}>
            <div className="tooltip-head">{METHODS.find((x) => x.id === hover.m)!.short}, Δt = {hover.dt} s</div>
            <div className="tooltip-row"><span>error</span><b>{(hover.e * 100).toPrecision(2)} %</b></div>
          </div>
        )}
      </div>
    </figure>
  );
}
