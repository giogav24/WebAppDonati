# Calcium waves in photodamaged skin — interactive model

An in-browser reimplementation of the mathematical model of

> V. Donati, C. Peres, C. Nardin, F. Scavizzi, M. Raspa, C. D. Ciubotaru, M. Bortolozzi,
> M. G. Pedersen, F. Mammano. *Calcium signaling in the photodamaged skin: in vivo experiments
> and mathematical modeling.* **Function**, 2022.

A laser pulse ruptures a single basal keratinocyte; the ATP it releases diffuses through the
extracellular space, activates P2Y receptors on bystander cells and triggers an IP₃-mediated
Ca²⁺ wave, read out in vivo with GCaMP6s. The web app integrates the **complete published ODE
system (122 equations)** live, with semi-implicit and exponential integrators written for this
stiff problem, and lets you change any parameter and watch the wave, the ATP field and the IP₃
response update.

## What is in it

- **Model** (`src/model/model.ts`): line-by-line port of the authors' MATLAB code
  (M. G. Pedersen). Radially symmetric epidermis: the damaged cell, the 20 nm extracellular layer
  above it, and 20 rings of bystander cells (Δr = 10 µm). Per ring: extracellular ATP, IP₃,
  cytosolic Ca²⁺, the Li–Rinzel IP₃R gate *h*, Ca²⁺-bound GCaMP6s and the slow Ca²⁺→PLC feedback ψ.
  Constants and simplifications are kept exactly as published (e.g. ER Ca²⁺ from conservation
  without the GCaMP-bound pool), so the app reproduces the paper's figures, not a variant.
- **Integrators** (`src/model/integrators.ts`), fixed step, no dependencies:
  | method | type | order |
  |---|---|---|
  | SBDF1 / SBDF2 | semi-implicit (IMEX) Euler / BDF2 | 1 / 2 |
  | ETD1 / ETD2RK | exponential Euler / Cox–Matthews ETD2RK | 1 / 2 |
  | RK4 | explicit baseline | 4 |
- **App** (React): a simulated top view of the epidermis (Voronoi keratinocytes coloured by
  GCaMP ΔF/F, ATP or IP₃), playback, the paper's time courses at 10–80 µm, wave-front radius,
  pharmacological conditions from the original code (ARL 67156: *k* × 0.5, apyrase: *k* × 10,
  plus hemichannels off), a grey comparison run, and a numerics panel with live error against
  the original MATLAB solution.

## Numerics

The Jacobian has two widely separated stiff scales:

1. ATP exchange between the damaged cell, the thin layer above it and the first ring:
   eigenvalues down to **D/δh² ≈ 1.6·10⁵ s⁻¹** (δh = 0.02 µm). This part is **linear and constant**,
   and tridiagonal in the ordering [ac, a0, a1 … a20].
2. Cytosolic Ca²⁺ self-coupling through SERCA and GCaMP buffering: up to **≈ 3·10² s⁻¹**,
   **nonlinear**.

The wave itself evolves over tens of minutes, so an explicit method is hopeless: RK4 needs
Δt ≈ 10⁻⁵ s (≈ 3·10⁸ steps for the 50 min run) and blows up at 10⁻⁴ s.

At every step the right-hand side is split as f(y) = Λy + N(y), with Λ = T ⊕ diag(λᵢ):
*T* is the ATP operator and λᵢ = min(∂fᵢ/∂yᵢ, 0) is the analytic Jacobian diagonal of every
other state, frozen at yⁿ. Within a step this is an exact rewriting of the ODE, so the schemes
keep their formal order.

- **Semi-implicit**: (c I − hΛ) yⁿ⁺¹ = rhs is an O(22) Thomas sweep plus a diagonal division.
  SBDF2 restarts with one SBDF1 step at the photodamage (t = 0), where D and k_HC switch on.
