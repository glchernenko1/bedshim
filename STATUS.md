# bedshim — status, decisions and handoff

Last updated: 2026-11-24 (end of session). `SPEC.md` is the contract; this file
records the implementation state, every deliberate deviation and what is left.
Read this first when resuming.

## Where we are

| Phase | State | Notes |
|---|---|---|
| P0 scaffold | done | Vite + React 19 + Ant Design 6, EN/RU, offline SW, CLI stub |
| P1 mesh | done | three mesh shapes, Klipper-exact bicubic surface, fixture golden tests |
| P2 grid + plan | done | `buildGrid`, reference + quantization, golden plan, probe advice, plan screen |
| P3 forward | done | σ-bridged prediction, residual map, `achievable`/`delivered`, mesh export |
| P4 strips | not started | pieces, batches, EN/RU instructions, printable sheet |
| P5 STL + SVG | not started | manifold lattice, 1:1 SVG |
| P6 calibration | first half done | measurement history, apply-plan state, t1/ts fit, auto-round; wizard, peel UI and project JSON remain |

Extras delivered beyond the phase table: 2D heatmap, rotatable 3D surface
(canvas, no WebGL), surface statistics (min/mean/median/Δ/MAD with plain-language
bands), measurement history, calibration tab, example picker, clear-all.

## What works today

- **Parse** — SAVE_CONFIG tail, `key: value` block and bare numbers give the same
  11×11 matrix; errors are coded and translated; several profiles are listed.
- **Surface** — Klipper's bicubic including `mesh_pps` sampling + bilinear lookup
  (checked against an independent Python port of `bed_mesh.py` at five points).
- **Analysis** — surface stats and MAD bands relative to one effective layer.
- **Plan** — 10×10 cells `A1..J10` for 20 mm tape on the fixture; reference
  quantile, deadband, `floor`/`round`, absolute layers, base layers from the
  measured state; layer map on a plate-sized frame.
- **Probe advice** — ideal count from tape width (20 mm → 11×11 = 121 points,
  ≈4 min; 10 mm → 21×20 = 420, ≈14 min), estimated time, never capped, plus a
  `printer.cfg` snippet.
- **Prediction (P3)** — tape field blurred with σ (8–60 mm), per-cell residual in
  µm, worst/RMS residual, `delivered` (bridging fidelity) and `achievable`
  (taped cells inside the deadband), plus a paste-ready `[bed_mesh predicted]`.
- **Measurements** — every parsed map is stored with its text, geometry and
  absolute layer state; select/delete; clear-all with confirmation.
- **Calibration (P6 first half)** — the Calibration tab compares two measurements
  (selectors default to the last two), fits `t1`/`ts` by least squares at the
  probe nodes (mean-detrended, σ-blurred basis), reports R²/noise/layer-change
  counts, refuses inconsistent data, and on apply writes the material and
  switches rounding to `round`.
- **Offline** — `base: './'`, service worker runtime cache; verified by two loads
  then an offline reload.

## Decisions and deviations (owner-approved)

1. **Stack React 19 + Ant Design 6** (was React 18 + Ant 5), recorded in SPEC §0.
2. **Sign is a fact:** Klipper stores the probe trigger height, so a positive mesh
   value means the plate is **high**. The first Appendix A table assumed the
   opposite and its plan was inverted; the table was regenerated. No sign toggle.
3. **No mirrored view:** tape goes on the **magnetic sheet**, the PEI plate is
   lifted off. `view` was removed from the grid, renderer and UI; the STL/SVG will
   use the same orientation with a `FRONT` marker.
4. **No conventions gate:** with no sign/view settings there is nothing to
   confirm. SPEC §2.1 is an optional shim sanity check, not a blocker.
5. **Layers are physical:** a later iteration may peel a previous overshoot, never
   below zero; the plan is compared with the physical matrix (`diffAgainstPhysical`).
6. **Plan sits on the measured state:** `baseLayers` is the layer state when the
   mesh was taken, so a re-measured bed is corrected on top of its tape instead of
   re-planning from zero (this used to be a real double-tape bug).
7. **Unknown `ts` is not invented:** `Material.ts` is `null` until measured;
   `lift(n) = t1 + (n−1)·(ts ?? t1)` and the deadband uses `ts ?? t1`. The UI
   shows an empty `ts`, the fallback `t1 = 0.6 × nominal` is only for `t1`.
8. **σ is applied by the forward model**, not before quantization; pre-smoothing
   (`smoothTarget`) exists but is off by default (it removes tape).
9. **Golden plan** (SPEC Appendix A, bicubic, sign-correct, 85th percentile,
   round): **112 layers, 22 pieces, 2240 mm**, reference +0.0463 mm. The bilinear
   and sign-inverted tables are only in git history.
10. **Calibration auto-rounds:** a successful fit sets `t1`, `ts`, marks the
    material measured and switches rounding to `round`. Rounding lives in the
    persisted store.
11. **Calibration fits at probe nodes**, not cell centres: the measured delta at a
    node is a direct sample of the bridged field. Mean detrending removes the
    post-taping Z shift; a best-fit-plane option is still future.
