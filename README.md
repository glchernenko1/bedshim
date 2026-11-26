# bedshim

Turn a Klipper bed mesh into a Kapton-tape shim plan, a printable reference
lattice (STL), and a closed calibration loop.

Client-side single-page app: TypeScript + Vite + React 19 + Ant Design 6, no
backend, no CDN, relative asset paths (`base: './'`). The header badge is the
build version, injected from `package.json` at build time. `SPEC.md` is the contract; `PROMPT.md`
is the kickoff brief.

Live build: <https://glchernenko1.github.io/bedshim/> — every push to `main` runs
`.github/workflows/pages.yml` (tests, build, publish `dist/` to GitHub Pages).
The repository setting **Settings → Pages → Build and deployment → Source** must
stay **GitHub Actions**; a branch source publishes the raw `index.html`, which
points at `src/main.tsx` and leaves the page blank.
The sample meshes and the **Load example** picker exist only in `npm run dev`;
the Pages build drops both, so visitors must paste their own mesh.

The header shows the build version and switches between **Pro** and **Auto**,
starting in Auto. Pro exposes
the Calibration tab and the measured/t1/ts, rounding and σ controls. Auto hides
those, keeps the plan inputs (including tape nominal, max layers and the
reference percentile) and applies a conclusive material/σ fit from the last two
measurements by itself; the plan and cut list stay identical between the modes.

## Commands

```bash
npm install
npm run dev        # dev server
npm test           # Vitest (core only, Node environment)
npm run typecheck  # tsc --noEmit
npm run build      # dist/ — works from disk, no network
npm run cli -- parse fixtures/neptune4-mesh.cfg
```

## Status

| Phase | State |
|---|---|
| P0 scaffold | done — Vite/React 19/Ant 6 shell, i18n EN/RU, offline service-worker stub, CLI stub |
| P1 mesh | done — three mesh shapes, Klipper-exact bicubic surface, fixture golden tests |
| Mesh view | done — 2D heatmap, rotatable 3D surface (canvas, no WebGL), min/Δ/median/mean/MAD |
| P2 grid+plan | done — `buildGrid` 10×10, reference + quantization, golden plan, probe-count advice |
| P3 forward | done — σ-blur prediction, residual map, achievable/delivered, mesh export |
| P4 strips | done — row/column runs per level, batching, EN/RU cut list and print sheet |
| P5 STL | done — manifold STL with frame + bridges; numbers 1–10 on both front/back rims and letters A–J on both sides; optional margin plan; composite mode splits the sheet into four quadrants with outer dovetails plus a separate centre cross key; per-part STLs |
| P6 calibration | first half done — measurements, t1/ts/σ fit, auto-round, Pro/Auto switch (Auto applies a conclusive fit without the calibration clicks); wizard and project JSON remain |

Next: finish P6 — uniform-patch wizard, per-cell flags, peel and project
JSON. Details in [`STATUS.md`](STATUS.md).

Decisions, deviations from the first spec draft and the current numbers live in
[`STATUS.md`](STATUS.md).

`src/core/` is headless: no React, no DOM, no `window`. Every user-visible string
it produces is a message code translated through `src/i18n`.

## Fixtures

`fixtures/neptune4-mesh.{cfg,block,points}` — the same Elegoo Neptune 4 11×11 mesh
in three real-world shapes (SPEC Appendix A).

`fixtures/qidi-q1pro-mesh.cfg` — Qidi Q1 Pro 250 × 250 bed, 8 × 8 probes; the
composite/preview fixtures also exercise the 20 × 20 mm plan grid.

`fixtures/test-after-pass1.cfg` and `test-after-pass2.cfg` — synthetic
"after taping" meshes with a known material (t1 = 0.025, ts = 0.040), for trying
the calibration loop in the UI. Steps: [`fixtures/TEST-MEASUREMENTS.md`](fixtures/TEST-MEASUREMENTS.md).
In the app they are reachable through **Load example** in the dev server only
(`src/dev/examples.ts`); the published build has no example picker.
