import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_PARAMS, type Params } from './model/params.ts';
import { METHODS, type Method } from './model/integrators.ts';
import type { RunRequest, RunResult } from './worker.ts';
import { Field, ColorBar, CHANNEL_INFO, type Channel } from './components/Field.tsx';
import { LineChart, type Series } from './components/LineChart.tsx';
import { Slider, Segmented } from './components/Controls.tsx';
import { ConvergenceChart } from './components/ConvergenceChart.tsx';
import { ringColors, useThemeVersion } from './theme.ts';
import workerSource from 'virtual:worker';

const RINGS = [0, 1, 2, 3, 4, 5, 6, 7]; // 10 … 80 µm, as in the paper's figures

const PRESETS: { id: string; label: string; title: string; apply: (p: Params) => Params }[] = [
  { id: 'control', label: 'Control', title: 'Published parameters', apply: () => ({ ...DEFAULT_PARAMS }) },
  { id: 'arl', label: 'ARL 67156', title: 'Ecto-ATPase inhibitor: ATP degradation k × 0.5', apply: () => ({ ...DEFAULT_PARAMS, k: DEFAULT_PARAMS.k * 0.5 }) },
  { id: 'apyrase', label: 'Apyrase', title: 'Exogenous ATP-hydrolysing enzyme: k × 10', apply: () => ({ ...DEFAULT_PARAMS, k: DEFAULT_PARAMS.k * 10 }) },
  { id: 'nohc', label: 'No hemichannels', title: 'Ca²⁺-activated ATP release from bystander cells switched off (kHC = 0)', apply: () => ({ ...DEFAULT_PARAMS, kHC: 0 }) },
];

const sameParams = (a: Params, b: Params) => (Object.keys(a) as (keyof Params)[]).every((k) => a[k] === b[k]);

function lowerBound(a: ArrayLike<number>, x: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < x) lo = mid + 1; else hi = mid; }
  return Math.min(lo, a.length - 1);
}

function makeWorker(): Worker {
  const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
  return new Worker(url);
}

const fmtT = (t: number) => (t < 60 ? `${t.toFixed(1)} s` : `${(t / 60).toFixed(1)} min`);