12. **A pair must match the recorded layers.** If the known layer states cannot
    explain the measured difference, the fit warns (`R² < 0.9`) and refuses to
    apply (`R² ≤ 0.5` or a non-positive thickness). Any pair of measurements may
    be chosen; consecutive pairs are not required.
13. **3D is canvas 2D** (orthographic projection, painter's algorithm), no WebGL.
14. **Frame is plate-sized**, cells cover the probed rectangle; unprobed margin is
    hatched and gets no tape. Extending the plan into the margin (owner's idea) is
    still open.
15. **First measurement is assumed to be a bare bed** when its layer state is
    unknown; the calibration uses zeros.

## Problems found and solved during the session

- **Inverted plan** — Appendix A claimed `positive = bed low`; Klipper's code shows
  the opposite (`bed_z = trigger z`, physical Z = command + mesh). The golden was
  inverted (tape on high edges). Re-baselined; the sign test guards it.
- **Mirrored bottom view** — based on taping a flipped plate; in reality the tape
  is on the magnetic sheet. The view setting, its core parameter and the mirrored
  rendering were removed.
- **Double taping on iteration 2** — the plan ignored tape already on the bed.
  Fixed with `baseLayers` and a regression test.
- **Fabricated `ts`** — the fallback filled `ts = 0.6 × nominal`, which is not
  measured and can inflate layer counts. Now `ts = null`, `ts ?? t1` in the maths.
- **Pair with only further-layer changes** — `t1` is not identifiable there;
  the fit now keeps `t1` from the material and solves only `ts`.
- **Bad fit from mismatched states** — e.g. planning pass 2 with `round` while the
  test mesh was generated with `floor` gave `t1 = −0.0025` or `0.007`. Added the
  R² guard and regenerated the fixtures.
- **Fit bias from cell means** — the model sampled the blurred field at cell
  centres while the measurement is a mean over the cell/node. Switched to probe
  nodes; t1/ts now recover exactly on synthetic loops.
- **Numeric underflow at tiny σ** — every Gaussian weight underflowed, giving a
  zero lift field. Fixed with the log-sum-exp trick (subtract the nearest squared
  distance).
- **`antd List` deprecated in 6.6+** — replaced with a small custom list.
- **Persist version mismatch warning** — added a `migrate` function.
- **0-cell "clipped by the plate edge" warning** — now only fires when cells really
  reach the edge.
- **`floor` deadband semantics with base layers** — the deadband now applies to the
  remaining correction, not the absolute stack.

## Calibration test data

`fixtures/test-after-pass1.cfg` and `fixtures/test-after-pass2.cfg` are synthetic
after-taping meshes with true **t1 = 0.025 mm, ts = 0.040 mm**.
Walkthrough: `fixtures/TEST-MEASUREMENTS.md`. In the app, "Load example" offers
1) original bed, 2) after pass 1 (fits t1/ts), 3) after pass 2 (fits ts).
Verified end to end in the browser: pass 1 → 0.0250 / 0.0399, R² 0.999; pass 2 →
ts 0.0399; the M1→M3 pair also recovers 0.025 / 0.040 in tests.

## What is left (in suggested order)

1. **P4 strips** — runs per level, pieces, batching, EN/RU instructions, printable
   sheet. Golden: 22 pieces / 2240 mm (SPEC §13).
2. **Plan diff UI** — show `+n add / −n peel` per cell against the physical state
   before "mark as glued"; today the plan already sits on `baseLayers`, but the
   user cannot see the difference explicitly.
3. **P5 STL + SVG** — manifold lattice (`polygon-clipping` + `earcut`), 1:1 SVG,
   `FRONT` marker; verify watertightness and bounding box.
4. **P6 remaining** — uniform-patch wizard (§9.3), per-cell calibration flags
   (bubble / not seated / noise), peel action, project JSON import/export,
   repeatability gate (§5.4).
5. **Margin** — decide whether to extend the plan into the unprobed margin by edge
   continuation (owner's idea) and how far.
6. **Polish** — lazy tabs for the 727 kB bundle (Vite warning), PWA icons,
   optional `migrate` cleanup.

## Verification and how to run

```bash
npm run dev        # or: npm run dev -- --host 0.0.0.0 --port 5173
npm test           # 93 tests, node environment
npm run typecheck  # tsc --noEmit
npm run build      # dist/, offline reload verified in Chromium
npm run cli -- parse fixtures/neptune4-mesh.cfg
```

The phone checks use `http://<LAN IP>:5173`; the dev server is started with
`--host 0.0.0.0`. The ufw rule (if added) is
`5173/tcp allow from 192.168.1.0/24 # bedshim dev (P0 P1 review)`.

## Open assumptions / known issues

- The first measurement is assumed bare; starting with tape already on the bed
  makes the first fit wrong (the history has no way to enter an initial state yet).
- Peel is allowed by the model but not proposed by the planner; the diff screen
  is still to come.
- Calibration pairs depend on the recorded layer states: changing tape width,
  percentile or rounding between planning and measuring makes the pair
  inconsistent; the app refuses it (R² guard) instead of guessing.
- Bundle 727 kB (235 kB gzip) with Vite's chunk warning; no PWA icons; the 3D view
  has no zoom; project data lives only in localStorage (no JSON export yet).
- `meshSign` remains a core option for tests/foreign imports, not exposed in the UI.
