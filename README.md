# bedshim

Turn a Klipper bed mesh into a Kapton-tape shim plan, a printable reference
lattice (STL), and a closed calibration loop.

Offline single-page app: TypeScript + Vite + React + Ant Design 5, no backend,
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
| P0 scaffold | done — Vite/React/Ant shell, i18n EN/RU, offline service-worker stub, CLI stub |
| P1 mesh | done — three mesh shapes, Klipper-exact bicubic surface, fixture golden tests |
| P2–P6 | not started |

`src/core/` is headless: no React, no DOM, no `window`. Every user-visible string
it produces is a message code translated through `src/i18n`.

## Fixtures

`fixtures/neptune4-mesh.{cfg,block,points}` — the same Elegoo Neptune 4 11×11 mesh
in three real-world shapes (SPEC Appendix A).
