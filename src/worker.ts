// Simulation worker: keeps the UI responsive while integrating the model.
import { DEFAULT_PARAMS, IDX, N_CELLS, N_STATE, type Params } from './model/params.ts';
import { restState, simulate, type Method } from './model/integrators.ts';
import { frontSeries, normalizedDF } from './model/observables.ts';
import reference from './data/ode15s_reference.json';

export interface RunRequest {
  id: number;
  params: Params;
  method: Method;
  dt: number;
  tEnd: number;
}

export interface RunResult {
  type: 'result';
  id: number;
  status: 'ok' | 'unstable';
  unstableAt?: number;
  t: Float64Array;
  dF: Float64Array[];   // normalised ΔF/F, 20 rings
  ca: Float64Array[];
  atp: Float64Array[];
  ip3: Float64Array[];
  ac: Float64Array;
  front: Float64Array;
  norm: number;
  nSteps: number;
  wallMs: number;
  restResidual: number;
  /** max |ca − ca_ode15s| / response amplitude over rings 1–8, only for the published parameters */
  refError: number | null;
  refErrorLate: number | null; // same, for t ≥ 2 s (after the initial upstroke)
}

// The rest state depends only on parameters active before the photodamage.
const PRE_KEYS: (keyof Params)[] = ['k', 'PIP3R', 'vSERCA', 'L', 'vplc', 'kplc', 'kip', 'nplc',
  'Ki', 'Ka', 'A', 'Kd', 'kSERCA', 'CaT', 'sigma', 'kon', 'koff', 'Btot', 'caplcpar', 'Kcaplc', 'tauPsi'];
const restCache = new Map<string, Float64Array>();

// ΔF normalisation of the control run (published parameters), shared by all runs.
let controlNorm: number | undefined;
function getControlNorm(): number {
  if (controlNorm === undefined) {
    const r = simulate(DEFAULT_PARAMS, { method: 'sbdf2', dt: 0.005, tEnd: 30 }, restState(DEFAULT_PARAMS));
    controlNorm = normalizedDF(r).norm;
  }
  return controlNorm;
}

function isPublished(p: Params): boolean {
  return (Object.keys(DEFAULT_PARAMS) as (keyof Params)[]).every((k) => p[k] === DEFAULT_PARAMS[k]);
}

function refErrors(t: Float64Array, ca: Float64Array[], tEnd: number): [number, number] {
  const rt = reference.t as number[];
  const rc = reference.ca as number[][];
  const amp = rc.map((s) => Math.max(...s) - reference.caRest);
  let k = 0, all = 0, late = 0;
  for (let r = 0; r < rt.length && rt[r] <= tEnd; r++) {
    while (k < t.length && t[k] < rt[r] - 1e-6) k++;
    if (k >= t.length || Math.abs(t[k] - rt[r]) > 1e-6) continue;
    for (let j = 0; j < 8; j++) {
      const e = Math.abs(ca[j][k] - rc[j][r]) / amp[j];
      if (e > all) all = e;
      if (rt[r] >= 2 && e > late) late = e;
    }
  }
  return [all, late];
}

self.onmessage = (ev: MessageEvent<RunRequest>) => {
  const { id, params, method, dt, tEnd } = ev.data;
  const key = JSON.stringify(PRE_KEYS.map((k) => params[k]));
  let rest = key ? restCache.get(key) : undefined;
  if (!rest) {
    rest = restState(params);
    if (restCache.size > 64) restCache.clear();
    restCache.set(key, rest);
  }
  const res = simulate(params, {
    method, dt, tEnd,
    onProgress: (f) => (self as unknown as Worker).postMessage({ type: 'progress', id, fraction: f }),
  }, rest);

  const n = res.t.length;
  const pick = (off: number) => Array.from({ length: N_CELLS }, (_, j) => {
    const s = new Float64Array(n);
    for (let k = 0; k < n; k++) s[k] = res.Y[k * N_STATE + off + j];
    return s;
  });
  const ca = pick(IDX.ca);
  const { dF, norm } = normalizedDF(res, getControlNorm());
  const front = frontSeries(res, dF, 0.3, 8);
  const ac = new Float64Array(n);
  for (let k = 0; k < n; k++) ac[k] = res.Y[k * N_STATE + IDX.ac];
  const [refError, refErrorLate] = res.status === 'ok' && isPublished(params) ? refErrors(res.t, ca, tEnd) : [null, null];

  const out: RunResult = {
    type: 'result', id, status: res.status, unstableAt: res.unstableAt,
    t: res.t, dF, ca, atp: pick(IDX.a), ip3: pick(IDX.ip3), ac, front, norm,
    nSteps: res.nSteps, wallMs: res.wallMs, restResidual: res.restResidual, refError, refErrorLate,
  };
  const transfer = [out.t, out.ac, out.front, ...out.dF, ...out.ca, ...out.atp, ...out.ip3].map((a) => a.buffer);
  (self as unknown as Worker).postMessage(out, transfer);
};
