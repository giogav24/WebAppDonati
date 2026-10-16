// Right-hand side of the Donati et al. (2022) model.
//
// The radial geometry is the one of the original code: the photodamaged cell
// (ac) releases ATP into a thin extracellular layer above it (a0, thickness
// δh = 0.02 µm), from which ATP diffuses over 20 concentric rings of bystander
// cells (Δr = 10 µm).
//
// Two sources of stiffness (eigenvalues of the Jacobian):
//   • ATP exchange between ac, a0 and the first ring: D/δh² ≈ 1.6·10⁵ s⁻¹.
//     It is LINEAR and constant → tridiagonal operator T (22 nodes).
//   • cytosolic Ca²⁺ self-coupling (SERCA + GCaMP buffering): up to ≈ 3·10² s⁻¹.
//     It is NONLINEAR → handled through the diagonal of the analytic Jacobian,
//     re-evaluated at every step (see integrators.ts).

import { IDX, N_CELLS, N_STATE, type Params } from './params.ts';

export const N_ATP = N_CELLS + 2; // 22 tridiagonal nodes

/** Node order of the ATP chain: [ac, a0, a1, …, a20] → index in the state vector. */
export const ATP_NODE_TO_IDX: Int32Array = (() => {
  const m = new Int32Array(N_ATP);
  m[0] = IDX.ac;
  m[1] = IDX.a0;
  for (let j = 0; j < N_CELLS; j++) m[2 + j] = IDX.a + j;
  return m;
})();

export const IS_ATP: Uint8Array = (() => {
  const m = new Uint8Array(N_STATE);
  for (const i of ATP_NODE_TO_IDX) m[i] = 1;
  return m;
})();

/** Tridiagonal operator: lower[i]·x[i-1] + diag[i]·x[i] + upper[i]·x[i+1]. */
export interface Tridiag {
  lower: Float64Array;
  diag: Float64Array;
  upper: Float64Array;
}

/**
 * Linear ATP operator (diffusion + degradation). Before the photodamage
 * (t < 0) the original code multiplies D and kHC by heaviside(t), so only
 * degradation is active.
 */
export function buildAtpOperator(p: Params, released: boolean): Tridiag {
  const D = released ? p.D : 0;
  const { k, deltar: dr, deltah: dh } = p;
  const lower = new Float64Array(N_ATP);
  const diag = new Float64Array(N_ATP);
  const upper = new Float64Array(N_ATP);

  // ac:  dac = -D/(δh Δr) (ac - a0)
  diag[0] = -D / (dh * dr);
  upper[0] = D / (dh * dr);
  // a0:  da0 = 4D/Δr² (a1 - a0) + D/δh² (ac - a0) - k a0
  lower[1] = D / (dh * dh);
  diag[1] = -4 * D / (dr * dr) - D / (dh * dh) - k;
  upper[1] = 4 * D / (dr * dr);
  // a_j, j = 1..20 (1-based as in MATLAB):
  //   da_j = D/(2 j Δr²) [(2j+1) a_{j+1} - 4j a_j + (2j-1) a_{j-1}] - k a_j,
  //   with a_0 ≡ a0 and the zero-flux condition a_21 ≡ a_20.
  for (let j = 1; j <= N_CELLS; j++) {
    const i = 1 + j;
    const c = D / (2 * j * dr * dr);
    lower[i] = c * (2 * j - 1);
    diag[i] = -c * 4 * j - k;
    if (j < N_CELLS) upper[i] = c * (2 * j + 1);
    else diag[i] += c * (2 * j + 1); // reflecting outer boundary
  }
  return { lower, diag, upper };
}

/** out[ATP idx] += T · y_atp */
export function addAtpLinear(T: Tridiag, y: Float64Array, out: Float64Array): void {
  const m = ATP_NODE_TO_IDX;
  for (let i = 0; i < N_ATP; i++) {
    let s = T.diag[i] * y[m[i]];
    if (i > 0) s += T.lower[i] * y[m[i - 1]];
    if (i < N_ATP - 1) s += T.upper[i] * y[m[i + 1]];
    out[m[i]] += s;
  }
}

