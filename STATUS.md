# bedshim — status, decisions and handoff

Last updated: 2026-11-24 (end of session). `SPEC.md` is the contract; this file
records the implementation state, every deliberate deviation and what is left.
Read this first when resuming.

## Next session — start here (2026-11-25)

**Priority 0: fix `Extend to plate edges`.** The owner tested the new margin
extension and reports that it *does not work well* and needs another pass. Also,
the lattice built with the extension has **no numbers or letters**, because the
extended grid reaches the plate edge and `auto` drops the frame/rim (and with it
the label band).

Done late on 2026-11-24: in the **framed** design labels are now cut into all
four rims — numbers 1–10 on the back **and front**, letters A–J on the left
**and right** (covered by a test and checked in the preview). The tight,
extended lattice still has no label band; that is the open part.

Reproduce with `fixtures/neptune4-mesh.cfg`, Plan → **Extend to plate edges**:

- grid goes **10×10 → 13×14**, edge cells 10 / 5 / 2 / 5 mm;
- plan becomes **239 layers / 136 cells / 4640 mm**, reference moves to 0.0616 mm;
- **82 margin cells** use nearest-edge extrapolation;
- the cut list contains very narrow strips (**2 / 5 mm**) and many partial cells;
- the lattice switches to the tight full-plate grid (no frame, **no labels**),
  ~3.0 cm³ / 3.6 g, closed manifold.

Ask the owner what exactly “does not work well” means before changing the model
— do not guess. Likely work items:

1. Decide how labels should work in extended mode without bringing back the
   frame gap: thin label rim/band, labels in the edge cells, or labels only in
   the Plan tab's layer map / cut list (currently none in the STL).
2. Review the nearest-edge extrapolation and the reference/plan jump; maybe the
   margin cells should use a different reference or be excluded from the
   quantile.
3. Review the partial strips (2 / 5 mm) and the cut-list UX; maybe merge a
   narrow edge row into the neighbouring full row with an explicit warning.
4. Re-check the `baseLayers` mismatch case when extension is toggled after a
   plan is applied (warning exists, but the physical state is still lost).

## Session summary — 2026-11-24

- **Prediction map:** two modes — residual to target (green deadband, pale
  `floor` undershoot, blue/red) and predicted relief as the same smooth 2D
  heatmap as the measured mesh (probe dots, hover, colour bar); `spreadResidual`
  statistic; legend; unprobed/mesh borders.
- **Calibration:** `fitBridging` sweeps σ 8–60 mm, refits t1/ts at each point and
  applies σ with the material; weak/flat curves keep the current σ; σ lives in
  the store. Clear-all now resets material (switch off), rounding to `floor` and
  σ to 22.
- **P4 strips:** `core/strips.ts` (runs per level, batching), Plan-tab cut list in
  EN/RU, printable sheet; golden 22 pieces / 2240 mm.
- **Plan diff:** add / peel / unchanged against the measured layer state, with a
  per-cell table.
- **P5 STL:** polygon/extrude/binary STL core, manifold check and T-junction
  splitting; full-plate frame + cut-out gap + rounded bridges; pixel-stencil
  numbers 1–10 on **both front and back** rims and letters A–J on **both side**
  rims; `auto`/frame/tight/plate options; lattice preview; CLI `lattice` command.
- **Plan extension:** `extendToPlate` in the shared plan settings; grid extends
  into the margin (13×14 on the fixture); nearest-edge extrapolation; plan
  warning and cell markers; strips use real cell width/length; calibration
  records `AppliedPlan.extendToPlate`; base-grid mismatch warning.
- **Removed by owner request:** the 1:1 SVG plan output, download button, plan
  preview and its descriptions. Only the lattice preview remains (internal SVG).
- Verification: **117 tests**, typecheck and build pass; dev server on
  `0.0.0.0:5173`.

## Where we are

| Phase | State | Notes |
|---|---|---|
| P0 scaffold | done | Vite + React 19 + Ant Design 6, EN/RU, offline SW, CLI stub |
| P1 mesh | done | three mesh shapes, Klipper-exact bicubic surface, fixture golden tests |
| P2 grid + plan | done | `buildGrid`, reference + quantization, golden plan, probe advice, plan screen |
| P3 forward | done | σ-bridged prediction, residual map, `achievable`/`delivered`, mesh export |
| P4 strips | done | row runs per level, batching, EN/RU cut list, print sheet; 22 pieces / 2240 mm golden |
| P5 STL | done | manifold STL with frame + bridges, numbers front/back, letters both sides, optional margin plan; SVG output removed by owner |
| P6 calibration | first half done | measurement history, apply-plan state, t1/ts/σ fit, auto-round; wizard, peel UI and project JSON remain |

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
- **Probe advice** — ideal count from tape width over the **measured mesh**
  (`mesh_min..mesh_max`), not the plate (20 mm → 11×11 = 121 points, ≈4 min;
  10 mm → 21×20 = 420, ≈14 min), estimated time, never capped, plus a
  `printer.cfg` snippet.
