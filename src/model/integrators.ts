// Fixed-step integrators for the stiff Donati model.
//
// At each step the right-hand side is split as
//     f(y) = Λ y + N(y),     Λ = T ⊕ diag(λ_i),
// where T is the constant tridiagonal ATP operator (diffusion + degradation,
// eigenvalues down to −1.6·10⁵ s⁻¹) and λ_i = min(∂f_i/∂y_i, 0) is the
// analytic Jacobian diagonal of every other state, frozen at yⁿ (it captures
// the SERCA/GCaMP stiffness of cytosolic Ca²⁺, up to ≈ 3·10² s⁻¹). Within a
// step the splitting is an exact rewriting of the ODE, so the formal order of
// each scheme is preserved.
//
//  sbdf1  semi-implicit Euler:      (I − hΛ) yⁿ⁺¹ = yⁿ + h N(yⁿ)
//  sbdf2  semi-implicit BDF2:       (3/2 I − hΛ) yⁿ⁺¹ = 2yⁿ − ½yⁿ⁻¹ + h(2N(yⁿ) − N(yⁿ⁻¹))
//  etd1   exponential Euler:        yⁿ⁺¹ = e^{hΛ} yⁿ + h φ1(hΛ) N(yⁿ)
//  etd2   ETD2RK (Cox & Matthews 2002):
//                                   a = e^{hΛ} yⁿ + h φ1(hΛ) N(yⁿ)
//                                   yⁿ⁺¹ = a + h φ2(hΛ) (N(a) − N(yⁿ))
//  rk4    classical explicit RK4 — baseline showing why the problem is stiff.
//
// The tridiagonal solve is an O(22) Thomas sweep; e^{hT}, φ1(hT), φ2(hT) are
// computed once per phase from a 66×66 augmented matrix exponential; the
// diagonal φ-functions are scalar and recomputed every step.

import { IDX, N_STATE, initialState, type Params } from './params.ts';
import {
  ATP_NODE_TO_IDX, IS_ATP, N_ATP, addAtpLinear, buildAtpOperator, reactions,
  type Tridiag,
} from './model.ts';
import { phiFunctions, solveShiftedTridiag, tridiagToDense } from './linalg.ts';

export type Method = 'sbdf1' | 'sbdf2' | 'etd1' | 'etd2' | 'rk4';

export const METHODS: { id: Method; label: string; short: string; order: number; kind: string }[] = [
  { id: 'sbdf2', label: 'Semi-implicit BDF2 (IMEX)', short: 'SBDF2', order: 2, kind: 'semi-implicit' },
  { id: 'etd2', label: 'ETD2RK (exponential)', short: 'ETD2RK', order: 2, kind: 'exponential' },
  { id: 'sbdf1', label: 'Semi-implicit Euler (IMEX)', short: 'SBDF1', order: 1, kind: 'semi-implicit' },
  { id: 'etd1', label: 'Exponential Euler', short: 'ETD1', order: 1, kind: 'exponential' },
  { id: 'rk4', label: 'Explicit RK4 (baseline)', short: 'RK4', order: 4, kind: 'explicit' },
];

class PhaseStepper {
  private readonly p: Params;
  private readonly released: boolean;
  private readonly h: number;
  private readonly method: Method;
  private readonly T: Tridiag;
  private readonly f0 = new Float64Array(N_STATE);   // reactions(yⁿ)
  private readonly f1 = new Float64Array(N_STATE);   // reactions(predictor)
  private readonly fPrev = new Float64Array(N_STATE);
  private readonly yPrev = new Float64Array(N_STATE);
  private readonly lam = new Float64Array(N_STATE);
  private readonly tmp = new Float64Array(N_STATE);
  private readonly k1 = new Float64Array(N_STATE);
  private readonly k2 = new Float64Array(N_STATE);
  private readonly k3 = new Float64Array(N_STATE);
  private readonly k4 = new Float64Array(N_STATE);
  private readonly u = new Float64Array(N_ATP);
  private readonly v = new Float64Array(N_ATP);
  private readonly w = new Float64Array(N_ATP);
  private readonly work = new Float64Array(N_ATP);
  private hasHistory = false;
  private E?: Float64Array; private P1?: Float64Array; private P2?: Float64Array;

  constructor(p: Params, released: boolean, h: number, method: Method) {
    this.p = p; this.released = released; this.h = h; this.method = method;
    this.T = buildAtpOperator(p, released);
    if (method === 'etd1' || method === 'etd2') {
      [this.E, this.P1, this.P2] = phiFunctions(tridiagToDense(this.T, h), N_ATP);
    }
  }

