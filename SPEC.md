# bedshim — SPEC (agent contract)

> Turn a Klipper bed mesh into a Kapton-tape shim plan, a printable reference
> lattice (STL), and a closed calibration loop.
>
> **This file is the contract.** Implement what is written here. If something is
> ambiguous or looks wrong physically, stop and ask — do not invent behavior.

---

## 0. Status and scope

| | |
|---|---|
| Product | Single-page web app, offline, no backend |
| Stack | TypeScript + Vite + React 19 + Ant Design 6 |
| Name | `bedshim` |
| v1 output | STL lattice, 1:1 SVG plan, cut list, printable instructions |
| UI language | EN + RU via dictionary, EN default, code/identifiers in English |

**In scope (v1):** mesh parsing, surface interpolation, cell grid derived from
tape width, layered shim planning, strip/cut optimization, forward-model
prediction, lattice STL, calibration loop, material-thickness wizard, project
save/load.

> **Stack change (Nov 2026, approved by the owner).** React 18 + Ant Design 5 was
> replaced by React 19 + Ant Design 6. Ant 6 is a year old (6.7.x) and is the
> line that natively supports React 19. Everything else in this contract stands;
> the dependency list in §11 keeps the same packages.

**Out of scope (v1):** backend, accounts, cloud, telemetry, G-code generation,
multi-material stacks, OrcaSlicer plugin, plotter/paper templates.

The OrcaSlicer plugin is a planned v2 (OrcaSlicer ≥ 2.5 has a Python plugin
system with `pages` / `slicing-pipeline` capabilities). v1 must therefore stay
embeddable: **no backend, no CDN, relative asset paths (`base: './'`)**. Do not
use history-API routing.

---

## 1. Problem and physical model

The bed is warped. Tape is glued **under the spring-steel PEI plate, on top of
the magnetic sheet**. Everything below must be encoded in code and covered by a
test — none of it is cosmetic.

### 1.1 Only additive correction

Tape adds height; it can never subtract. Therefore:

- The reference plane must be a **robust high level** in real height (see §6.2),
  not the mean, otherwise half the plate would need negative thickness, which
  tape cannot do. "High" here is a physical height, not the sign of the stored
  number: Klipper already stores a positive value for a plate that is closer to
  the nozzle (§2).
- Overshoot is unrecoverable (removing tape means peeling the whole stack in
  that cell). **Iteration 1 must deliberately undershoot.**
- Layers are physical, not monotonic plans: a later iteration may peel tape
  that is really there (a previous overshoot), but the count never goes below
  zero. The plan is compared with the physical layer matrix and the difference
  is shown as `+n` add / `−n` peel before anything is applied.

### 1.2 Bridging (the plate does not follow small patches)

A 0.05 mm patch under a 0.5 mm steel plate on a magnetic sheet does **not** raise
the surface by 0.05 mm. The sheet spans the patch. The physical response is a
low-pass filter of the tape thickness field:

```
effectiveLift(x,y) = gaussianBlur(tapeField(x,y), sigma)
```

`sigma` (`sheetStiffness`, default **22 mm**, range 8–60) models this. Never plan
or report results without applying it. This is why shims are **blobs**, not
per-node corrections, and why the forward model applies σ to the tape field
before reporting residuals. Pre-smoothing the target before quantisation is
optional (`smoothTarget`, off by default): it silently removes tape, and §4 puts
the blur in the prediction step.

### 1.3 Compression

Effective thickness per layer is below nominal and is not linear in layer count:
the first layer compresses most (adhesive + magnet pressure). Model:

```
lift(0) = 0
lift(1) = t1                    // effective mm of the first layer
lift(n) = t1 + (n - 1) * ts     // ts = effective mm of each further layer, n >= 2
```

Two parameters, both measurable (§9.3). Optional knee model is v2.

### 1.4 Deadband

Do not shim for less than `deadband = 0.4 * ts`. Klipper probe repeatability is
0.005–0.02 mm; chasing less than that produces absurd layer counts.

### 1.5 Unprobed margin

The mesh rectangle covers less than the plate (e.g. 200×190 of 235×235).
Outside it, values are extrapolation. Cells whose center lies outside the mesh
bounds are flagged `unprobed` and default to **no tape**.

The plan can extend into the margin (`extendToPlate`). A 6 mm solid border stays
at the plate edge so the printable lattice has room for its numbers and letters;
the outer row and column are stretched to it, so the cell ids and the matrix keep
their shape and no clipped 2 mm sliver is created. A row taller than the tape is
covered by several side-by-side strips.

---

## 2. Conventions — the dangerous part

The saved mesh has a fixed order and sign, and getting either wrong produces a
plan that is *worse than doing nothing* (it doubles the error). The parser
follows Klipper as a fact, not as a setting:

- row 0 of `points` = `min_y` (front);
- a positive value means the plate is closer to the nozzle ("high").

