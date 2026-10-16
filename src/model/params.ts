// Parameters of the Donati et al. (2022) model, exactly as in the published
// MATLAB code by M. G. Pedersen (University of Padova).
// Units: µM, s, µm.

export interface Params {
  // --- user-tunable (the `par` vector of the original code) ---
  D: number;        // ATP diffusion coefficient [µm²/s]
  k: number;        // extracellular ATP degradation rate [1/s] (ARL ×0.5, apyrase ×10)
  PIP3R: number;    // IP3R flux scale [1/s]
  vSERCA: number;   // SERCA max rate [µM/s]
  L: number;        // ER leak rate [1/s]
  vplc: number;     // max IP3 production rate [µM/s]
  kplc: number;     // ATP half-activation for PLC (P2Y) [µM]
  kip: number;      // IP3 degradation rate [1/s]
  kHC: number;      // hemichannel ATP release rate [µM/s]
  nplc: number;     // Hill coefficient of P2Y→PLC
  ac0: number;      // ATP content of the photodamaged cell at t = 0 [µM]

  // --- fixed constants inside ATP_model() ---
  Ki: number; Ka: number; A: number; Kd: number; // Li–Rinzel
  kSERCA: number;
  CaT: number;      // total Ca per cell (cytosol + ER/σ) [µM]
  sigma: number;    // ER/cytosol volume ratio
  deltar: number;   // radial spacing (one cell) [µm]
  deltah: number;   // thickness of the extracellular layer above the target [µm]
  kon: number; koff: number; Btot: number;  // GCaMP6s
  caplcpar: number; Kcaplc: number; tauPsi: number; // Ca²⁺ feedback on PLC
  KHC: number; nHC: number; // hemichannel Ca²⁺ gating
}

export const DEFAULT_PARAMS: Params = {
  D: 65,
  k: 0.27,
  PIP3R: 42625,
  vSERCA: 65,
  L: 0.5,
  vplc: 1.85,
  kplc: 1.05,
  kip: 15,
  kHC: 1200,
  nplc: 1,
  ac0: 800,

  Ki: 1, Ka: 0.4, A: 5, Kd: 0.4,
  kSERCA: 0.2,
  CaT: 2,
  sigma: 0.1,
  deltar: 10,
  deltah: 0.02,
  kon: 7.78, koff: 1.12, Btot: 7.4,
  caplcpar: 0.6, Kcaplc: 0.3, tauPsi: 30,
  KHC: 0.3, nHC: 8,
};

/** Pharmacological conditions described in the original code. */
export const PRESETS = {
  control: { label: 'Control', k: 0.27 },
  arl: { label: 'ARL 67156 (ecto-ATPase block, k × 0.5)', k: 0.27 * 0.5 },
  apyrase: { label: 'Apyrase (k × 10)', k: 0.27 * 10 },
} as const;

export const N_CELLS = 20;
export const N_STATE = 6 * N_CELLS + 2; // 122

// State layout (identical to the MATLAB Y vector, 0-based):
export const IDX = {
  a: 0,      // a[0..19]   extracellular ATP above ring j (r = 10..200 µm)
  ac: 20,    // ATP inside the photodamaged cell
  a0: 21,    // ATP in the thin layer above the photodamaged cell
  ip3: 22,   // ip3[0..19]
  ca: 42,    // ca[0..19]  cytosolic Ca²⁺
  h: 62,     // h[0..19]   IP3R inactivation gate
  CaB: 82,   // CaB[0..19] Ca²⁺-bound GCaMP (→ fluorescence)
  psi: 102,  // psi[0..19] Ca²⁺ feedback on PLC
} as const;

export function initialState(p: Params): Float64Array {
  const y = new Float64Array(N_STATE);
  y[IDX.ac] = p.ac0;
  for (let j = 0; j < N_CELLS; j++) {
    y[IDX.ca + j] = 0.068;
    y[IDX.h + j] = 0.85;
    y[IDX.CaB + j] = 2.375;
  }
  return y;
}
