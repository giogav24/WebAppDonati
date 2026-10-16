// Small dense / tridiagonal linear algebra, no dependencies.
// Dense matrices are row-major Float64Array of size n*n.

import type { Tridiag } from './model.ts';

/** Solve (c·I − h·T) x = b for tridiagonal T (Thomas algorithm). x may alias b. */
export function solveShiftedTridiag(T: Tridiag, c: number, h: number,
                                    b: Float64Array, x: Float64Array,
                                    work: Float64Array): void {
  const n = T.diag.length;
  // work holds the modified upper diagonal
  let denom = c - h * T.diag[0];
  work[0] = (-h * T.upper[0]) / denom;
  x[0] = b[0] / denom;
  for (let i = 1; i < n; i++) {
    const lo = -h * T.lower[i];
    denom = c - h * T.diag[i] - lo * work[i - 1];
    work[i] = i < n - 1 ? (-h * T.upper[i]) / denom : 0;
    x[i] = (b[i] - lo * x[i - 1]) / denom;
  }
  for (let i = n - 2; i >= 0; i--) x[i] -= work[i] * x[i + 1];
}

export function tridiagToDense(T: Tridiag, scale = 1): Float64Array {
  const n = T.diag.length;
  const M = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    M[i * n + i] = scale * T.diag[i];
    if (i > 0) M[i * n + i - 1] = scale * T.lower[i];
    if (i < n - 1) M[i * n + i + 1] = scale * T.upper[i];
  }
  return M;
}

export function matmul(A: Float64Array, B: Float64Array, n: number): Float64Array {
  const C = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      const a = A[i * n + k];
      if (a === 0) continue;
      const rowB = k * n, rowC = i * n;
      for (let j = 0; j < n; j++) C[rowC + j] += a * B[rowB + j];
    }
  }
  return C;
}

function normInf(A: Float64Array, n: number): number {
  let m = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += Math.abs(A[i * n + j]);
    if (s > m) m = s;
  }
  return m;
}

/** Solve P X = Q (dense, partial pivoting). Overwrites P; returns X. */
function solveDense(P: Float64Array, Q: Float64Array, n: number): Float64Array {
  const X = Q.slice();
  for (let col = 0; col < n; col++) {
    let piv = col, best = Math.abs(P[col * n + col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(P[r * n + col]);
      if (v > best) { best = v; piv = r; }
    }
    if (piv !== col) {
      for (let j = 0; j < n; j++) {
        let t = P[col * n + j]; P[col * n + j] = P[piv * n + j]; P[piv * n + j] = t;
        t = X[col * n + j]; X[col * n + j] = X[piv * n + j]; X[piv * n + j] = t;
      }
    }
    const d = P[col * n + col];
    for (let r = col + 1; r < n; r++) {
      const f = P[r * n + col] / d;
      if (f === 0) continue;
      for (let j = col; j < n; j++) P[r * n + j] -= f * P[col * n + j];
      for (let j = 0; j < n; j++) X[r * n + j] -= f * X[col * n + j];
    }
  }
  for (let col = n - 1; col >= 0; col--) {
    const d = P[col * n + col];
    for (let j = 0; j < n; j++) X[col * n + j] /= d;
    for (let r = 0; r < col; r++) {
      const f = P[r * n + col];
      if (f === 0) continue;
      for (let j = 0; j < n; j++) X[r * n + j] -= f * X[col * n + j];
    }
  }
  return X;
}

/**
 * Matrix exponential by scaling and squaring with a diagonal (8,8) Padé
 * approximant (Golub & Van Loan, Alg. 11.3.1). ‖A/2^s‖∞ ≤ 0.5 gives a
 * truncation error far below double precision for this degree.
 */
export function expm(A: Float64Array, n: number): Float64Array {
  const q = 8;
  const nrm = normInf(A, n);
  const s = nrm > 0.5 ? Math.max(0, Math.ceil(Math.log2(nrm / 0.5))) : 0;
  const scale = Math.pow(2, -s);
  const As = A.map((v) => v * scale);

  let c = 1;
  const N = new Float64Array(n * n);
  const Dm = new Float64Array(n * n);
  for (let i = 0; i < n; i++) { N[i * n + i] = 1; Dm[i * n + i] = 1; }
  let X: Float64Array = new Float64Array(n * n);
  for (let i = 0; i < n; i++) X[i * n + i] = 1;
  for (let kk = 1; kk <= q; kk++) {
    c = (c * (q - kk + 1)) / (kk * (2 * q - kk + 1));
    X = matmul(As, X, n);
    const sign = kk % 2 === 0 ? 1 : -1;
    for (let i = 0; i < n * n; i++) {
      N[i] += c * X[i];
      Dm[i] += sign * c * X[i];
    }
  }
  let E = solveDense(Dm, N, n);
  for (let i = 0; i < s; i++) E = matmul(E, E, n);
  return E;
}

/**
 * φ-functions of a dense matrix M (already multiplied by the step h):
 *   φ0 = e^M,  φ1 = M⁻¹(e^M − I),  φ2 = M⁻²(e^M − I − M),
 * from one exponential of the augmented 3n×3n matrix
 *   [[M, I, 0], [0, 0, I], [0, 0, 0]]  (Saad 1992; Sidje 1998),
 * which avoids inverting M (singular here when D = 0).
 */
export function phiFunctions(M: Float64Array, n: number): [Float64Array, Float64Array, Float64Array] {
  const m = 3 * n;
  const B = new Float64Array(m * m);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) B[i * m + j] = M[i * n + j];
    B[i * m + n + i] = 1;
    B[(n + i) * m + 2 * n + i] = 1;
  }
  const EB = expm(B, m);
  const phi0 = new Float64Array(n * n), phi1 = new Float64Array(n * n), phi2 = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      phi0[i * n + j] = EB[i * m + j];
      phi1[i * n + j] = EB[i * m + n + j];
      phi2[i * n + j] = EB[i * m + 2 * n + j];
    }
  }
  return [phi0, phi1, phi2];
}

/** Scalar φ-functions, with series near z = 0 to avoid cancellation. */
export function phiScalar(z: number): [number, number, number] {
  const e = Math.exp(z);
  if (Math.abs(z) < 1e-3) {
    return [e, 1 + z / 2 + (z * z) / 6 + (z * z * z) / 24, 0.5 + z / 6 + (z * z) / 24 + (z * z * z) / 120];
  }
  const p1 = (e - 1) / z;
  return [e, p1, (p1 - 1) / z];
}
