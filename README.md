# bedshim

Turn a Klipper bed mesh into a Kapton-tape shim plan, a printable reference
lattice (STL), and a closed calibration loop.

Offline single-page app: TypeScript + Vite + React 19 + Ant Design 6, no backend,
no CDN, relative asset paths (`base: './'`). `SPEC.md` is the contract; `PROMPT.md`
is the kickoff brief.

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
| P4–P6 | in progress |

Decisions, deviations from the first spec draft and the current numbers live in
[`STATUS.md`](STATUS.md).

`src/core/` is headless: no React, no DOM, no `window`. Every user-visible string
it produces is a message code translated through `src/i18n`.

## Fixtures

`fixtures/neptune4-mesh.{cfg,block,points}` — the same Elegoo Neptune 4 11×11 mesh
in three real-world shapes (SPEC Appendix A).

`fixtures/test-after-pass1.cfg` and `test-after-pass2.cfg` — synthetic
"after taping" meshes with a known material (t1 = 0.025, ts = 0.040), for trying
the calibration loop in the UI. Steps: [`fixtures/TEST-MEASUREMENTS.md`](fixtures/TEST-MEASUREMENTS.md).