  step(y: Float64Array): void {
    switch (this.method) {
      case 'sbdf1': return this.stepSbdf(y, false);
      case 'sbdf2': return this.stepSbdf(y, true);
      case 'etd1': return this.stepEtd(y, false);
      case 'etd2': return this.stepEtd(y, true);
      case 'rk4': return this.stepRk4(y);
    }
  }

  /** λ_i = min(J_ii, 0) for non-ATP states, written into this.lam. */
  private evalReactions(y: Float64Array): void {
    reactions(this.p, this.released, y, this.f0, this.lam);
    const lam = this.lam;
    for (let i = 0; i < N_STATE; i++) if (IS_ATP[i] || lam[i] > 0) lam[i] = 0;
  }

  private stepSbdf(y: Float64Array, second: boolean): void {
    const { h, f0, fPrev, yPrev, lam, tmp, u, work } = this;
    this.evalReactions(y);
    const bdf2 = second && this.hasHistory;
    const c = bdf2 ? 1.5 : 1;
    // For ATP entries λ = 0 and f0 is the hemichannel source, so the same
    // formula builds the right-hand side of the tridiagonal system.
    for (let i = 0; i < N_STATE; i++) {
      const Nn = f0[i] - lam[i] * y[i];
      tmp[i] = bdf2
        ? 2 * y[i] - 0.5 * yPrev[i] + h * (2 * Nn - (fPrev[i] - lam[i] * yPrev[i]))
        : y[i] + h * Nn;
    }
    if (second) { yPrev.set(y); fPrev.set(f0); this.hasHistory = true; }
    const m = ATP_NODE_TO_IDX;
    for (let i = 0; i < N_ATP; i++) u[i] = tmp[m[i]];
    solveShiftedTridiag(this.T, c, h, u, u, work);
    for (let i = 0; i < N_ATP; i++) y[m[i]] = u[i];
    for (let i = 0; i < N_STATE; i++) {
      if (IS_ATP[i]) continue;
      y[i] = tmp[i] / (c - h * lam[i]);
    }
  }

  private dense(M: Float64Array, x: Float64Array, out: Float64Array): void {
    for (let i = 0; i < N_ATP; i++) {
      let s = 0;
      const r = i * N_ATP;
      for (let j = 0; j < N_ATP; j++) s += M[r + j] * x[j];
      out[i] = s;
    }
  }

  private stepEtd(y: Float64Array, second: boolean): void {
    const { p, released, h, f0, f1, lam, tmp, u, v, w } = this;
    const E = this.E!, P1 = this.P1!, P2 = this.P2!;
    const m = ATP_NODE_TO_IDX;
    this.evalReactions(y);
    // predictor = exponential Euler → tmp
    for (let i = 0; i < N_ATP; i++) { u[i] = y[m[i]]; v[i] = f0[m[i]]; }
    this.dense(E, u, w);
    this.dense(P1, v, u);
    for (let i = 0; i < N_ATP; i++) tmp[m[i]] = w[i] + h * u[i];
    // diagonal states: e^{z} y + h φ1(z)(f − λy) = y + h φ1(z) f
    const phi2 = this.k1; // reuse buffer for φ2 values
    for (let i = 0; i < N_STATE; i++) {
      if (IS_ATP[i]) continue;
      const z = h * lam[i];
      let p1: number, p2: number;
      if (z > -1e-3) { // series, avoids cancellation (z ≤ 0 here)
        p1 = 1 + z / 2 + (z * z) / 6 + (z * z * z) / 24;
        p2 = 0.5 + z / 6 + (z * z) / 24 + (z * z * z) / 120;
      } else {
        p1 = (Math.exp(z) - 1) / z;
        p2 = (p1 - 1) / z;
      }
      tmp[i] = y[i] + h * p1 * f0[i];
      phi2[i] = p2;
    }
    if (!second) { y.set(tmp); return; }
    // corrector with the same frozen Λ:  N(a) − N(y) = f(a) − f(y) − λ(a − y)
    reactions(p, released, tmp, f1);
    for (let i = 0; i < N_ATP; i++) v[i] = f1[m[i]] - f0[m[i]];
    this.dense(P2, v, u);
    for (let i = 0; i < N_ATP; i++) y[m[i]] = tmp[m[i]] + h * u[i];
    for (let i = 0; i < N_STATE; i++) {
      if (IS_ATP[i]) continue;
      const dN = f1[i] - f0[i] - lam[i] * (tmp[i] - y[i]);
      y[i] = tmp[i] + h * phi2[i] * dN;
    }
  }

  private f(y: Float64Array, out: Float64Array): void {
    reactions(this.p, this.released, y, out);
    addAtpLinear(this.T, y, out);
  }