- **Exponential**: e^{hT}, φ₁(hT), φ₂(hT) are computed once per run from a single exponential of
  the 66 × 66 augmented matrix [[hT, I, 0], [0, 0, I], [0, 0, 0]] (scaling and squaring with an
  (8,8) Padé approximant), which avoids inverting *T*; the diagonal φ-functions are scalar.
- **Rest state**: like the original code, the system rests 1000 s without release before the
  pulse. This converges to the unstimulated steady state (|f| < 10⁻¹⁴), which does not depend on
  the integrator, so it is reached with large semi-implicit steps and cached.

## Validation

Two references, both at the published parameters:

- the **original MATLAB code run with `ode15s`** (AbsTol 10⁻⁸, RelTol 10⁻⁶),
  `validation/ode15s_ref.csv.gz`;
- an **independent SciPy port integrated with Radau** at rtol 10⁻¹⁰ (`scripts/reference_scipy.py`).

The two references agree to **3·10⁻⁶** (max |ΔCa²⁺| / response amplitude over 50 min).

Error of the browser integrators: largest deviation of cytosolic Ca²⁺ over rings 10–80 µm and
50 min, relative to each ring's response amplitude (`validation/convergence.csv`):

| Δt [s] | SBDF1 | SBDF2 | ETD1 | ETD2RK |
|---|---|---|---|---|
| 0.1   | 4.1e-1 | 1.5e+0 | 3.5e-1 | 1.5e-1 |
| 0.05  | 2.6e-1 | 1.4e-1 | 1.9e-1 | 5.1e-2 |
| 0.02  | 1.1e-1 | 1.2e-2 | 6.9e-2 | 1.4e-2 |
| 0.01  | 5.4e-2 | 2.3e-3 | 3.2e-2 | 4.2e-3 |
| 0.005 | 2.6e-2 | 6.7e-4 | 1.4e-2 | 1.2e-3 |
| 0.002 | 1.0e-2 | 1.2e-4 | 5.3e-3 | 2.0e-4 |

Observed orders approach 1 and 2 as expected. The maximum is set by the fastest event, the
Ca²⁺ upstroke in the first ring within ~0.5 s of the pulse; after the first 2 s the default
SBDF2 at Δt = 10 ms is within 10⁻⁴ of `ode15s`. At large steps ETD2RK is markedly more robust
than SBDF2, whose extrapolated explicit part overshoots the upstroke.

The app normalises ΔF/F for every run to the peak of the control run in the first 30 s
(the original code normalises each run to itself), so drug conditions are on a common scale.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173, rebuilds on change
npm run build      # dist/index.html + dist/standalone.html (single self-contained file)
```

Reproduce the validation (Python 3 with NumPy/SciPy):

```bash
npm run reference  # SciPy Radau reference → validation/*.f64
npm run validate   # convergence study against Radau and ode15s
```

To regenerate the MATLAB reference, run the authors' script with `vpmca = 0;` defined before
`par` (it is referenced but unused in the original) and export after `ode15s`:

```matlab
options = odeset('AbsTol',1e-8,'RelTol',1e-6,'MaxStep',1);
idx = find((T >= -1 & T <= 60) | mod(round(T*10),10) == 0);
writematrix([T(idx) Y(idx,:)], 'ode15s_ref.csv');
```

## Layout

```
src/model/params.ts        published parameters, state layout, initial conditions
src/model/model.ts         RHS, ATP operator, analytic Jacobian diagonal
src/model/linalg.ts        Thomas solver, Padé expm, φ-functions
src/model/integrators.ts   SBDF1/2, ETD1/2RK, RK4, sampling
src/model/observables.ts   ΔF/F normalisation and wave front, as in the paper
src/worker.ts              simulation in a Web Worker
src/components/            microscope view, charts, controls
scripts/                   build, SciPy reference, validation
validation/                references and convergence results
```

## Credits

Model, equations and original MATLAB code: Donati et al. (2022); model code by
Morten Gram Pedersen, University of Padova. This reimplementation: Giorgia Gavioli.
