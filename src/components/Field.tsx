// Simulated "intravital" view: the radially symmetric model is painted onto a
// Voronoi tiling of ~10 µm keratinocytes, each coloured by the state of the
// ring it belongs to — the way the GCaMP6s wave appears under the multiphoton
// microscope (earlobe epidermis, top view).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Delaunay } from 'd3-delaunay';
import type { RunResult } from '../worker.ts';

export type Channel = 'gcamp' | 'atp' | 'ip3';

const R_MAX = 205; // µm, outer edge of ring 20
const SPACING = 10; // µm

interface Cell { path: Path2D; ring: number } // ring 0 = photodamaged cell

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildTissue(): { cells: Cell[] } {
  const rnd = mulberry32(42);
  const pts: [number, number][] = [];
  const dy = SPACING * Math.sqrt(3) / 2;
  const lim = R_MAX + 2 * SPACING;
  for (let row = -Math.ceil(lim / dy); row <= Math.ceil(lim / dy); row++) {
    for (let col = -Math.ceil(lim / SPACING); col <= Math.ceil(lim / SPACING); col++) {
      let x = col * SPACING + (row % 2 ? SPACING / 2 : 0);
      let y = row * dy;
      if (row !== 0 || col !== 0) { x += (rnd() - 0.5) * 4.2; y += (rnd() - 0.5) * 4.2; }
      if (x * x + y * y <= lim * lim) pts.push([x, y]);
    }
  }
  const del = Delaunay.from(pts);
  const vor = del.voronoi([-lim, -lim, lim, lim]);
  const cells: Cell[] = [];
  pts.forEach(([x, y], i) => {
    const r = Math.hypot(x, y);
    if (r > R_MAX) return;
    const poly = vor.cellPolygon(i);
    if (!poly) return;
    const path = new Path2D();
    poly.forEach(([px, py], k) => (k ? path.lineTo(px, py) : path.moveTo(px, py)));
    path.closePath();
    const ring = r < SPACING / 2 ? 0 : Math.min(20, Math.max(1, Math.round(r / SPACING)));
    cells.push({ path, ring });
  });
  return { cells };
}

type Stop = [number, [number, number, number]];
const hex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const LUTS: Record<Channel, Stop[]> = {
  gcamp: [[0, hex('#06120c')], [0.12, hex('#0d3220')], [0.45, hex('#1f8a4c')], [0.75, hex('#6fe39a')], [1, hex('#effff4')]],
  atp: [[0, hex('#0d0610')], [0.15, hex('#2c0f2c')], [0.5, hex('#9b2f84')], [0.8, hex('#ef7fcf')], [1, hex('#fff0fb')]],
  ip3: [[0, hex('#0f0a04')], [0.12, hex('#2a1806')], [0.5, hex('#a8611a')], [0.8, hex('#f2b45a')], [1, hex('#fff4dc')]],
};

function lutColor(ch: Channel, x: number): string {
  const stops = LUTS[ch];
  const v = Math.max(0, Math.min(1, x));
  let i = 1;
  while (i < stops.length - 1 && stops[i][0] < v) i++;
  const [x0, c0] = stops[i - 1], [x1, c1] = stops[i];
  const f = (v - x0) / (x1 - x0);
  return `rgb(${c0.map((c, k) => Math.round(c + f * (c1[k] - c))).join(',')})`;
}

/** Channel value of ring j (0-based) at sample k, mapped to [0, 1]. */
function channelLevel(res: RunResult, ch: Channel, j: number, k: number): number {
  if (ch === 'gcamp') return 0.12 + 0.88 * Math.max(0, res.dF[j][k]) / 1.15; // basal GCaMP fluorescence is visible
  if (ch === 'atp') {
    const a = res.atp[j][k];
    return a <= 0.1 ? 0.15 * Math.max(0, a) / 0.1 : 0.15 + 0.85 * Math.log10(a / 0.1) / 3.4; // 0.1–250 µM, log
  }
  return 0.12 + 0.88 * res.ip3[j][k] / 0.15;
}