export default function App() {
  useThemeVersion();
  const [params, setParams] = useState<Params>({ ...DEFAULT_PARAMS });
  const [method, setMethod] = useState<Method>('sbdf2');
  const [dt, setDt] = useState(0.01);
  const [tEnd, setTEnd] = useState(1200);
  const [res, setRes] = useState<RunResult | null>(null);
  const [baseline, setBaseline] = useState<{ res: RunResult; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [tNow, setTNow] = useState(12);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(5);
  const [channel, setChannel] = useState<Channel>('gcamp');
  const [win, setWin] = useState<'early' | 'full'>('early');

  const workerRef = useRef<Worker | null>(null);
  const runId = useRef(0);

  const run = useCallback((req: Omit<RunRequest, 'id'>) => {
    if (workerRef.current && busy) { workerRef.current.terminate(); workerRef.current = null; }
    if (!workerRef.current) {
      const w = makeWorker();
      w.onmessage = (ev: MessageEvent) => {
        const m = ev.data;
        if (m.id !== runId.current) return;
        if (m.type === 'progress') setProgress(m.fraction);
        else { setRes(m as RunResult); setBusy(false); setProgress(1); }
      };
      workerRef.current = w;
    }
    const id = ++runId.current;
    setBusy(true); setProgress(0);
    workerRef.current.postMessage({ ...req, id });
  }, [busy]);

  // re-run (debounced) whenever the model or the numerics change
  useEffect(() => {
    const h = setTimeout(() => run({ params, method, dt, tEnd }), 180);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, method, dt, tEnd]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  // playback
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dtReal = (now - last) / 1000; last = now;
      setTNow((t) => {
        const nt = t + dtReal * speed;
        if (nt >= tEnd) { setPlaying(false); return tEnd; }
        return nt;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, tEnd]);

  useEffect(() => { if (tNow > tEnd) setTNow(tEnd); }, [tEnd, tNow]);

  const ok = res && res.status === 'ok';
  const k = ok ? lowerBound(res.t, tNow) : 0;
  const colors = ringColors();
  const xMax = win === 'early' ? Math.min(30, tEnd) : tEnd;
  const xUnit = win === 'early' ? 's' : 'min';
  const activePreset = PRESETS.find((p) => sameParams(p.apply(params), params))?.id;

  const mk = useCallback((pick: (r: RunResult) => Float64Array[]): Series[] => {
    if (!res || res.status !== 'ok') return [];
    const s: Series[] = RINGS.map((j) => ({ name: `${(j + 1) * 10} µm`, color: colors[j], y: pick(res)[j] }));
    return s;
  }, [res, colors]);

  const dfSeries = useMemo(() => {
    const s = mk((r) => r.dF);
    if (baseline && res && baseline.res.t.length === res.t.length) {
      RINGS.forEach((j) => s.unshift({ name: `${baseline.label} ${(j + 1) * 10} µm`, color: '', y: baseline.res.dF[j], faint: true }));
    }
    return s;
  }, [mk, baseline, res]);
  const atpSeries = useMemo(() => mk((r) => r.atp), [mk]);
  const ip3Series = useMemo(() => mk((r) => r.ip3), [mk]);
  const frontSeries = useMemo<Series[]>(() => {
    if (!ok) return [];
    const s: Series[] = [{ name: 'front', color: colors[0], y: res.front }];
    if (baseline && baseline.res.t.length === res.t.length) s.unshift({ name: baseline.label, color: '', y: baseline.res.front, faint: true });
    return s;
  }, [ok, res, colors, baseline]);

  // summary of the current run
  const summary = useMemo(() => {
    if (!ok) return null;
    let extent = 0;
    for (let j = 0; j < 20; j++) if (Math.max(...res.dF[j]) >= 0.3) extent = (j + 1) * 10;
    let maxFront = 0;
    for (const f of res.front) if (f > maxFront) maxFront = f;
    let t20 = NaN;
    for (let kk = 0; kk < res.t.length; kk++) if (res.front[kk] >= 20) { t20 = res.t[kk]; break; }
    let t60 = NaN;
    for (let kk = 0; kk < res.t.length; kk++) if (res.front[kk] >= 60) { t60 = res.t[kk]; break; }
    const speedUm = Number.isFinite(t20) && Number.isFinite(t60) ? 40 / (t60 - t20) : NaN;
    return { extent, maxFront, speedUm };
  }, [ok, res]);

  const set = (key: keyof Params) => (v: number) => setParams((p) => ({ ...p, [key]: v }));
  const methodInfo = METHODS.find((m) => m.id === method)!;
  const stepOptions = method === 'rk4' ? [0.001, 0.002, 0.005, 0.01] : [0.002, 0.005, 0.01, 0.02, 0.05, 0.1];

  return (
    <div className="page">
      <header className="masthead">
        <h1>Calcium waves in photodamaged skin</h1>
        <p className="lede">
          A laser pulse ruptures one basal keratinocyte. Its ATP spreads through the extracellular
          space, activates P2Y receptors on the neighbours, and an IP₃-driven Ca²⁺ wave radiates
          through the surrounding tissue. This page integrates the complete published model of{' '}
          <a href="https://research.unipd.it/handle/11577/3411404">Donati et al., <i>Function</i> 2022</a>{' '}
          live in your browser — change a parameter and the wave is recomputed.
        </p>
      </header>

      <section className="stage" aria-label="Simulation">
        <div className="stage-view">
          <Field res={ok ? res : null} k={k} channel={channel} tNow={ok ? res.t[k] : tNow} />
          {busy && <div className="busy" aria-live="polite"><span style={{ width: `${Math.round(progress * 100)}%` }} />Computing…</div>}
          {res && res.status === 'unstable' && (
            <div className="unstable" role="alert">
              <b>{methodInfo.short} blew up at t = {res.unstableAt} s.</b>
              {method === 'rk4'
                ? ' An explicit method needs Δt below ≈ 10⁻⁵ s here, set by ATP diffusion in the 20 nm layer above the damaged cell. Pick a semi-implicit or exponential integrator.'
                : ' Reduce the time step.'}
            </div>
          )}
        </div>

        <div className="stage-side">
          <div className="transport">
            <button type="button" className="play" onClick={() => {
              if (!playing && tNow >= tEnd - 1e-6) setTNow(0);
              setPlaying(!playing);
            }} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? 'Pause' : 'Play'}
            </button>
            <input type="range" className="scrub" min={0} max={tEnd} step={0.1} value={tNow}
              onChange={(e) => { setPlaying(false); setTNow(+e.target.value); }}
              aria-label="Time after photodamage" aria-valuetext={fmtT(tNow)} />
            <output className="clock">{fmtT(tNow)}</output>
          </div>
          <div className="row">
            <span className="row-label">Playback</span>
            <Segmented label="Playback speed" value={speed} onChange={setSpeed}
              options={[1, 5, 30, 120].map((v) => ({ value: v, label: `${v}×` }))} />
          </div>
          <div className="row">
            <span className="row-label">Show</span>
            <Segmented label="Channel" value={channel} onChange={setChannel}
              options={(['gcamp', 'atp', 'ip3'] as Channel[]).map((c) => ({ value: c, label: CHANNEL_INFO[c].label }))} />
          </div>
          <ColorBar channel={channel} />

          <dl className="readouts">
            <div><dt>Front now</dt><dd>{ok && Number.isFinite(res.front[k]) ? `${res.front[k].toFixed(0)} µm` : '—'}</dd></div>
            <div><dt>Furthest ring reached</dt><dd>{summary ? `${summary.extent} µm` : '—'}</dd></div>
            <div><dt>Front speed, 20–60 µm</dt><dd>{summary && Number.isFinite(summary.speedUm) ? `${summary.speedUm.toFixed(1)} µm/s` : '—'}</dd></div>
            <div><dt>ATP at 10 µm now</dt><dd>{ok ? `${res.atp[0][k].toFixed(res.atp[0][k] < 10 ? 2 : 0)} µM` : '—'}</dd></div>
          </dl>

          <div className="presets">
            <span className="row-label">Conditions</span>
            <div className="preset-buttons">
              {PRESETS.map((p) => (
                <button key={p.id} type="button" title={p.title}
                  className={activePreset === p.id ? 'on' : ''}
                  onClick={() => setParams(p.apply(params))}>{p.label}</button>
              ))}
            </div>
            <button type="button" className="pin" disabled={!ok}
              onClick={() => ok && setBaseline(baseline ? null : { res, label: activePreset ? PRESETS.find((p) => p.id === activePreset)!.label : 'Pinned run' })}>
              {baseline ? `Clear comparison (${baseline.label})` : 'Keep this run as a grey comparison'}
            </button>
          </div>
        </div>
      </section>

      <section className="plots" aria-label="Time courses">
        <div className="plots-head">
          <ul className="legend">
            {RINGS.map((j) => <li key={j}><i style={{ background: colors[j] }} />{(j + 1) * 10} µm</li>)}
            {baseline && <li className="legend-ghost"><i />{baseline.label}</li>}
          </ul>
          <Segmented label="Time window" value={win} onChange={setWin}
            options={[{ value: 'early', label: 'First 30 s' }, { value: 'full', label: `Whole run, ${tEnd / 60} min` }]} />
        </div>
        <div className="plot-grid">
          <LineChart title="GCaMP6s fluorescence" unit="ΔF/F, normalised to the control peak in the first 30 s"
            t={res?.t ?? []} series={dfSeries} xMax={xMax} xUnit={xUnit} yMin={-0.05}
            cursor={tNow} onPick={(t) => { setPlaying(false); setTNow(t); }} />
          <LineChart title="Wave front" unit="radius where ΔF/F crosses 0.3, µm"
            t={res?.t ?? []} series={frontSeries} xMax={xMax} xUnit={xUnit} yMin={0} yMax={100}
            cursor={tNow} onPick={(t) => { setPlaying(false); setTNow(t); }} format={(v) => `${v.toFixed(1)} µm`} />
          <LineChart title="Extracellular ATP" unit="µM"
            t={res?.t ?? []} series={atpSeries} xMax={xMax} xUnit={xUnit} yMin={0}
            cursor={tNow} onPick={(t) => { setPlaying(false); setTNow(t); }} />
          <LineChart title="IP₃" unit="µM"
            t={res?.t ?? []} series={ip3Series} xMax={xMax} xUnit={xUnit} yMin={0}
            cursor={tNow} onPick={(t) => { setPlaying(false); setTNow(t); }} />
        </div>
      </section>

      <section className="lab">
        <div className="params" aria-label="Model parameters">
          <h2>Parameters</h2>
          <p className="hint">Defaults are the published values. Changed parameters are marked and can be reset one by one.</p>
          <fieldset>
            <legend>ATP release and spread</legend>
            <Slider label="ATP in the damaged cell" symbol="a<sub>c</sub>(0)" unit="µM" value={params.ac0} def={DEFAULT_PARAMS.ac0} min={50} max={3000} log onChange={set('ac0')} />
            <Slider label="Diffusion coefficient" symbol="D" unit="µm²/s" value={params.D} def={DEFAULT_PARAMS.D} min={5} max={300} log onChange={set('D')} />
            <Slider label="Degradation by ectonucleotidases" symbol="k" unit="1/s" value={params.k} def={DEFAULT_PARAMS.k} min={0.01} max={5} log onChange={set('k')} />
          </fieldset>
          <fieldset>
            <legend>P2Y receptors and IP₃</legend>
            <Slider label="Maximal IP₃ production" symbol="v<sub>PLC</sub>" unit="µM/s" value={params.vplc} def={DEFAULT_PARAMS.vplc} min={0.1} max={10} log onChange={set('vplc')} />
            <Slider label="Half-activating ATP" symbol="K<sub>PLC</sub>" unit="µM" value={params.kplc} def={DEFAULT_PARAMS.kplc} min={0.05} max={50} log onChange={set('kplc')} />
            <Slider label="IP₃ degradation" symbol="k<sub>IP3</sub>" unit="1/s" value={params.kip} def={DEFAULT_PARAMS.kip} min={0.5} max={60} log onChange={set('kip')} />
          </fieldset>
          <fieldset>
            <legend>Ca²⁺ release and uptake</legend>
            <Slider label="IP₃ receptor flux" symbol="P<sub>IP3R</sub>" unit="1/s" value={params.PIP3R} def={DEFAULT_PARAMS.PIP3R} min={2000} max={400000} log onChange={set('PIP3R')} />
            <Slider label="SERCA pump capacity" symbol="v<sub>SERCA</sub>" unit="µM/s" value={params.vSERCA} def={DEFAULT_PARAMS.vSERCA} min={5} max={300} log onChange={set('vSERCA')} />
            <Slider label="ER leak" symbol="L" unit="1/s" value={params.L} def={DEFAULT_PARAMS.L} min={0.01} max={5} log onChange={set('L')} />
          </fieldset>
          <fieldset>
            <legend>Connexin hemichannels</legend>
            <Slider label="Ca²⁺-activated ATP release" symbol="k<sub>HC</sub>" unit="µM/s" value={params.kHC} def={DEFAULT_PARAMS.kHC} min={0} max={8000} onChange={set('kHC')} />
          </fieldset>
        </div>

        <div className="numerics" aria-label="Numerical method">
          <h2>Numerics</h2>
          <p className="hint">
            The model is stiff: ATP exchange across the 20 nm layer above the damaged cell relaxes at
            D/δh² ≈ 1.6·10⁵ s⁻¹, while the wave lasts tens of minutes. The stiff linear part is treated
            implicitly or exactly; Ca²⁺ reactions use a frozen diagonal Jacobian.
          </p>
          <div className="method-list" role="radiogroup" aria-label="Integrator">
            {METHODS.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={m.id === method}
                className={m.id === method ? 'on' : ''}
                onClick={() => { setMethod(m.id); if (m.id === 'rk4') setDt(0.001); else if (method === 'rk4') setDt(0.01); }}>
                <span>{m.label}</span><small>{m.kind}, order {m.order}</small>
              </button>
            ))}
          </div>
          <div className="row">
            <span className="row-label">Time step</span>
            <Segmented label="Time step" value={dt} onChange={setDt}
              options={stepOptions.map((v) => ({ value: v, label: `${v * 1000} ms` }))} />
          </div>
          <div className="row">
            <span className="row-label">Duration</span>
            <Segmented label="Simulated duration" value={tEnd} onChange={setTEnd}
              options={[300, 1200, 3000].map((v) => ({ value: v, label: `${v / 60} min` }))} />
          </div>

          <dl className="readouts compact">
            <div><dt>Steps</dt><dd>{res ? res.nSteps.toLocaleString('en-US') : '—'}</dd></div>
            <div><dt>Computed in</dt><dd>{res ? `${res.wallMs.toFixed(0)} ms` : '—'}</dd></div>
            <div>
              <dt>Error vs MATLAB ode15s</dt>
              <dd>
                {res?.refError != null
                  ? `${(res.refError * 100).toPrecision(2)} %`
                  : ok ? 'published parameters only' : '—'}
              </dd>
            </div>
            <div>
              <dt>after the first 2 s</dt>
              <dd>{res?.refErrorLate != null ? `${(res.refErrorLate * 100).toPrecision(2)} %` : '—'}</dd>
            </div>
          </dl>
          <p className="hint small">
            Error: largest deviation of cytosolic Ca²⁺ from the original MATLAB code over rings 10–80 µm,
            as a fraction of each ring's response amplitude. The fastest event, the Ca²⁺ upstroke in the
            first ring within 0.5 s, dominates it at large steps.
          </p>
          <ConvergenceChart active={method} />
        </div>
      </section>

      <section className="about">
        <h2>The model</h2>
        <div className="about-cols">
          <div>
            <p>
              The epidermis is treated as radially symmetric around the damaged cell. Extracellular ATP
              obeys a diffusion–degradation equation discretised on twenty rings of cells, Δr = 10 µm,
              plus two compartments: the damaged cell, which starts with 800 µM ATP, and the thin
              extracellular layer above it that it leaks into.
            </p>
            <p className="eq">∂a/∂t = D · (1/r) ∂/∂r (r ∂a/∂r) − k a + k<sub>HC</sub> Ca⁸/(Ca⁸ + 0.3⁸)</p>
            <p>
              In each ring, ATP activates P2Y receptors and PLC, producing IP₃, with a slow positive
              feedback ψ of Ca²⁺ on PLC. IP₃ opens IP₃ receptors gated as in Li and Rinzel; SERCA pumps and
              a leak close the loop with the ER. Ca²⁺ binds GCaMP6s, whose bound fraction is what the
              microscope measures. Ca²⁺-activated connexin hemichannels can release more ATP from
              bystander cells.
            </p>
            <p className="eq">dIP₃/dt = (1 + ψ) v<sub>PLC</sub> a/(a + K<sub>PLC</sub>) − k<sub>IP3</sub> IP₃</p>
            <p className="eq">dCa/dt = J<sub>IP3R</sub> − J<sub>SERCA</sub> + J<sub>leak</sub> − 3 (k<sub>on</sub> Ca (B<sub>tot</sub> − CaB) − k<sub>off</sub> CaB)</p>
          </div>
          <div>
            <p>
              The result is 122 coupled ODEs. Before the pulse the system rests for 1000 s, exactly as in
              the original code; this converges to the unstimulated steady state. Every equation and
              constant is taken unchanged from the authors' MATLAB code, including its simplifications,
              such as ER Ca²⁺ computed from conservation without the GCaMP-bound pool.
            </p>
            <p>
              The implementation was checked against the original code run in MATLAB with ode15s, and
              against an independent SciPy Radau solution at tolerance 10⁻¹⁰. The two references agree
              to 3·10⁻⁶; the browser integrators converge to them at their formal orders.
            </p>
            <p className="credits">
              Model and original code: V. Donati, C. Peres, C. Nardin, F. Scavizzi, M. Raspa,
              C. D. Ciubotaru, M. Bortolozzi, M. G. Pedersen, F. Mammano, “Calcium signaling in the
              photodamaged skin: in vivo experiments and mathematical modeling”, <i>Function</i>, 2022.
              Model code by M. G. Pedersen. Interactive reimplementation by Giorgia Gavioli.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