**There is no sign or view setting.** A mesh whose export inverted the sign must
be fixed before it is imported; the app never plans an inverted mesh. `plan()`
keeps an internal `meshSign` option for tests and foreign imports, but the UI
always uses `'high'`. Nothing blocks planning: the format is known.

### 2.1 Sanity check (optional, not a gate)

If a plan ever looks mirrored or inverted, check it with a shim: put 0.2 mm over
~60×60 mm at the front-left, re-probe without `PROBE_CALIBRATE`, and compare.
The cell over the shim must change by ≈ 0.2 mm and the value must **increase**.
A change at the back means the rows were flipped; a decrease means the export
inverted the sign. Fix the source file and re-import.

### 2.2 Working orientation

Tape is glued **on top of the magnetic sheet**, not on the spring-steel plate:
the plate is lifted off, the tape goes on the bed, the plate is put back on top.
The worker therefore looks down at the bed in the same orientation as the probed
mesh. There is no flipped-plate step and no mirrored view; a mirrored plan would
only invite mistakes.

Every renderer (plan, SVG, STL) uses one orientation: X to the right, Y to the
back, the front edge at the bottom. Cell ids are never mirrored.

---

## 3. Grid model

Cells are derived **from the tape**, not from the mesh. A cell must be fillable
by exactly one strip width, because a single strip cannot cover two rows.

```ts
buildGrid(opts: {
  plate: { w: number; h: number };         // PEI plate, mm
  meshBounds: { minX: number; maxX: number; minY: number; maxY: number };
  tapeWidth: number;                        // w, mm
  meshXCount: number;                       // for the spacing warnings
  meshYCount: number;                       // row spacing = (maxY-minY)/(yCount-1)
}): { cells: Cell[]; cols: number; rows: number; tapeWidth: number;
      rowSpacing: number; meshBounds: MeshBounds; plate: { w: number; h: number };
      warnings: CoreMessage[] }

type Cell = {
  id: string;          // "A1"
  label: string;       // "A1"
  col: number;         // 0-based, 0 = left
  row: number;         // 0-based, 0 = front
  x0: number; x1: number; y0: number; y1: number;   // mm, plate coordinates
  unprobed: boolean;   // center outside mesh bounds
  partial: boolean;    // clipped by the plate edge
};
```

Rules:

- **X step = `tapeWidth`.** Y step = mesh row spacing (`(maxY-minY)/(yCount-1)`),
  so rows land on probe rows and no extrapolation is introduced. The 20 mm strip
  overhanging a 19 mm row by 1 mm is desirable (no gaps).
- Grid origin = `(meshBounds.minX, meshBounds.minY)`.
- Columns numbered `1..N` left→right, rows lettered `A, B, C…` front→back.
- Cell ids are stable; nothing is mirrored anywhere in the app.
- `buildGrid` is the **single source of truth** for the planner, the STL and the
  SVG. Nothing else may compute cell rectangles.
- Non-integer division of the plate leaves `partial` edge cells — flag them,
  never silently round.

Warn the user when:

- `tapeWidth < 0.6 * meshSpacing` → "cells are finer than the measurements;
  between nodes the plan is invention";
- `tapeWidth > 2.5 * meshSpacing` → "too few cells, the shape is coarse";
- `plate.w % tapeWidth != 0` **and the grid reaches the plate edge** → "partial
  cells at the edge" (with the count; a non-multiple is harmless while cells stay
  away from the edge).

---

## 4. Pipeline

```
mesh text ──parse──▶ Mesh {xCount,yCount,min/max,algo,tension,points[][]}
                       │
                       ├─interpolate─▶ Surface(x,y) : bicubic(tension)
                       │
buildGrid ─┬───────────┴─▶ cellMean[] (area average, not center sample)
           │
           ├─▶ reference level (percentile) ─▶ targetLift[]
           │
           ├─▶ quantize(material, deadband, rounding) ─▶ layers[][]  (int)
           │
           ├─▶ forwardModel(blur σ) ─▶ predictedMesh, residual, achievable%
           │
           ├─▶ strips(layers, w) ─▶ Piece[] ─▶ batches (identical lengths)
           │
           └─▶ buildLatticeSTL(grid, style) ─▶ Blob (binary STL)
```

Every stage is a pure function in `src/core`. No stage touches the DOM.

---

## 5. Mesh parsing and interpolation

### 5.1 Accepted inputs

Three shapes exist in the wild. All three must parse. Fixtures:
`fixtures/neptune4-mesh.cfg`, `.block`, `.points`.

**A. The block as people paste it from a wiki or a forum**
(`fixtures/neptune4-mesh.block`) — YAML-ish, `key: value`, values indented under
`points:`:

