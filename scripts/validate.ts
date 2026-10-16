// Validation of the fixed-step integrators against
//   (1) the MATLAB ode15s trajectory of the original code (validation/ode15s_ref.csv.gz)
//   (2) a tight-tolerance SciPy Radau reference (validation/radau_*.f64)
// and empirical convergence order. Run:  npm run reference && npm run validate
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { DEFAULT_PARAMS, IDX, N_CELLS, N_STATE } from '../src/model/params.ts';
import { simulate, type Method } from '../src/model/integrators.ts';
import { phiFunctions, phiScalar, expm } from '../src/model/linalg.ts';

const f64 = (path: string) => {
  const b = readFileSync(path);
  return new Float64Array(b.buffer, b.byteOffset, b.byteLength / 8);
};

// ---------- unit check: φ-functions of a diagonal matrix vs scalar formulas
{
  const n = 3, M = new Float64Array(9);
  const lam = [-1600, -0.3, 0];
  lam.forEach((l, i) => (M[i * n + i] = l));
  const [E, P1, P2] = phiFunctions(M, n);
  let err = 0;
  lam.forEach((l, i) => {
    const [e, p1, p2] = phiScalar(l);
    err = Math.max(err, Math.abs(E[i * n + i] - e), Math.abs(P1[i * n + i] - p1), Math.abs(P2[i * n + i] - p2));
  });
  // non-normal 2×2 with known exponential: [[a, b],[0, a]] → e^a [[1, b],[0, 1]]
  const N2 = Float64Array.from([-2, 5, 0, -2]);
  const E2 = expm(N2, 2);
  err = Math.max(err, Math.abs(E2[1] - 5 * Math.exp(-2)), Math.abs(E2[0] - Math.exp(-2)));
  console.log(`phi-function unit check: max error ${err.toExponential(2)}`);
  if (err > 1e-12) throw new Error('phi functions inaccurate');
}

const radT = f64('validation/radau_t.f64');
const radY = f64('validation/radau_Y.f64');
const radRest = f64('validation/radau_rest.f64');

// ode15s CSV (rows with t >= 0)
const csv = gunzipSync(readFileSync('validation/ode15s_ref.csv.gz')).toString('utf8').trim().split('\n')
  .map((l) => l.split(',').map(Number)).filter((r) => r[0] >= 0);

function compare(res: ReturnType<typeof simulate>, refT: Float64Array, refY: (k: number, i: number) => number, rest: Float64Array, tMax = 3000) {
  // error in cytosolic Ca²⁺, normalised by each ring's response amplitude
  let k = 0, worst = 0, worstCell = 0, worstT = 0;
  const amp = new Float64Array(N_CELLS);
  for (let r = 0; r < refT.length; r++) for (let j = 0; j < N_CELLS; j++)
    amp[j] = Math.max(amp[j], refY(r, IDX.ca + j) - rest[IDX.ca + j]);
  for (let r = 0; r < refT.length; r++) {
    if (refT[r] > tMax) break;
    while (k < res.t.length && res.t[k] < refT[r] - 1e-9) k++;
    if (Math.abs(res.t[k] - refT[r]) > 1e-9) continue;
    for (let j = 0; j < 8; j++) {
      const e = Math.abs(res.Y[k * N_STATE + IDX.ca + j] - refY(r, IDX.ca + j)) / amp[j];
      if (e > worst) { worst = e; worstCell = j; worstT = refT[r]; }
    }
  }
  return { worst, worstCell, worstT };
}

const csvT = Float64Array.from(csv.map((r) => r[0]));
const odeRef = (r: number, i: number) => csv[r][1 + i];
const radRef = (r: number, i: number) => radY[r * N_STATE + i];

const methods: Method[] = ['sbdf1', 'sbdf2', 'etd1', 'etd2'];
const dts = [0.1, 0.05, 0.02, 0.01, 0.005, 0.002];
const rows: string[] = ['method,dt,err_vs_radau,err_vs_ode15s,wall_ms,status'];
const table: Record<string, Record<string, number>> = {};

for (const m of methods) {
  table[m] = {};
  let prev = NaN;
  for (const dt of dts) {
    const res = simulate(DEFAULT_PARAMS, { method: m, dt, tEnd: 3000 });
    if (res.status !== 'ok') {
      console.log(`${m.padEnd(6)} dt=${dt}: UNSTABLE at t=${res.unstableAt}`);
      rows.push(`${m},${dt},NaN,NaN,${res.wallMs.toFixed(0)},unstable`);
      prev = NaN; continue;
    }
    const eR = compare(res, radT, radRef, radRest).worst;
    const eO = compare(res, csvT, odeRef, radRest).worst;
    const order = Number.isFinite(prev) ? Math.log(prev / eR) / Math.log(dts[dts.indexOf(dt) - 1] / dt) : NaN;
    console.log(`${m.padEnd(6)} dt=${String(dt).padEnd(6)} err vs Radau ${eR.toExponential(2)}  vs ode15s ${eO.toExponential(2)}  ` +
      `${Number.isFinite(order) ? 'order ' + order.toFixed(2) : '         '}  ${res.wallMs.toFixed(0)} ms`);
    rows.push(`${m},${dt},${eR},${eO},${res.wallMs.toFixed(1)},ok`);
    table[m][dt] = eR;
    prev = eR;
  }
}

// explicit baseline: RK4 blows up unless dt is below the diffusion stability limit
for (const dt of [1e-3, 1e-4, 1e-5]) {
  const res = simulate(DEFAULT_PARAMS, { method: 'rk4', dt, tEnd: 5, tPre: 1 });
  console.log(`rk4    dt=${dt}: ${res.status}${res.unstableAt !== undefined ? ' at t=' + res.unstableAt : ''}`);
}

writeFileSync('validation/convergence.csv', rows.join('\n') + '\n');
writeFileSync('validation/convergence.json', JSON.stringify(table, null, 1));
console.log('written validation/convergence.csv');