- **Prediction (P3)** — tape field blurred with σ (8–60 mm), per-cell residual in
  µm, spread after taping (RMS around the mean, shape only), worst/RMS residual,
  `delivered` (bridging fidelity) and `achievable` (taped cells inside the
  deadband), a two-mode map (residual to target with deadband/floor bands, or
  the predicted relief as the same interpolated heatmap as the measured mesh)
  with a legend, plus a paste-ready `[bed_mesh predicted]`.
- **Strips (P4)** — independent row runs per level become pieces, identical
  pieces are batched by cut size, the Plan tab shows the EN/RU cut list in
  placement order and prints a one-page sheet; the golden plan gives 22 pieces /
  2240 mm. Free extension into the next cell is not implemented yet.
- **Plan diff** — the Plan tab reports add/peel/unchanged layers against the
  measured stack and lists every changed cell; on the first iteration this is
  simply what will be pasted.
- **Lattice (P5)** — the Lattice tab builds the reference lattice from the grid
  and offers a manifold binary STL. `auto` keeps the full plate and cuts a thin
  frame with a gap and four rounded bridges per side when the measured grid is
  inset by >5 mm; it fuses the rim to the frame where the gap is too narrow, and
  trims to a tight grid near the edge. Numbers 1–10 are cut into both the back
  and front rims, and letters A–J into both side rims. `Extend to plate edges`
  adds margin cells and plans them from the nearest edge value, with a warning;
  the lattice then drops the frame and covers the whole plate. The SVG plan
  output was removed by the owner; the Lattice preview is internal.
- **Measurements** — every parsed map is stored with its text, geometry and
  absolute layer state; select/delete; clear-all with confirmation.
- **Calibration (P6 first half)** — the Calibration tab compares two measurements
  (selectors default to the last two), fits `t1`/`ts` by least squares at the
  probe nodes (mean-detrended, σ-blurred basis), fits the bridging σ by a 1-D
  sweep with the same least squares, reports R²/noise/layer-change counts,
  refuses inconsistent data, and on apply writes the material and σ and switches
  rounding to `round`. A flat σ curve keeps the current value and says so.
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
16. **The prediction map has two modes.** Residual-to-target paints what is left
    against the reference, with green inside the deadband and pale blue for the
    undershoot the floor rule allows. Predicted relief uses the same interpolated
    2D heatmap as the measured mesh (probe dots, hover readout, colour bar),
    centred on the median predicted height because the common level is a Z offset.
    `spreadResidual` (RMS around the mean) is reported next to `rmsResidual`
    because that offset is removed by the Z offset, so it is the shape error that
    actually matters.
17. **Bridging σ is fitted, not guessed.** `fitBridging` sweeps σ 8–60 mm and
    refits `t1`/`ts` at every candidate; the same calibration pair applies
    σ together with the material. A one-parameter ΔSSE interval, a 2 % edge
    improvement and the bounds decide whether the data really pins it down; a
    flat curve keeps the current σ and raises `calibrate.warn.sigmaWeak`. The
    store holds σ, so the Plan tab slider and the prediction follow the
    measurement.
18. **Lattice holes follow the grid, not the plan.** `buildLattice(grid)` cuts a
    hole for every grid cell, inset by `wall/2`. The default `auto` outline keeps
    the full 235×235 plate for positioning and cuts a thin frame, a cut-out gap
    and four rounded bridges per side to the inner lattice; a gap narrower than
    3 mm is fused to the frame instead of leaving a tiny tab. When the measured
    grid is within 5 mm of the plate edge it switches to a tight grid instead.
    The cell rim carries pixel-stencil numbers 1–10 on both the back and front
    rims and letters A–J on both the left and right rims. `grid` and `plate`
    force the old shapes.
19. **The extruder splits earcut T-junctions.** With adjacent cell holes, earcut
    can leave a triangle edge running through a neighbouring hole vertex along
    the 0.8 mm wall. The top/bottom faces are re-triangulated from a centroid fan
    that includes every collinear vertex, so the STL is closed and watertight
    (checked by the edge-pair and connectivity test).
20. **Margin planning is opt-in and nearest-edge.** `Extend to plate edges` adds
    margin rows/columns up to the plate, clipped at the edges, and plans them
    from the surface's clamped edge value (`surface.at` already clamps). The
    plan warns with `plan.notice.extrapolated`, marks the cells, and the lattice
    then drops the frame because the cells reach the plate. If the stored layer
    matrix no longer matches the grid (tape width or extension changed), the Plan
    tab warns instead of silently treating the bed as bare.
21. **The 1:1 SVG plan output was removed by the owner.** The Plan tab's layer
    map, cut list and the Lattice tab's own preview cover the need; core
    `buildLatticeSvg` remains only for that preview.

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
- **Clear-all left calibration behind** — clearing every measurement now resets
  the material to the unmeasured default (the “Measured material” switch goes
  off), rounding to `floor` and σ to 22, so the next plan starts from a clean
  state instead of using a fit whose data no longer exists.
- **Earcut T-junctions on the 0.8 mm walls** — a plate with two holes produced
  8 open edges because a long triangle edge ran through the adjacent hole's
  vertices. The extruder now detects collinear vertices on every edge and fans
  the triangle from its centroid, including them; the fixture has 0 bad edges
  and one connected component.