```
[bed_mesh default]
version: 1
points:
  0.090000, 0.080000, 0.042500, -0.002500, -0.002500, -0.017500, -0.047500, -0.032500, -0.000000, 0.025000, 0.067500
  0.070000, 0.060000, 0.035000, -0.002500, -0.002500, -0.007500, -0.030000, -0.020000, 0.010000, 0.040000, 0.077500
  ...
x_count: 11
y_count: 11
mesh_x_pps: 4
mesh_y_pps: 4
algo: bicubic
tension: 0.2
min_x: 10.0
max_x: 210.0
min_y: 21.0
max_y: 211.0
```

**B. Klipper's real `SAVE_CONFIG` tail** (`fixtures/neptune4-mesh.cfg`) — this is
what actually sits at the bottom of `printer.cfg` after
`BED_MESH_CALIBRATE` + `SAVE_CONFIG`, and it is a **different syntax**: every
line carries a `#*# ` prefix, values use `key = value` with spaces (not `key:`),
and the point rows are **TAB**-indented after `points =`:

```
#*# <---------------------- SAVE_CONFIG ---------------------->
#*# DO NOT EDIT THIS BLOCK OR BELOW. The contents are auto-generated.
#*#
#*# [bed_mesh default]
#*#
#*# version = 1
#*# points =
#*# 	0.090000, 0.080000, 0.042500, -0.002500, ...
#*# 	0.070000, 0.060000, 0.035000, -0.002500, ...
#*# x_count = 11
#*# y_count = 11
#*# mesh_x_pps = 4
#*# mesh_y_pps = 4
#*# algo = bicubic
#*# tension = 0.2
#*# min_x = 10.0
#*# max_x = 210.0
#*# min_y = 21.0
#*# max_y = 211.0
```

Most users will paste **B**, because that is what they copy out of their config.
Getting A right and B wrong is the expected failure mode — test both.

**C. Bare numbers** (`fixtures/neptune4-mesh.points`) — only the 121 values, no
keys. Infer the grid from the count, **say that it was inferred**, and ask for
everything else (`min_x`…`max_y`, `algo`, `tension`) in the UI. Do not guess
geometry from a bare list.

Parsing rules:

- strip the `#*# ` prefix if present; accept `key: value`, `key = value`,
  `key=value`, and tabs or spaces as indentation;
- keys may appear before or after `points`;
- a file may hold several `[bed_mesh <name>]` blocks → list them and use the
  requested one (default: the last);
- numbers separated by `,`, whitespace and/or newlines; preserve `-0.000000`;
- unknown keys (`zero_reference_position`, `relative_reference_index`, …) are
  ignored and listed in the parse report;
- validate `rows == y_count`, `cols == x_count`; on mismatch report both counts
  and the offending row — never pad;
- if counts are absent → infer and say so.

### 5.2 Interpolation

Implement Klipper's `algo: bicubic` (cardinal/Catmull-Rom with `tension`) — the
same surface the nozzle sees. `bilinear` is available as a fallback.
`algo: lagrange` / `direct` are approximated by bicubic in v1; show a one-line
notice. `mesh_x_pps`/`mesh_y_pps` do not change the saved mesh, only its sampling.

### 5.3 Cell value

`cellMean` = **area average of the interpolated surface over the cell**, sampled
on a ≥ 8×8 subgrid. Not the center, not the node. Also compute
`cellRange = max - min` inside the cell; if `cellRange > 0.5 * ts`, mark
`cellInconsistent` (a single layer count cannot fix it; the plate will average).

### 5.4 Probe count is an input, not a setting

The app never changes how the printer probes. It reads `x_count` / `y_count` from
the pasted mesh and adapts. But it must **recommend** a probe count, because the
mesh spacing is what the plan resolution rests on.

Three different "numbers of points" must never be conflated:

| | Where it lives | What it does |
|---|---|---|
| `probe_count` | printer (`[bed_mesh]`) | real measurement density |
| `mesh_x_pps` / `mesh_y_pps` | printer | subdivides the interpolation only; measures nothing new |
| cell grid | this app (§3) | derived from `tapeWidth`, not from the mesh |

Recommendation is derived **from the tape width** — the count that would put one
probe per cell:

```
idealX = round((maxX - minX) / tapeWidth) + 1
idealY = round((maxY - minY) / tapeWidth) + 1
```

Reference fixture: `200 / 20 + 1 = 11` and `190 / 20 + 1 = 10.5 → 11`, so `11×11`
— the user's current config is already the ideal one. Say that plainly instead of
"improving" it.

Present the recommendation as a comparison, never as a single number, and always
with the cost:

| tape | ideal matrix | points | probe time* | verdict |
|---|---|---|---|---|
| 50 mm | 5×5 | 25 | ~1 min | coarse, but the plate is not finer anyway |
| 20 mm | 11×11 | 121 | ~4 min | the fixture — already there |
| 15 mm | 14×14 | 196 | ~6 min | fine |
| 10 mm | 21×20 | 420 | ~13 min | only if you are prepared to wait |
| 5 mm | 41×39 | 1599 | ~50 min | not worth it |

