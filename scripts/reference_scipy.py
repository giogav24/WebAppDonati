"""Independent high-accuracy reference for the Donati et al. (2022) model.

Line-by-line port of ATP_model() from the original MATLAB code, integrated with
SciPy's Radau (implicit Runge-Kutta, order 5) at tight tolerances. Used to
(i) cross-check the MATLAB ode15s trajectory and (ii) measure the convergence
order of the fixed-step integrators of the web app.

Usage:  python3 scripts/reference_scipy.py [out.npz]
"""
import sys
import numpy as np
from scipy.integrate import solve_ivp

P = dict(D=65, k=0.27, PIP3R=42625, vSERCA=65, L=0.5, vplc=1.85, kplc=1.05,
         kip=15, kHC=1200, nplc=1)


def atp_model(t, Y, released, p=P):
    D = p["D"] * released
    kHC = p["kHC"] * released
    k, PIP3R, vSERCA, L = p["k"], p["PIP3R"], p["vSERCA"], p["L"]
    vplc, kplc, nplc, kip = p["vplc"], p["kplc"], p["nplc"], p["kip"]
    Ki, Ka, A, Kd = 1, 0.4, 5, 0.4
    kSERCA = 0.2
    CaT, sigma = 2, 0.1
    deltar, deltah = 10, 0.02
    kon, koff, Btot = 7.78, 1.12, 7.4

    a = np.empty(21)
    a[:20] = Y[0:20]
    a[20] = a[19]
    ac, a0 = Y[20], Y[21]
    ip3 = Y[22:42]
    ca = Y[42:62]
    caER = (CaT - ca) / sigma
    h = Y[62:82]
    CaB = Y[82:102]
    psi = Y[102:122]

    ca_on_plc = 0.6 * ca / (ca + 0.3)
    jchan = PIP3R * (ip3 / (ip3 + Ki)) ** 3 * (ca / (ca + Ka)) ** 3 * h ** 3 * (caER - ca)
    jpump = vSERCA * ca ** 2 / (kSERCA ** 2 + ca ** 2)
    jleak = L * (caER - ca)

    dac = -D / (deltah * deltar) * (ac - a0)
    da0 = 4 * D / deltar ** 2 * (a[0] - a0) + D / deltah ** 2 * (ac - a0) - k * a0

    j = np.arange(1, 21)
    am1 = np.concatenate(([a0], a[:19]))
    hc = kHC * ca ** 8 / (ca ** 8 + 0.3 ** 8)
    da = (D / (2 * j * deltar ** 2)) * ((2 * j + 1) * a[1:21] - 4 * j * a[:20] + (2 * j - 1) * am1) \
        - k * a[:20] + hc

    dpsi = (ca_on_plc - psi) / 30
    dip3 = (1 + psi) * vplc * a[:20] ** nplc / (a[:20] ** nplc + kplc ** nplc) - kip * ip3
    buff = kon * ca * (Btot - CaB) - koff * CaB
    dca = (jchan - jpump + jleak) - 3 * buff
    dh = A * (Kd - (ca + Kd) * h)
    return np.concatenate((da, [dac, da0], dip3, dca, dh, buff, dpsi))


def y0():
    return np.concatenate((np.zeros(20), [800.0, 0.0], np.zeros(20), 0.068 + np.zeros(20),
                           0.85 + np.zeros(20), 2.375 + np.zeros(20), np.zeros(20)))


def sample_grid(t_end=3000.0):
    fine = np.round(np.arange(0, 600 + 1) * 0.1, 10)
    coarse = np.arange(61.0, t_end + 0.5, 1.0)
    return np.concatenate((fine, coarse))


def run(rtol=1e-10, atol=1e-12, t_end=3000.0):
    # pre-equilibration, no release (heaviside(t) = 0 for t < 0)
    pre = solve_ivp(atp_model, (-1000, 0), y0(), method="Radau", args=(0.0,),
                    rtol=rtol, atol=atol)
    rest = pre.y[:, -1]
    ts = sample_grid(t_end)
    post = solve_ivp(atp_model, (0, t_end), rest, method="Radau", args=(1.0,),
                     rtol=rtol, atol=atol, t_eval=ts, max_step=1.0)
    assert post.success, post.message
    return ts, post.y.T, rest


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "validation/scipy_radau_ref.npz"
    ts, Y, rest = run()
    np.savez_compressed(out, t=ts, Y=Y, rest=rest)
    # raw little-endian float64 copies read by scripts/validate.ts
    base = out.rsplit("/", 1)[0] if "/" in out else "."
    ts.astype("<f8").tofile(f"{base}/radau_t.f64")
    Y.astype("<f8").tofile(f"{base}/radau_Y.f64")
    rest.astype("<f8").tofile(f"{base}/radau_rest.f64")
    print("saved", out, Y.shape)
