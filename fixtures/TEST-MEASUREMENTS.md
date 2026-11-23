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
reference percentile 0.85, rounding floor**, material unmeasured
(`t1 = ts = 0.03`) for pass 1.

1. **Карта / Mesh** → paste `neptune4-mesh.cfg` → **Add measurement** (M1).
2. **План** → **Mark plan as glued**. (This records the layer state.)
3. **Карта** → paste `test-after-pass1.cfg` → **Add measurement** (M2).
4. **План** → **Calibration** shows `M1 → M2` → **Fit t1 / ts**.
   Expected: **t1 ≈ 0.025 mm, ts ≈ 0.040 mm**, R² ≈ 1.
   Press **Use these values** (material becomes measured; rounding stays floor).
5. **План** → **Mark plan as glued** for M2 (plan now uses the fitted material).
6. **Карта** → paste `test-after-pass2.cfg` → **Add measurement** (M3).
7. **План** → **Calibration** shows `M2 → M3` → **Fit t1 / ts**.
   Expected: t1 is kept from the material, **ts ≈ 0.040 mm**.

If the plan settings or the rounding mode are changed, the applied layer matrix
no longer matches the generating scenario and the second fit will not reproduce
the values. The files are still valid meshes; only the calibration pairing
assumes the steps above.

## What the files contain

The meshes are sampled on the same 11×11 grid as the original (200×190 mm inside
a 235×235 mm plate). Each is the previous surface plus the **bridged** tape field
(σ = 22 mm) with the true material, plus a small global shift (0.010 and 0.004 mm)
that simulates re-tuning Z after taping — the fit removes it by detrending.

`src/core/fixtures.test.ts` re-runs both fits from these files, so a stale file
fails the test suite.