- **Full-plate lattice was ~15 g with huge solid margins** — the 235×235×0.6 mm
  sheet has 12.1 cm³ of material, mostly the border outside the 200×190 probed
  area. The default frame + rim + labels is 7.9 cm³ / 9.7 g; the extended plan
  covers the plate with cells and needs no frame: 3.0 cm³ / 3.6 g, close to the
  spec's 2–3 g.
- **Toggling extension after applying a plan** — the stored layer matrix no
  longer matches the grid. The Plan tab now warns (`plan.baseMismatch`) instead
  of silently treating the bed as bare; the calibration grid records
  `AppliedPlan.extendToPlate`.

## Calibration test data

`fixtures/test-after-pass1.cfg` and `fixtures/test-after-pass2.cfg` are synthetic
after-taping meshes with true **t1 = 0.025 mm, ts = 0.040 mm**.
Walkthrough: `fixtures/TEST-MEASUREMENTS.md`. In the app, "Load example" offers
1) original bed, 2) after pass 1 (fits t1/ts), 3) after pass 2 (fits ts).
Verified end to end in the browser: pass 1 → 0.0250 / 0.0399, R² 0.999; pass 2 →
ts 0.0399; the M1→M3 pair also recovers 0.025 / 0.040 in tests.

## What is left (in suggested order)

1. **`Extend to plate edges` fix** — owner-reported: it does not work well, and
   the extended lattice has no numbers/letters. Repro details and decisions are
   in “Next session — start here” above.
2. **P6 remaining** — uniform-patch wizard (§9.3), per-cell calibration flags
   (bubble / not seated / noise), peel action, project JSON import/export,
   repeatability gate (§5.4).
3. **Strips extension** — the spec allows a piece to overhang by up to 2 mm into
   cells with one layer less; the current cut list uses exact runs only.
4. **Polish** — lazy tabs for the 727 kB bundle (Vite warning), PWA icons,
   optional `migrate` cleanup.

## Expanding `mesh_min` / `mesh_max` (printer.cfg)

The measured rectangle is limited by the probe offset and the axis travel, not by
the app. To try a larger one:

1. Read `[probe] x_offset` / `y_offset` and the X/Y `position_min` / `position_max`.
   `mesh_min` / `mesh_max` are **probe** coordinates: the toolhead sits at
   `probe point − offset`, so the probe point must stay over the bed while the
   toolhead stays inside the axis limits. `mesh_min` is the front-left corner and
   `mesh_max` the back-right corner, so the free directions on the fixture are
   **left** (smaller `mesh_min.x`) and **back** (larger `mesh_max.y`).
2. On the fixture (235×235 plate) the mesh is x 10–210, y 21–211: 10 mm unused on
   the left, 24 mm at the back, 21 mm at the front and 25 mm on the right. Moving
   the left/back bounds in by a few millimetres is safe if the probe and the
   toolhead both stay clear.
3. Test candidate corners with `G28`, `G1 X… Y…`, `PROBE`, `QUERY_PROBE`, or run a
   small `BED_MESH_CALIBRATE` with the proposed bounds and watch for "Move out of
   range". Keep 3–5 mm from the physical edge and away from bed clips.
4. Edit `[bed_mesh]` `mesh_min` / `mesh_max`, keep `probe_count` (or recompute it
   from the app's probe-advice table) and run `BED_MESH_CALIBRATE`, `SAVE_CONFIG`.
   Example shape only — use the limits you verified on the machine:

   ```ini
   [bed_mesh]
   mesh_min: 5, 21
   mesh_max: 220, 216
   ```

5. Load the new mesh in bedshim. Measured edge data beats nearest-edge
   extrapolation, and `Extend to plate edges` then adds fewer extrapolated cells.
   If the mesh now covers the whole plate, the extension switch has nothing to
   add and the lattice stays tight.

Caution: changing the mesh bounds shifts/reshapes the cell grid. A plan applied
before the change no longer maps onto the new grid; expand **before** taping, or
expect the base-mismatch warning and re-plan from a fresh state. The app never
edits `printer.cfg`.

## Verification and how to run

```bash
npm run dev        # or: npm run dev -- --host 0.0.0.0 --port 5173
npm test           # 117 tests, node environment
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
- Peel is allowed by the model but the planner never proposes it; the diff screen
  shows add/peel against the physical state.
- `Extend to plate edges` is owner-reported as not working well; the extended
  lattice has no numbers/letters. Needs reproduction and a labels design before
  it is considered done.
- Extended plans produce partial edge strips (2 / 5 / 10 / 25 mm) and a very
  different reference; the cut list warns to trim, but the UX needs a decision.
- Calibration pairs depend on the recorded layer states: changing tape width,
  extension, percentile or rounding between planning and measuring makes the pair
  inconsistent; the app refuses it (R² guard) instead of guessing.
- Bundle 727 kB (235 kB gzip) with Vite's chunk warning; no PWA icons; the 3D view
  has no zoom; project data lives only in localStorage (no JSON export yet).
- `meshSign` remains a core option for tests/foreign imports, not exposed in the UI.