\* time grows with `count²`; estimate from the configured probe speed
(2–3 s/point), do not hardcode a total.

Rules:

- **Never silently cap.** Show the ideal count and its time, let the user choose.
  Warn above 25×25 / ~25 min that the gain is below the plate's bridging (§1.2),
  but still show the number if asked.
- If the current mesh is *finer* than needed (`meshSpacing < 0.5 * tapeWidth`) say
  "you are over-measuring — `NN×NN` is enough for this tape".
- If the current mesh is *coarser* than the tape (`meshSpacing > 1.5 * tapeWidth`)
  say "the cells are finer than your map; either set `probe_count: X, Y` or accept
  that between nodes the plan is invention" — and link it to the §3 warning.
- Never present `mesh_x_pps`/`mesh_y_pps` as an accuracy knob — it only smooths.
- The suggestion keeps `mesh_min`/`mesh_max` fixed — they are limited by the probe
  offset — and changes only `probe_count`. Emit it as a copy-paste snippet:

```
[bed_mesh]
mesh_min: 10, 21
mesh_max: 210, 211
probe_count: 11, 11
algorithm: bicubic
```

- **Repeatability gate, shown before planning:** if two consecutive meshes differ
  by more than `0.5 * deadband` in the same cell, recommend raising
  `probe_count`/`samples` and say plainly that the plan cannot be better than the
  map it was built from. This check is a precondition, not a warning banner.

The app suggests; the user edits `printer.cfg`.

---

## 6. Planning

### 6.1 Inputs

```ts
plan(opts: {
  surface: Surface;
  grid: Grid;                       // carries plate, bounds and cell rectangles
  material: Material;               // nominal, t1, ts (null = unknown), calibrated
  referencePercentile?: number;     // 0..1, default 0.85
  deadband?: number;                // default 0.4 * ts
  sigma?: number;                   // default 22, used only with smoothTarget
  smoothTarget?: boolean;           // default false (§1.2 note)
  rounding?: 'floor' | 'round';     // default 'floor' when !calibrated, else 'round'
  maxLayers?: number;               // default 6
  cellSamples?: number;             // default 16 (≥ 8 per §5.3)
  baseLayers?: number[][];          // absolute layers already on the bed
  meshSign?: 'high' | 'low';        // internal; the app always uses 'high'
}): Plan;

`baseLayers` is the physical state when the mesh was taken. The mesh already
contains that lift, so the plan adds the remaining correction on top of it
instead of computing from zero; a plan is never below the existing stack.
```

### 6.2 Reference level

`ref = quantile(h)`, default 85th percentile, where `h` is the sign-normalised
plate height (positive = closer to the nozzle; `h = −cellMean` when
`meshSign === 'low'`). Not `max` — one probe
artifact at the edge (there is one in the reference fixture: +0.1175 in the left
edge) would otherwise lift the entire plate by 0.1 mm and waste tape.

Expose the trade-off in the UI, always both numbers:

- `tapeVolume` / `totalLength` — how much tape the plan consumes;
- `predictedMaxResidual` — the bump left behind because we stopped chasing the
  outlier.

`referencePercentile` is the slider that moves between them.

### 6.3 Quantization

For each cell: `T = targetLift` (in mm, sign-normalized via `meshSign`), then
choose the integer `n` minimizing `|lift(n) - T|`, preferring the smaller `n` on
ties (`fixture: t1 = 0.03, ts = 0.03`). Apply `deadband`: if `T < deadband` then
`n = 0`. Clamp to `maxLayers`.

`rounding: 'floor'` (default while the material is uncalibrated) never overshoots:
it takes the largest `n` whose `lift(n)` is still ≤ `T`. That is the deliberate
undershoot, recoverable in iteration 2.

### 6.4 Complexity budget (must be visible)

Cutting 40 strips is 30 minutes of work; the user must see that cost **before**
committing:

- `pieces` — number of strips;
- `uniquePieces` — distinct `(level, width, length)`;
- `estMinutes ≈ 0.7 * pieces + 1.5 * uniquePieces`;
- `tapeLengthMM`, `tapeAreaMM2`.

Provide a **"coarsen"** action: raise `deadband` and/or lower
`referencePercentile` one notch and show the new numbers side by side.

---

## 7. Forward model and prediction

```
tapeField(cell)   = lift(layers[cell])
predicted(x,y)    = surface(x,y) + gaussianBlur(tapeField, sigma)
residual(cell)    = predicted - ref
```

Report:

- `achievable` — fraction of **taped** cells whose `|residual| < deadband` after
  the plan. Cells without tape are already at the target by construction, so
  counting them would hide a plan that fails exactly where it matters;
