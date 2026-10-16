import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { readTokens, useThemeVersion } from '../theme.ts';

export interface Series {
  name: string;
  color: string;
  y: ArrayLike<number>;
  dashed?: boolean;
  faint?: boolean;
}

interface Props {
  title: string;
  unit: string;
  t: ArrayLike<number>;          // seconds
  series: Series[];
  xMax: number;                  // seconds
  xUnit: 's' | 'min';
  yMin?: number;
  yMax?: number;
  cursor?: number;               // seconds
  onPick?: (t: number) => void;
  format?: (v: number) => string;
  height?: number;
  note?: string;
}

const PAD = { l: 48, r: 12, t: 10, b: 30 };

function niceStep(range: number, target: number): number {
  const raw = range / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}

function lowerBound(a: ArrayLike<number>, x: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < x) lo = mid + 1; else hi = mid; }
  return lo;
}

export function LineChart(props: Props) {
  const { title, unit, t, series, xMax, xUnit, cursor, onPick, height = 220, note } = props;
  const fmt = props.format ?? ((v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3)));
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(400);
  const [hover, setHover] = useState<{ x: number; k: number } | null>(null);
  const themeV = useThemeVersion();

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // y range
  const kEnd = Math.min(t.length, lowerBound(t, xMax + 1e-9) + 1);
  let yMin = props.yMin ?? Infinity, yMax = props.yMax ?? -Infinity;
  if (props.yMin === undefined || props.yMax === undefined) {
    for (const s of series) for (let k = 0; k < kEnd; k++) {
      const v = s.y[k];
      if (!Number.isFinite(v)) continue;
      if (props.yMin === undefined && v < yMin) yMin = v;
      if (props.yMax === undefined && v > yMax) yMax = v;
    }
    if (!Number.isFinite(yMin)) yMin = 0;
    if (!Number.isFinite(yMax)) yMax = 1;
    if (yMax - yMin < 1e-9) yMax = yMin + 1;
    const padY = (yMax - yMin) * 0.06;
    if (props.yMin === undefined) yMin -= padY;
    if (props.yMax === undefined) yMax += padY;
  }

  const plotW = Math.max(10, width - PAD.l - PAD.r);
  const plotH = height - PAD.t - PAD.b;
  const sx = (x: number) => PAD.l + (x / xMax) * plotW;
  const sy = (y: number) => PAD.t + (1 - (y - yMin) / (yMax - yMin)) * plotH;
  const xDiv = xUnit === 'min' ? 60 : 1;

  useEffect(() => {
    const c = canvas.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    const tok = readTokens();

    // grid + axes
    g.font = `11px ${tok.fontUi}`;
    g.fillStyle = tok.ink3;
    g.strokeStyle = tok.grid;
    g.lineWidth = 1;
    const yStep = niceStep(yMax - yMin, 4);
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax + 1e-12; v += yStep) {
      const y = Math.round(sy(v)) + 0.5;
      g.beginPath(); g.moveTo(PAD.l, y); g.lineTo(PAD.l + plotW, y); g.stroke();
      g.fillText(Math.abs(v) < 1e-12 ? '0' : +v.toPrecision(3) + '', PAD.l - 6, y);
    }
    const xStep = niceStep(xMax / xDiv, Math.max(3, Math.floor(plotW / 80))) * xDiv;
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (let v = 0; v <= xMax + 1e-9; v += xStep) {
      const x = Math.round(sx(v)) + 0.5;
      g.strokeStyle = tok.grid;
      g.beginPath(); g.moveTo(x, PAD.t + plotH); g.lineTo(x, PAD.t + plotH + 4); g.stroke();
      g.fillText(`${+(v / xDiv).toPrecision(4)}`, x, PAD.t + plotH + 7);
    }
    g.textAlign = 'right';
    g.fillText(xUnit === 'min' ? 'min' : 's', PAD.l + plotW, PAD.t + plotH + 18);
    g.strokeStyle = tok.axis;
    g.beginPath(); g.moveTo(PAD.l, PAD.t + plotH + 0.5); g.lineTo(PAD.l + plotW, PAD.t + plotH + 0.5); g.stroke();

    // series
    g.save();
    g.beginPath(); g.rect(PAD.l, PAD.t - 2, plotW, plotH + 4); g.clip();
    g.lineJoin = 'round'; g.lineCap = 'round';
    const drawOrder = [...series].sort((a, b) => Number(!!b.faint) - Number(!!a.faint));
    for (const s of drawOrder) {
      g.strokeStyle = s.faint ? tok.ghost : s.color;
      g.lineWidth = s.faint ? 1.5 : 2;
      g.setLineDash(s.dashed ? [5, 4] : []);
      g.beginPath();
      let pen = false;
      // decimate to ~2 points per pixel
      const stride = Math.max(1, Math.floor(kEnd / (plotW * 2)));
      for (let k = 0; k < kEnd; k += k < kEnd - stride ? stride : 1) {
        const v = s.y[k];
        if (!Number.isFinite(v)) { pen = false; continue; }
        const x = sx(t[k]), y = sy(v);
        if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.setLineDash([]);
    g.restore();

    // playback cursor
    if (cursor !== undefined && cursor <= xMax) {
      g.strokeStyle = tok.accent; g.lineWidth = 1.5;
      const x = Math.round(sx(cursor)) + 0.5;
      g.beginPath(); g.moveTo(x, PAD.t); g.lineTo(x, PAD.t + plotH); g.stroke();
    }
    // hover crosshair
    if (hover) {
      g.strokeStyle = tok.ink3; g.lineWidth = 1; g.setLineDash([2, 3]);
      const x = Math.round(sx(t[hover.k])) + 0.5;
      g.beginPath(); g.moveTo(x, PAD.t); g.lineTo(x, PAD.t + plotH); g.stroke();
      g.setLineDash([]);
      for (const s of series) {
        if (s.faint) continue;
        const v = s.y[hover.k];
        if (!Number.isFinite(v)) continue;
        g.fillStyle = s.color; g.strokeStyle = tok.panel; g.lineWidth = 2;
        g.beginPath(); g.arc(x, sy(v), 4, 0, 2 * Math.PI); g.fill(); g.stroke();
      }
    }
  }, [width, height, t, series, xMax, xUnit, yMin, yMax, cursor, hover, themeV]);

  const onMove = (e: PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (x < PAD.l || x > PAD.l + plotW) { setHover(null); return; }
    const tx = ((x - PAD.l) / plotW) * xMax;
    let k = lowerBound(t, tx);
    if (k > 0 && (k >= t.length || Math.abs(t[k - 1] - tx) < Math.abs(t[k] - tx))) k--;
    setHover({ x, k: Math.min(k, kEnd - 1) });
  };
  const onClick = (e: PointerEvent) => {
    if (!onPick) return;
    const r = canvas.current!.getBoundingClientRect();
    const tx = ((e.clientX - r.left - PAD.l) / plotW) * xMax;
    onPick(Math.max(0, Math.min(xMax, tx)));
  };

  const visible = series.filter((s) => !s.faint);
  const tipLeft = hover ? Math.min(hover.x + 12, width - 150) : 0;
  return (
    <figure className="chart">
      <figcaption>
        <span className="chart-title">{title}</span>
        <span className="chart-unit">{unit}</span>
      </figcaption>
      <div className="chart-plot" ref={wrap} style={{ height }}>
        <canvas
          ref={canvas}
          style={{ width: '100%', height }}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onPointerDown={onClick}
          role="img"
          aria-label={`${title}, ${unit}, ${visible.map((s) => s.name).join(', ')}`}
        />
        {hover && (
          <div className="tooltip" style={{ left: tipLeft, top: 8 }}>
            <div className="tooltip-head">t = {xUnit === 'min' ? (t[hover.k] / 60).toFixed(2) + ' min' : t[hover.k].toFixed(1) + ' s'}</div>
            {visible.map((s) => (
              <div key={s.name} className="tooltip-row">
                <i style={{ background: s.color }} />
                <span>{s.name}</span>
                <b>{Number.isFinite(s.y[hover.k]) ? fmt(s.y[hover.k]) : '—'}</b>
              </div>
            ))}
          </div>
        )}
      </div>
      {note && <p className="chart-note">{note}</p>}
    </figure>
  );
}