export const CHANNEL_INFO: Record<Channel, { label: string; scale: string }> = {
  gcamp: { label: 'GCaMP6s', scale: 'ΔF/F, normalised 0 → 1.15' },
  atp: { label: 'Extracellular ATP', scale: '0.1 → 250 µM, log' },
  ip3: { label: 'IP₃', scale: '0 → 0.15 µM' },
};

interface Props { res: RunResult | null; k: number; channel: Channel; tNow: number }

export function Field({ res, k, channel, tNow }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(480);
  const tissue = useMemo(buildTissue, []);

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setSize(el.clientWidth));
    ro.observe(el);
    setSize(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size * dpr); c.height = Math.round(size * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#020604';
    g.fillRect(0, 0, size, size);
    const s = size / (2 * (R_MAX + 6));
    g.save();
    g.translate(size / 2, size / 2);
    g.scale(s, s);
    g.beginPath(); g.arc(0, 0, R_MAX, 0, 2 * Math.PI); g.clip();

    const colors: string[] = [];
    if (res && res.status === 'ok') for (let j = 0; j < 20; j++) colors.push(lutColor(channel, channelLevel(res, channel, j, k)));
    const released = tNow > 0;
    for (const cell of tissue.cells) {
      if (cell.ring === 0) {
        // photodamaged keratinocyte: bright at the laser pulse, then a dark, leaky ghost
        g.fillStyle = !released ? lutColor(channel, 0.12) : tNow < 0.4 ? '#ffffff' : '#141414';
      } else {
        g.fillStyle = colors[cell.ring - 1] ?? lutColor(channel, 0.12);
      }
      g.fill(cell.path);
    }
    g.lineWidth = 0.9;
    g.strokeStyle = 'rgba(2,6,4,0.85)';
    for (const cell of tissue.cells) g.stroke(cell.path);

    // wave front (ΔF/F = 0.3 crossing, as in the paper)
    const fr = res ? res.front[k] : NaN;
    if (Number.isFinite(fr) && channel === 'gcamp') {
      g.setLineDash([3, 3]);
      g.strokeStyle = 'rgba(255,255,255,0.75)';
      g.lineWidth = 1.2;
      g.beginPath(); g.arc(0, 0, fr, 0, 2 * Math.PI); g.stroke();
      g.setLineDash([]);
    }
    g.restore();

    // overlays in screen space, microscope style
    g.fillStyle = 'rgba(235,255,240,0.92)';
    g.font = `600 13px ${getComputedStyle(document.documentElement).getPropertyValue('--font-ui')}`;
    g.textBaseline = 'top';
    g.fillText(tNow < 60 ? `t = ${tNow.toFixed(1)} s` : `t = ${(tNow / 60).toFixed(1)} min`, 14, 14);
    g.textAlign = 'right';
    g.fillText(CHANNEL_INFO[channel].label, size - 14, 14);
    // 50 µm scale bar
    const bar = 50 * s;
    g.fillRect(14, size - 22, bar, 3);
    g.textAlign = 'left'; g.textBaseline = 'bottom';
    g.font = `12px ${getComputedStyle(document.documentElement).getPropertyValue('--font-ui')}`;
    g.fillText('50 µm', 14, size - 26);
  }, [size, tissue, res, k, channel, tNow]);

  return (
    <div className="field" ref={wrap}>
      <canvas ref={canvas} style={{ width: '100%', height: size }} role="img"
        aria-label={`Simulated top view of the epidermis showing ${CHANNEL_INFO[channel].label} at t = ${tNow.toFixed(1)} s`} />
    </div>
  );
}

export function ColorBar({ channel }: { channel: Channel }) {
  const stops = LUTS[channel].map(([x, c]) => `rgb(${c.join(',')}) ${x * 100}%`).join(', ');
  return (
    <div className="colorbar">
      <div className="colorbar-ramp" style={{ background: `linear-gradient(90deg, ${stops})` }} />
      <span>{CHANNEL_INFO[channel].scale}</span>
    </div>
  );
}