- `delivered` — fraction of taped cells where the plate delivers the requested
  lift (`|effectiveLift − plannedLift| < deadband`). This is the bridging
  fidelity, independent of the quantisation error;
- a predicted mesh that can be exported as a `[bed_mesh profile]` block so the
  user can compare before/after in Mainsail/Fluidd;
- a warning when `delivered < 0.6`: "the plate physically cannot follow this
  plan; coarsen it". When the plate delivers the plan but `achievable` is low,
  the plan is undershooting on purpose (`floor`), and the report says so instead
  of blaming the plate.

The forward model is the **only** way to test the planner without printing.
Synthetic deformations (plane, bowl, saddle, edge droop, single bump) must be
generated in tests and planned correctly.

---

## 8. Strip plan and cut list

### 8.1 Strips are one tape width wide

A strip's width is one cell dimension, and a cut can never be wider than the
roll `w`. In the normal grid every row is about `w` tall, so a level's
contiguous run along the row becomes one piece. With `extendToPlate` the outer
row and column are stretched, so the direction is chosen per side:

- a normal (not stretched) column is exactly `w` wide → cut front→back along
  the column; the stretched front/back rows are just part of its length;
- the stretched left/right column is wider than `w` → its cells are cut across
  their row, where a normal row is one `w` tall;
- only the four corners, where a stretched row meets a stretched column, have
  both dimensions over `w`; they are covered by equal strips side by side.

The cut width is therefore `w` everywhere except the four corners, and a row
taller than the roll never forces a 17 mm strip:

```
for level k in 1..maxLayers:
  if not extended:
    for each row r: runs along the row -> one piece each
  else:
    for each normal column c: runs along the column -> one piece each
    for each stretched column c, row r: covered cell -> one row piece
  a piece whose cross dimension > w -> ceil(dim / w) equal strips across
```

Levels are nested (`S_k ⊇ S_{k+1}`), so piece at level `k` always lands on top of
level `k-1` — the instruction is simply "level 1 first, then level 2".

**Free extension:** a piece may extend into neighbours whose `layers >= k`
(already inside the run). It may overshoot by at most `tolerance` (default 2 mm)
into cells with `layers == k-1`; that overhang is smaller than the deadband.

```ts
type Piece = { level: number; orient: 'row' | 'column'; line: number;
               from: number; to: number;
               width: number; length: number; label: string };
```

### 8.2 Batching (required)

Rows look alike, so the cut list must be grouped, otherwise the user cuts 40
pieces one by one:

```
Level 1: cut 6 x 60 mm, 4 x 40 mm, 9 x 20 mm
Level 2: ...
```

`batchCut(pieces) -> { level, width, length, count, cells: string[] }[]`

### 8.3 Instruction text

Generate, per level, bottom-up, and inside a level front→back, left→right:

> Level 1 — cut 6 pieces 20×60 mm. Place them at A1–A3, B1–B3, C1–C3, …
> Level 2 — cut 4 pieces 20×40 mm. Place at A1–A2, B1–B2, …

Bilingual (EN/RU). Also offer a one-page printable sheet.

---

## 9. Calibration loop

### 9.1 Principle

Compare **shape**, not absolute values: after taping, the reference plane moved
and the user will re-tune Z anyway. Detrend before comparing (subtract the mean;
optionally a best-fit plane, selectable).

### 9.2 Fit

Implemented in `core/calibrate.ts` at the probe nodes (the measured delta there
is a direct sample of the bridged tape field), detrended by the mean. Synthetic
tests recover `t1`/`ts` within 2 % clean and 5 % with noise.

Given iteration `i` with `layers_i` and a new mesh `m_{i+1}`:

```
delta(cell) = detrend(m_{i+1}) - detrend(m_i)
delta(cell) ≈ lift(n_{i+1}) - lift(n_i)
```

Least squares over all cells, solving for `t1` and `ts` (fall back to a single
scalar when there is no cell with `n >= 2`). Report `R²`, the number of cells per
`n`, and `noise = std(residual within equal-n groups)`.

### 9.3 Material wizard (also answers "I don't know my tape thickness")

Unknown tape is the normal case; never require the user to know it.

1. Probe at temperature → mesh A.
2. One layer over a large (~100×100 mm) central patch → probe → mesh B.
3. `t1 = mean(detrend(B) - detrend(A))` over the patch.
4. Second layer on the same patch → probe → mesh C.
5. `ts = mean(detrend(C) - detrend(B))` over the patch.
6. `noise` = std inside the patch. If `t1 < 2 * noise`, tell the user the
   measurement is not conclusive and to use a bigger patch.

Fallback when uncalibrated: `t1 = 0.6 * nominal` and `ts = null`. An unknown
`ts` is **not** invented: `lift(n) = t1 + (n − 1) · (ts ?? t1)` and the deadband
uses `ts ?? t1`, so the UI shows an empty `ts` and says that further layers are
counted as `t1`. The plan is flagged `calibrated: false` and rounding is forced
to `floor`. Once the calibration yields `ts`, rounding switches to `round`.

