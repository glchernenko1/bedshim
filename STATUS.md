# bedshim — status and decisions

Last updated: 2026-11-24. `SPEC.md` is the contract; this file records where the
implementation stands and every place it deliberately differs from the first
draft of the spec.

## Where we are

| Phase | State | What is there |
|---|---|---|
| P0 scaffold | done | Vite + React 19 + Ant Design 6 shell, EN/RU, offline service worker, CLI stub |
| P1 mesh | done | three mesh shapes, Klipper-exact bicubic surface, fixture golden tests |
| P2 grid + plan | done | `buildGrid`, reference + quantization, golden plan, `probe_count` advice, plan screen |
| extras | done | 2D heatmap, rotatable 3D surface (canvas), surface statistics (min/median/mean/max/Δ/MAD), manual tape thickness |
| P3 forward | not started | σ-blur prediction, residual, `achievable` |
| P4 strips | not started | pieces, batches, printable instructions |
| P5 STL + SVG | not started | manifold lattice, 1:1 SVG |
| P6 calibration | not started | tape wizard (t1/ts from two meshes), apply + monotonic diff |

## What works today

- **Parsing** — `SAVE_CONFIG` tail, `key: value` block and bare numbers all give
  the same 11×11 matrix; malformed input returns a translatable error code with
  the line number; several profiles are listed and selectable.
- **Surface** — Klipper's bicubic, including its `mesh_pps` sampling and bilinear
  lookup, so the app sees what the nozzle sees. Five sample points are checked
  against an independent Python port of `bed_mesh.py`.
- **Analysis** — surface min/max/Δ/mean/median/MAD with plain-language bands
  (flat / mild / notable / strong) relative to one effective layer.
- **Plan** — 10×10 cells (`A1..J10`) for 20 mm tape on the fixture; reference
  quantile, deadband, `floor`/`round`, absolute layers and a peel-aware diff
  (`+n` add, `−n` peel, never below zero).
- **Probe advice** — ideal count from the tape width (20 mm → 11×11 = 121 points,
  ≈4 min; 10 mm → 21×20 = 420, ≈14 min), always with time, never capped, plus a
  `printer.cfg` snippet.
- **Screen** — plate-sized layer map (hatched = unprobed), 2D/3D mesh view,
  material fields, EN/RU, works at 380 px, offline reload verified.

## Decisions and deviations (owner-approved)

1. **Stack: React 19 + Ant Design 6** (was React 18 + Ant 5). Ant 6 is the line
   that natively supports React 19; recorded in SPEC §0.
2. **Sign is a fact, not a setting.** Klipper stores the probe trigger height, so
   a positive mesh value means the plate is **high** (closer to the nozzle). The
   first Appendix A table assumed the opposite and its plan was inverted; the
   table was regenerated. The sign toggle was removed.
3. **No mirrored view.** Tape is glued **on the magnetic sheet**, not on the PEI
   plate: the plate is lifted off, the tape goes on the bed, the plate goes back.
   There is no flipped-plate step, so `view` was removed from `buildGrid`, the
   renderer and the UI; the STL/SVG will use the same orientation with a `FRONT`
   marker.
4. **No conventions gate.** With no sign/view settings there is nothing to
   confirm; the parser follows Klipper's order and sign as fixed facts. §2.1 is
   now an optional shim sanity check, not a blocking step.
5. **Layers are physical.** A later iteration may peel a previous overshoot, but
   never below zero. The plan is compared with the physical layer matrix and the
   diff is shown before anything is applied (`diffAgainstPhysical`).
6. **σ is applied by the forward model, not before quantization.** Pre-smoothing
   the target silently removes tape (A1 drops from 3 layers to 2 on the fixture),
   and §4 puts the blur in the prediction step. `smoothTarget` exists, default off.
7. **Golden plan re-baselined** with Klipper's sign and the bicubic surface:
   **112 layers, 22 pieces, 2240 mm**, reference level +0.0463 mm at the default
   85th percentile. The earlier tables (bilinear and/or inverted sign) are only
   in git history; the tests pin the current numbers plus a sign regression.
8. **Rounding.** `floor` = the largest `n` with `lift(n) ≤ T` (never overshoot);
   `round` = nearest layer count. The app states that the first iteration must
   stay on `floor`, and warns if `round` is chosen for an unmeasured tape.
9. **Tape thickness is manual until P6.** `nominal`, `t1`, `ts` and a "measured"
   switch are editable and persisted. While unmeasured, `t1 = ts = 0.6 × nominal`.
   P6 will compute both from two meshes (one patch → `t1`, second layer → `ts`).
10. **3D view is canvas 2D** — orthographic projection, painter's algorithm, no
    WebGL and no new dependency.
11. **Frame is plate-sized**, cells cover the probed rectangle. Cells whose centre
    is outside the mesh are hatched and get no tape; extending the plan into the
    unprobed margin (owner's idea) is **not implemented yet** — it needs a
    decision on how far to extrapolate and whether to tape that margin.

## Not built yet

- P3: forward model, predicted mesh export, residual, `achievable`, and the
  repeatability gate from §5.4.
- P4: strips, batches, EN/RU instructions, printable sheet.
- P5: manifold STL, 1:1 SVG.
- P6: tape wizard and applying calibration.
- Project save/load JSON (§10.3); the store persists only the mesh, language and
  material for now.

## Verification

```bash
npm test           # 77 tests, node environment
npm run typecheck  # tsc --noEmit
npm run build      # dist/, offline reload verified in Chromium
npm run cli -- parse fixtures/neptune4-mesh.cfg
```

Known issues: the bundle is 727 kB (235 kB gzip) with Vite's chunk-size warning —
lazy tabs can fix it later; the service worker caches at runtime (no precache
manifest, no PWA icons); the 3D view has no zoom; `meshSign` remains in the core
API for tests/foreign imports but is not exposed in the UI.
