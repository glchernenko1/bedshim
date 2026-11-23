# Test measurements for the calibration loop

Two synthetic "after taping" meshes, generated from the Neptune 4 fixture with a
known true material: **t1 = 0.025 mm, ts = 0.040 mm**. They exist so the
calibration can be tried in the UI without touching a printer.

| File | What it is |
|---|---|
| `neptune4-mesh.cfg` | the original bare-bed measurement (M1) |
| `test-after-pass1.cfg` | after the first plan was glued (M2) |
| `test-after-pass2.cfg` | after the second plan, computed on M2 with the fitted material (M3) |

## How to reproduce it in the app

Keep the default plan settings everywhere: **tape 20 mm, plate 235 mm,
reference percentile 0.85**. For pass 1 the material is unmeasured
(`t1 = 0.03`, `ts` empty) and rounding is **floor**; after the fit the app
switches to **round**, which is what pass 2 was generated with.

0. **Карта / Mesh** → **Clear all measurements** (confirm) if the list is not empty.
1. **Карта / Mesh** → **Load example → 1 — original bed** (or paste `neptune4-mesh.cfg`) → it is added as M1.
2. **План** → **Mark plan as glued**. (This records the layer state.)
3. **Карта** → **Load example → 2 — after pass 1** (or paste `test-after-pass1.cfg`) → M2.
4. **План** → **Calibration** shows `M1 → M2` → **Fit t1 / ts**.
   Expected: **t1 ≈ 0.0250 mm, ts ≈ 0.0399 mm**, R² ≈ 0.999. The applied values are
rounded to 4 decimals.
   Press **Use these values** (material becomes measured and rounding switches to
   **round** automatically).
5. **План** → **Mark plan as glued** for M2 (the plan now uses the fitted
   material and round).
6. **Карта** → **Load example → 3 — after pass 2** (or paste `test-after-pass2.cfg`) → M3.
7. **План** → **Calibration** shows `M2 → M3` → **Fit t1 / ts**.
   Expected: t1 is kept from the material (0.0250), **ts ≈ 0.040 mm**, R² ≈ 0.999.
Sixty-five cells gain one more layer, which is why this pair measures ts (all
cells already had tape, so t1 is not observable from it).

If the plan settings or the rounding mode are changed, the applied layer matrix
no longer matches the generating scenario and the second fit will not reproduce
the values — the calibration will refuse a poor fit (R² below 0.9 warns, below
0.5 disables applying). The files are still valid meshes; only the calibration
pairing assumes the steps above.

## What the files contain

The meshes are sampled on the same 11×11 grid as the original (200×190 mm inside
a 235×235 mm plate). Each is the previous surface plus the **bridged** tape field
(σ = 22 mm) with the true material, plus a small global shift (0.010 and 0.004 mm)
that simulates re-tuning Z after taping — the fit removes it by detrending.

`src/core/fixtures.test.ts` re-runs both fits from these files, so a stale file
fails the test suite.