  private stepRk4(y: Float64Array): void {
    const { h, k1, k2, k3, k4, tmp } = this;
    this.f(y, k1);
    for (let i = 0; i < N_STATE; i++) tmp[i] = y[i] + 0.5 * h * k1[i];
    this.f(tmp, k2);
    for (let i = 0; i < N_STATE; i++) tmp[i] = y[i] + 0.5 * h * k2[i];
    this.f(tmp, k3);
    for (let i = 0; i < N_STATE; i++) tmp[i] = y[i] + h * k3[i];
    this.f(tmp, k4);
    for (let i = 0; i < N_STATE; i++) y[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  }
}

export interface SimOptions {
  method: Method;
  dt: number;           // step [s]; must divide the sampling intervals
  tEnd: number;         // [s] after photodamage
  tPre?: number;        // pre-equilibration with no release [s] (original code: 1000)
  fineUntil?: number;   // sample every `fineEvery` s until this time, then every `coarseEvery`
  fineEvery?: number;
  coarseEvery?: number;
  onProgress?: (fraction: number) => void;
}

export interface SimResult {
  t: Float64Array;       // sample times (t = 0 is the rest state just before release)
  Y: Float64Array;       // row-major nSamples × N_STATE
  rest: Float64Array;    // state at t = 0⁻
  restResidual: number;  // max |f(rest)| — how close the rest state is to steady state
  status: 'ok' | 'unstable';
  unstableAt?: number;
  nSteps: number;
  wallMs: number;
}

export function sampleGrid(tEnd: number, fineUntil = 60, fineEvery = 0.1, coarseEvery = 1): Float64Array {
  const ts: number[] = [];
  const nf = Math.round(Math.min(fineUntil, tEnd) / fineEvery);
  for (let i = 0; i <= nf; i++) ts.push(i * fineEvery);
  const t = ts[ts.length - 1];
  const nc = Math.round((tEnd - t) / coarseEvery);
  for (let i = 1; i <= nc; i++) ts.push(t + i * coarseEvery);
  return Float64Array.from(ts);
}

function isBad(y: Float64Array): boolean {
  for (let i = 0; i < N_STATE; i++) if (!(Math.abs(y[i]) < 1e12)) return true; // catches NaN
  return false;
}

/**
 * Rest state before the photodamage. The original code integrates 1000 s with
 * no release; this converges to the steady state of the unstimulated system
 * (checked: |f| < 1e-12), which does not depend on the integrator used to reach
 * it. We therefore always reach it with large semi-implicit Euler steps.
 */
export function restState(p: Params, tPre = 1000): Float64Array {
  const y = initialState(p);
  const h = 0.05;
  const st = new PhaseStepper(p, false, h, 'sbdf1');
  const n = Math.round(tPre / h);
  for (let s = 0; s < n; s++) st.step(y);
  return y;
}

export function restResidual(p: Params, y: Float64Array): number {
  const f = new Float64Array(N_STATE);
  reactions(p, false, y, f);
  addAtpLinear(buildAtpOperator(p, false), y, f);
  let r = 0;
  for (let i = 0; i < N_STATE; i++) if (i !== IDX.ac) r = Math.max(r, Math.abs(f[i]));
  return r;
}

export function simulate(p: Params, opt: SimOptions, rest?: Float64Array): SimResult {
  const t0 = performance.now();
  const { method, dt } = opt;
  const y = rest ? rest.slice() : restState(p, opt.tPre);
  const restCopy = y.slice();

  const ts = sampleGrid(opt.tEnd, opt.fineUntil, opt.fineEvery, opt.coarseEvery);
  const Y = new Float64Array(ts.length * N_STATE);
  Y.set(y, 0);
  const st = new PhaseStepper(p, true, dt, method);
  let status: SimResult['status'] = 'ok';
  let unstableAt: number | undefined;
  let stepIndex = 0;
  const totalSteps = Math.round(opt.tEnd / dt);
  let lastReport = 0;
  for (let k = 1; k < ts.length; k++) {
    const target = Math.round(ts[k] / dt);
    while (stepIndex < target) { st.step(y); stepIndex++; }
    if (isBad(y)) {
      status = 'unstable'; unstableAt = ts[k];
      Y.fill(NaN, k * N_STATE);
      break;
    }
    Y.set(y, k * N_STATE);
    if (opt.onProgress && stepIndex - lastReport > totalSteps / 40) {
      lastReport = stepIndex; opt.onProgress(stepIndex / totalSteps);
    }
  }
  return {
    t: ts, Y, rest: restCopy, restResidual: restResidual(p, restCopy), status, unstableAt,
    nSteps: stepIndex, wallMs: performance.now() - t0,
  };
}