### 9.4 Per-cell flags

Flag cells where measured delta disagrees with the plan by more than
`2 * max(noise, 0.1 * ts)`:

- `bubble` (local, small patch, too high),
- `notSeated` (region, too low),
- `noise` (scattered).

Show the residual map with these markers and a "add 0.05 foil here" hint.

### 9.5 Applying

`applyCalibration(params)` → recompute plan with `t1`/`ts`, enforce monotonicity,
show the diff (`+1 layer in 7 cells, unchanged elsewhere`). Never apply silently.

---

## 10. Outputs

### 10.1 Lattice STL — the main artifact

A **thin plate with rectangular holes**, not a set of bars. One closed, manifold,
watertight solid — a slicer must not need any repair.

```
solid = extrude( plateOutline  −  cellHoles  −  glyphHoles )   // uniform height H
```

- Outline = plate dimensions, so the sheet self-aligns on the plate.
- Cell holes inset by `wallThickness / 2` from the cell rect → the wall between
  two cells is exactly `wallThickness` (default **0.8 mm** = 2 perimeters at a
  0.4 nozzle; slicer then needs no infill and no gap fill).
- Height `H`: default **0.6 mm** (3 layers at 0.2). Uniform. Cheap: ~2–3 g,
  10–15 min.
- Labels: **through-cut stencil glyphs** in a wider border band (band ≥ 12 mm).
  Holes, not raised text — that keeps it one simple manifold with no T-junctions
  and no floating islands. Contrast comes from the bed showing through; recommend
  printing in a light filament.
- A stroke font (polyline → variable-width rectangle union) covers `A..Z` and
  `0..9`; 6 mm glyph height. Union strokes with `polygon-clipping`, subtract from
  the plate.
- Also cut: a `FRONT` marker + arrow so the sheet cannot be flipped by mistake.
- Units mm, Z up, bottom face at `z = 0`, no transforms.
- Export **binary STL** in the single working orientation described in §2.2.

Manifold acceptance (test, not eyeball): every edge shared by exactly 2
triangles, volume > 0, bounding box equals the plate, triangle count reported.

### 10.2 1:1 SVG of the plan

Same geometry as §10.1 (reuse `buildGrid`), no extrusion: cell borders, ids,
outlined strips per level with a legend, and a `FRONT` caption. Printable at 100 % on A4
tiled sheets. Used as an under-plate template — mention that paper adds a uniform
~0.1 mm (absorbed by Z offset, but say it).

### 10.3 Project JSON

`{ version, createdAt, plate, tape, material, conventions, iterations: [{ mesh,
layers, pieces, params, note }] }` — import/export, localStorage autosave. Keeps
iteration history so calibration has data.

---

## 11. Architecture

```
src/
  core/                 // headless: no React, no DOM, no Ant, no window
    mesh/parse.ts
    mesh/interpolate.ts
    mesh/stats.ts       // min/max/Δ, mean, median, MAD of the surface
    material.ts         // nominal, t1, ts, lift(n), deadband
    grid.ts             // buildGrid — single source of truth
    plan.ts             // reference, quantize, deadband, peel-aware diff
    probe.ts            // ideal probe count, time estimate, config snippet
    forward.ts          // blur, prediction, achievable
    strips.ts           // pieces, batches, instructions
    calibrate.ts        // detrend, fit, wizard state machine
    geometry/polygon.ts // polygon-clipping wrappers
    geometry/strokeFont.ts
    geometry/extrude.ts // polygon-with-holes -> triangles (earcut)
    geometry/stl.ts     // binary STL writer
    svg.ts
  state/                // zustand store, persistence
  ui/                   // Ant + custom canvas
  i18n/                 // en.ts, ru.ts, t()
  App.tsx
  main.tsx
fixtures/               // real Klipper meshes, used by parser tests
  neptune4-mesh.cfg     // SAVE_CONFIG shape
  neptune4-mesh.block   // block shape
  neptune4-mesh.points  // values only
```

Rules:

- `src/core` must run under Node with **zero** browser globals. Vitest only.
- Add a small CLI (`scripts/bedshim.ts`) that plans from a text file and writes
  the STL — it proves the core is headless and is the base for the future Orca
  integration.
- Ant Design only for the shell (form, table, sliders, alerts, tabs). The mesh
  heatmap, the rotatable 3D surface and the cell grid are custom canvas; the 3D
  view is a canvas projection (no WebGL dependency) and is a view mode of the
  same `Surface`, not new geometry.
- Deps, all justified: `react`, `react-dom`, `antd`, `zustand`,
  `polygon-clipping`, `earcut`, `vite`, `vitest`. Nothing else without asking.
- `vite.config.ts`: `base: './'`, PWA/service worker for offline.
- No backend, no API routes, no CDN, no external fonts.

