# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm install` — install dependencies (no lockfile is committed)
- `npm run dev` — Vite dev server with HMR
- `npm run build` — `tsc -b` (project references) then `vite build`. Type errors fail the build.
- `npm run lint` — ESLint over the repo
- `npm run preview` — serve the production build

There is no test runner configured.

## What this is

Base interactive map of Brazil with drill-down `Brasil → Região → Estado → Município`. Derived from a sibling project (`cidadesbrasileiras`) with IBGE statistics, IDHM, and editorial curiosities stripped out — intended as a clean substrate for a health-data project. UI text is in Brazilian Portuguese.

## Architecture

### View state is a discriminated union driven by URL hash

`View` (in `src/types.ts`) has four kinds: `brasil | regiao | estado | cidade`. `App.tsx` holds the single `view` state and:
- Two-way syncs `view` ↔ `location.hash` via `viewToHash` / `hashToView` (`#/regiao/N`, `#/uf/SP`, `#/cidade/SP/3550308`).
- Maps Escape and a "voltar" button to `stepBack`, which walks the view up one level (city → state → region → brasil).
- Passes `view` plus hover state down to `AtlasMap` (the SVG) and `SidePanel` (the contextual right column).

When changing navigation semantics, change `stepBack`, the hash helpers, and both consumers together — there is no router.

### Map rendering — `src/components/AtlasMap.tsx`

This is the perf-critical file. Key invariants:

- **Projection is built once at module load.** `geoIdentity().reflectY(true).fitExtent(...)` is fitted to `STATES_GEO` and reused for both states and municipalities. Don't recompute per render.
- **State path strings, centroids, and bounds are pre-computed once into `STATE_GEOMS`** keyed by sigla.
- **Per-UF municipality paths are memoized in `MUN_PATH_CACHE`.** `geoPath` calls are expensive enough that doing them on render kills interaction; `getMunGeoms(uf, geo)` fills the cache on first use.
- **The animated viewBox uses motion values (`vx/vy/vw/vh`) not React state.** Labels that need to rescale inversely with zoom read `zoomMV` via `useTransform` so they don't trigger re-renders during the 0.55s viewBox animation. When adding map decorations that depend on zoom, follow the `ZoomedLabel` / `ActiveMunLabel` pattern — never `useState` from the animation.
- **First mount skips animation** via `isFirst` ref; subsequent view changes animate the viewBox.

### Data layer — `src/data/`

Two kinds of data, loaded differently:

1. **Bundled JSON** imported with Vite's `?raw` suffix and parsed at module load:
   - `estados.geojson` → `STATES_GEO` (state polygons + properties)
   - `municipios.json` → flat list of all ~5,571 municipalities (id, nome, uf, ufId, regiao). Indexed by `MUNICIPIOS_BY_UF` and `MUNICIPIOS_BY_ID`.

2. **Lazy-fetched from IBGE API**, memoized in-memory AND in `localStorage` (30-day TTL, prefix `ibge:`) — see `ibge.ts`:
   - `fetchMunicipiosGeo(uf)` → per-state municipal polygons (IBGE `malhas`, intermediate quality). Triggered by `AtlasMap` when entering `estado` or `cidade` view.

   The `memoLS` helper handles serialise/hydrate so non-trivial values survive a round-trip through `JSON`. Use it when adding new cached fetches (e.g. health datasets for this project).

### Styling

Tailwind v3 with a custom editorial palette in `tailwind.config.js` (`paper-*`, `ink-*`, `verde-*`, `terra-*`, `ocre-*`, `atlantic`) and corresponding CSS variables in `src/index.css`. Region colors in `regionFill()` (AtlasMap) and `REGIONS` (regions.ts) are duplicated by design — the SVG fills are hex strings, the legend metadata is a separate object. Keep both in sync when changing region colors.

Fonts: Fraunces (display, italic for editorial flourishes), Bricolage Grotesque (body), JetBrains Mono (numerics/labels, applied via the `.num` class).

## Conventions worth knowing

- Município IDs are the 7-digit IBGE códigos as `number` in TypeScript.
- Region IDs are the two-letter `RegionId` codes: `N | NE | CO | SE | S` (not the IBGE numeric codes).
- TypeScript strict mode is on; `tsc -b` is part of `build`, so type errors block shipping.
- Header text in `App.tsx` still says "Atlas das Cidades" — change there when this project gets its own identity.

## Where to plug in health data

The `SidePanel` is the primary surface for per-município info. `CidadePanel` currently just shows name + UF + região; replace its body (or add sections) to render whatever data this project loads. For state-level dashboards, follow the pattern that was in the parent project: a `useStateStats(ufId)` hook backed by a `memoLS` fetcher in `src/data/`.

`CityList` in `SidePanel.tsx` only displays nome + id today; add columns there if you want sortable/comparable per-município indicators in the state view.