/**
 * Everything except the linear ATP operator:
 *  - ATP entries: hemichannel release kHC·ca⁸/(ca⁸+0.3⁸) (0 for ac, a0)
 *  - all other states: their complete right-hand side.
 * If `jdiag` is given, it receives ∂f_i/∂y_i for the non-ATP states (analytic).
 */
export function reactions(p: Params, released: boolean, y: Float64Array,
                          out: Float64Array, jdiag?: Float64Array): void {
  const kHC = released ? p.kHC : 0;
  const { Ki, Ka, A, Kd, kSERCA, CaT, sigma, kon, koff, Btot, vplc, kplc, nplc, kip, PIP3R, vSERCA, L } = p;
  const nHC = p.nHC;
  const KHCn = Math.pow(p.KHC, nHC);
  const kplcn = Math.pow(kplc, nplc);
  const ks2 = kSERCA * kSERCA;
  const invTau = 1 / p.tauPsi;
  const dERdca = 1 / sigma + 1; // −∂(caER − ca)/∂ca

  out[IDX.ac] = 0;
  out[IDX.a0] = 0;

  for (let j = 0; j < N_CELLS; j++) {
    const a = y[IDX.a + j];
    const ip3 = y[IDX.ip3 + j];
    const ca = y[IDX.ca + j];
    const h = y[IDX.h + j];
    const CaB = y[IDX.CaB + j];
    const psi = y[IDX.psi + j];

    const caER = (CaT - ca) / sigma; // as in the original code (bound Ca²⁺ not counted)

    let caN: number;
    if (nHC === 8) { const c2 = ca * ca, c4 = c2 * c2; caN = c4 * c4; }
    else caN = Math.pow(ca, nHC);
    out[IDX.a + j] = kHC * caN / (caN + KHCn);

    // IP3 production via P2Y → PLC (amplified by ψ) and degradation
    const an = nplc === 1 ? a : Math.pow(Math.max(a, 0), nplc);
    out[IDX.ip3 + j] = (1 + psi) * vplc * an / (an + kplcn) - kip * ip3;

    // Ca²⁺ fluxes
    const fi = ip3 / (ip3 + Ki);
    const fa = ca / (ca + Ka);
    const fi3h3 = PIP3R * fi * fi * fi * h * h * h;
    const drive = caER - ca;
    const jchan = fi3h3 * fa * fa * fa * drive;
    const den = ks2 + ca * ca;
    const jpump = vSERCA * ca * ca / den;
    const jleak = L * drive;
    const free = Btot - CaB;
    const buff = kon * ca * free - koff * CaB;

    out[IDX.ca + j] = jchan - jpump + jleak - 3 * buff;
    out[IDX.h + j] = A * (Kd - (ca + Kd) * h);
    out[IDX.CaB + j] = buff;
    const caplc = p.caplcpar * ca / (ca + p.Kcaplc);
    out[IDX.psi + j] = (caplc - psi) * invTau;

    if (jdiag) {
      const dfa = Ka / ((ca + Ka) * (ca + Ka));
      const djchan = fi3h3 * (3 * fa * fa * dfa * drive - fa * fa * fa * dERdca);
      const djpump = vSERCA * 2 * ca * ks2 / (den * den);
      jdiag[IDX.ca + j] = djchan - djpump - L * dERdca - 3 * kon * free;
      jdiag[IDX.ip3 + j] = -kip;
      jdiag[IDX.h + j] = -A * (ca + Kd);
      jdiag[IDX.CaB + j] = -kon * ca - koff;
      jdiag[IDX.psi + j] = -invTau;
    }
  }
}

/** Full RHS f(y) (explicit integrator, tests). `tmp` is scratch. */
export function fullRhs(p: Params, T: Tridiag, released: boolean,
                        y: Float64Array, out: Float64Array): void {
  reactions(p, released, y, out);
  addAtpLinear(T, y, out);
}