---

## 12. i18n

`t('key')`, default `en`, switch in the header, persist in localStorage. All
user-visible strings — including generated instructions and warnings — go through
the dictionary. Identifiers, comments and commit messages: English.

---

## 13. Acceptance criteria per phase

| Phase | Done when |
|---|---|
| P0 scaffold | `npm run dev` serves the app; `npm run test` green; `base: './'` verified by opening `dist/index.html` from disk via a static server |
| P1 mesh | `fixtures/neptune4-mesh.cfg` (SAVE_CONFIG), `.block` and `.points` all parse to the same 11×11 matrix, cell-for-cell identical; malformed input gives a useful error; bicubic matches a hand-computed fixture at 5 sample points |
| P2 grid+plan | `buildGrid` for tape 20 mm on the fixture yields 10×10 with ids `A1..J10`; plan reproduces the golden layer matrix in App. A; re-planning the same mesh is a no-op and peeling never goes below zero; the `probe_count` suggestion is derived from tape width (`20 mm → 11×11` for the fixture, `10 mm → 21×20`), always shown with estimated probe time, and never silently capped |
| P3 forward | σ-blur prediction on a synthetic bowl leaves `achievable > 0.9`; a single-cell plan is reported as `achievable < 0.4` |
| P4 strips | Fixture plan → 22 pieces / 2240 mm; batch list groups them; instruction text renders in EN and RU |
| P5 STL | Manifold test passes; bounding box = plate; STL opens in the slicer without repair; printed sheet is 2–3 g |
| P6 calibration | Synthetic t1/ts recovered within 5 % from a noisy mesh; two iterations converge; wizard state machine covered by tests |

---

## 14. Guardrails

- Do not change the physics model (§1) to make a number look nicer.
- Every core function gets a test; the fixture in App. A is a golden test.
- Do not add a dependency, a backend, or an analytics call without asking.
- Do not generate G-code in v1.
- Never silently swap `floor` for `round` — overshoot is unrecoverable.
- If a spec line is ambiguous, ask; do not pick the convenient interpretation.
- Keep the whole app usable at 360 px width and offline.

---

## Appendix A — reference fixture (golden test)

The real mesh this project was born from: Elegoo Neptune 4, 11×11 probes,
`algo: bicubic`, `tension: 0.2`, probing a 200×190 mm area of a 235×235 mm bed
(so the outer margin is unprobed — see §1.5).

Fixture files: `neptune4-mesh.cfg` (`SAVE_CONFIG` shape, use this in the parser
test), `neptune4-mesh.block` (block shape), `neptune4-mesh.points` (values only).

Verbatim, exactly as it was pasted — note the trailing space after `points:`:

```
[bed_mesh default]
version: 1
points: 
  0.090000, 0.080000, 0.042500, -0.002500, -0.002500, -0.017500, -0.047500, -0.032500, -0.000000, 0.025000, 0.067500
  0.070000, 0.060000, 0.035000, -0.002500, -0.002500, -0.007500, -0.030000, -0.020000, 0.010000, 0.040000, 0.077500
  0.117500, 0.092500, 0.062500, 0.022500, 0.020000, 0.010000, -0.020000, -0.012500, 0.010000, 0.035000, 0.067500
  0.067500, 0.052500, 0.030000, -0.000000, 0.007500, 0.007500, -0.017500, -0.007500, 0.015000, 0.040000, 0.072500
  0.050000, 0.047500, 0.022500, -0.020000, -0.000000, 0.002500, -0.017500, -0.005000, 0.020000, 0.037500, 0.065000
  0.075000, 0.070000, 0.040000, -0.000000, 0.012500, 0.015000, -0.005000, 0.002500, 0.022500, 0.025000, 0.047500
  0.080000, 0.067500, 0.030000, -0.000000, 0.022500, 0.022500, 0.002500, 0.012500, 0.030000, 0.037500, 0.047500
  0.027500, 0.022500, -0.002500, -0.030000, -0.000000, 0.007500, -0.002500, 0.012500, 0.030000, 0.032500, 0.050000
  0.027500, 0.020000, -0.012500, -0.037500, -0.010000, 0.005000, -0.005000, 0.005000, 0.025000, 0.022500, 0.030000
  0.030000, 0.032500, -0.010000, -0.037500, -0.012500, -0.002500, -0.015000, -0.002500, 0.012500, 0.007500, 0.005000
  0.022500, 0.012500, -0.017500, -0.040000, -0.005000, 0.002500, -0.002500, 0.015000, 0.035000, 0.030000, 0.027500
x_count: 11
y_count: 11
mesh_x_pps: 4
mesh_y_pps: 4
algo: bicubic
tension: 0.2
min_x: 10.0
max_x: 210.0
min_y: 21.0
max_y: 211.0
```

