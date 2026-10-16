// Quantities plotted in Donati et al. (2022), computed as in the original code.

import { IDX, N_CELLS, N_STATE } from './params.ts';
import type { SimResult } from './integrators.ts';

export const RADII = Array.from({ length: N_CELLS }, (_, j) => 10 * (j + 1)); // µm

export function series(res: SimResult, offset: number, cell: number): Float64Array {
  const n = res.t.length;
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) out[k] = res.Y[k * N_STATE + offset + cell];
  return out;
}

/**
 * Normalised GCaMP fluorescence, as in the original code:
 *   ΔF = CaB − CaB(rest);  ΔF/F normalised by max ΔF over t < 30 s and all cells.
 * Pass `fixedNorm` to put several runs on a common scale (the app uses the
 * control run's normalisation, so drug conditions are comparable).
 */
export function normalizedDF(res: SimResult, fixedNorm?: number): { dF: Float64Array[]; norm: number } {
  const n = res.t.length;
  const dF: Float64Array[] = [];
  let norm = 0;
  for (let j = 0; j < N_CELLS; j++) {
    const base = res.rest[IDX.CaB + j];
    const s = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      s[k] = res.Y[k * N_STATE + IDX.CaB + j] - base;
      if (res.t[k] < 30 && s[k] > norm) norm = s[k];
    }
    dF.push(s);
  }
  if (fixedNorm !== undefined) norm = fixedNorm;
  if (norm > 0) for (const s of dF) for (let k = 0; k < n; k++) s[k] /= norm;
  return { dF, norm };
}

/**
 * Wave front: radius at which the normalised ΔF crosses `threshold` (0.3 in the
 * paper), by linear interpolation over the first `nCells` rings. NaN when the
 * front is not inside [10, 10·nCells] µm (as MATLAB's interp1).
 */
export function frontRadius(dF: Float64Array[], k: number, threshold = 0.3, nCells = 8): number {
  if (dF[0][k] < threshold) return NaN;
  for (let j = 0; j < nCells - 1; j++) {
    const a = dF[j][k], b = dF[j + 1][k];
    if (a >= threshold && b < threshold) {
      return RADII[j] + ((a - threshold) / (a - b)) * (RADII[j + 1] - RADII[j]);
    }
  }
  return NaN;
}

export function frontSeries(res: SimResult, dF: Float64Array[], threshold = 0.3, nCells = 8): Float64Array {
  const out = new Float64Array(res.t.length);
  for (let k = 0; k < out.length; k++) out[k] = frontRadius(dF, k, threshold, nCells);
  return out;
}

/** Summary metrics shown in the UI. */
export function waveMetrics(res: SimResult, dF: Float64Array[], threshold = 0.3) {
  // maximal extent: outermost ring whose normalised ΔF ever exceeds the threshold
  let maxRing = 0;
  for (let j = 0; j < N_CELLS; j++) {
    let peak = -Infinity;
    for (const v of dF[j]) if (v > peak) peak = v;
    if (peak >= threshold) maxRing = j + 1;
  }
  const front = frontSeries(res, dF, threshold, N_CELLS);
  let maxFront = 0, tMaxFront = 0;
  for (let k = 0; k < front.length; k++) {
    if (front[k] > maxFront) { maxFront = front[k]; tMaxFront = res.t[k]; }
  }
  return { maxExtent: maxRing * 10, maxFront, tMaxFront };
}