Values only, in mesh order — row 0 = `min_y` = 21 mm (front), column 0 =
`min_x` = 10 mm (left):

```
0.090000, 0.080000, 0.042500, -0.002500, -0.002500, -0.017500, -0.047500, -0.032500, -0.000000, 0.025000, 0.067500
0.070000, 0.060000, 0.035000, -0.002500, -0.002500, -0.007500, -0.030000, -0.020000, 0.010000, 0.040000, 0.077500
0.117500, 0.092500, 0.062500, 0.022500, 0.020000, 0.010000, -0.020000, -0.012500, 0.010000, 0.035000, 0.067500
0.067500, 0.052500, 0.030000, -0.000000, 0.007500, 0.007500, -0.017500, -0.007500, 0.015000, 0.040000, 0.072500
0.050000, 0.047500, 0.022500, -0.020000, -0.000000, 0.002500, -0.017500, -0.005000, 0.020000, 0.037500, 0.065000
0.075000, 0.070000, 0.040000, -0.000000, 0.012500, 0.015000, -0.005000, 0.002500, 0.022500, 0.025000, 0.047500
0.080000, 0.067500, 0.030000, -0.000000, 0.022500, 0.022500, 0.002500, 0.012500, 0.030000, 0.037500, 0.047500
0.027500, 0.022500, -0.002500, -0.030000, -0.000000, 0.007500, -0.002500, 0.012500, 0.030000, 0.032500, 0.050000
0.027500, 0.020000, -0.012500, -0.037500, -0.010000, 0.005000, -0.005000, 0.005000, 0.025000, 0.022500, 0.030000
0.030000, 0.032500, -0.010000, -0.037500, -0.012500, -0.002500, -0.015000, -0.002500, 0.012500, 0.007500, 0.005000
0.022500, 0.012500, -0.017500, -0.040000, -0.005000, 0.002500, -0.002500, 0.015000, 0.035000, 0.030000, 0.027500
```

Sheet statistics (computed over the 10×10 cell means; Klipper stores the probe
trigger height, so positive = the plate is **high**, closer to the nozzle):

| | |
|---|---|
| min / max cell mean | −0.0336 / +0.0858 |
| mean | +0.0157 |
| q20 | −0.0045 |
| full node range | −0.0475 … +0.1175 (0.165, dominated by one edge node) |

Plan params: `tapeWidth = 20`, `t1 = ts = 0.03`, `meshSign = 'high'`,
`referencePercentile = 0.85` (the default) → `ref = +0.0463`,
`deadband = 0.4 * ts`, `rounding = round`; `sigma = 22` belongs to the forward
model (P3).

Expected `layers` (rows A..J front→back, cols 1..10 left→right):

```
A  0 0 1 2 2 2 3 2 1 0
B  0 0 1 1 1 2 2 2 1 0
C  0 0 1 1 1 2 2 2 1 0
D  0 0 1 2 1 2 2 1 1 0
E  0 0 1 2 1 2 2 1 1 0
F  0 0 1 1 1 1 1 1 1 0
G  0 1 2 2 1 1 1 1 0 0
H  1 1 2 2 2 2 1 1 1 0
I  1 1 2 2 2 2 2 1 1 1
J  1 1 2 2 2 2 2 1 1 1
```

Total layers 112, **22 pieces**, **2240 mm** of 20 mm tape.

> **Regenerated (Nov 2026, owner-approved).** The first version of this table
> assumed `positive = bed low`, which inverted the plan: Klipper stores the
> probe trigger height, so a positive value is a **high** spot. This table uses
> Klipper's sign and the Klipper-bicubic surface. The mesh itself and its
> statistics are unchanged.

First rows of the cut list:

```
Row A: L1 A3–A9 (140), L2 A4–A8 (100), L3 A7 (20)
Row B: L1 B3–B9 (140), L2 B6–B8 (60)
Row C: L1 C3–C9 (140), L2 C6–C8 (60)
Row D: L1 D3–D9 (140), L2 D4 (20), L2 D6–D7 (40)
Row E: L1 E3–E9 (140), L2 E4 (20), L2 E6–E7 (40)
```

The shape — both X edges high, middle low — is real for this printer, and it is
exactly why the plan reads as a wide vertical band down the middle. Keep this as the golden test.

---

## Appendix B — glossary

| Term | Meaning |
|---|---|
| mesh | Klipper `[bed_mesh]` matrix, mm, relative to probe trigger |
| cell | one tape-sized area of the plan, `tapeWidth` wide |
| layer | one thickness of tape |
| level `k` | "cells that need at least `k` layers" |
| piece / strip | one cut length of tape covering a run within one row |
| lift | effective height added by `n` layers, after compression |
| bridging / σ | how much the steel plate smooths a patch |
| reference | the level we treat as "no tape"; everything below it gets shimmed |
| deadband | corrections too small to be worth a layer |
