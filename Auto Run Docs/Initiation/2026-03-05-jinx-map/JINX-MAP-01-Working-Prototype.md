# Phase 01: Working Prototype (Map + CSV)

This phase bootstraps a Hebrew-only, client-only single-page app that runs locally and shows a working Israel map with OREF polygons, coloring zones by “time since last alarm” (CSV fallback). It prioritizes a tangible prototype: open the dev server and immediately see polygons, search, refresh, and fading visualization—while keeping realtime as best-effort and non-blocking.

## Tasks

- [x] Scaffold the project and baseline tooling (no user decisions):
  - Initialize git repo and create a Vite React+TypeScript app (single-page)
  - Add dependencies: Leaflet + react-leaflet, CSV parser, lightweight unzip lib (for polygon zip), date utils
  - Add ESLint/Prettier (or match existing if repo already has), strict TS, and a simple env-based config pattern
  - Ensure `npm run dev` starts a local server and renders a basic “Jinx Map” shell (Hebrew/RTL)

- [x] Implement the core UI shell (mobile-first, Hebrew, RTL):
  - Layout: full-screen map with a compact top bar (search input, refresh button, status text)
  - Add a small settings drawer/panel with a configurable “fade duration until opacity 0” (default: 60 minutes; persisted in `localStorage`)
  - Add lightweight “last updated” indicator and a non-intrusive error banner area (Hebrew copy)

- [x] Add polygons data pipeline with a reliable offline fallback:
  - First, search for existing polygon assets or scripts; reuse patterns if present
  - Create a build/dev script that downloads `amitfin/oref_alert` polygon metadata (`area_to_polygon.json.zip`), extracts it, and writes a normalized `public/polygons.json` (only what the app needs: name + coordinates/bounds)
  - Add committed fallback fixtures in `public/fixtures/` (tiny subset of polygons + sample alarms) so the app still “works” if network fetch fails
  - In the app: load `public/polygons.json` if present, else fall back to fixtures automatically
  - Notes: added `npm run polygons:sync` + `scripts/sync-polygons.mjs`, committed `public/fixtures/*`, and wired `src/data/polygons.ts` into the UI status.

- [x] Implement alarms ingestion (best-effort tail fetch + CSV fallback):
  - Fetch `yuval-harpaz/alarms/data/alarms.csv` every 60 seconds and on manual “רענון”
  - Prefer HTTP `Range` tail fetch (newest alarms are at the end); fall back to full fetch if `Range` is unsupported
  - Parse CSV robustly (UTF-8; handle quoted fields/newlines) and compute per-zone “last alarm timestamp” for exact name matches only
  - Persist the most recent computed state in `localStorage` so the UI can render quickly on reload even before fetch completes

- [x] Render the map visualization (Leaflet) with correct fading behavior:
  - Show Israel map with OSM tiles and polygons overlay (many polygons; keep performance in mind)
  - For each polygon with an exact CSV match, compute opacity: `1.0` immediately after alarm → linearly down to `0.0` at `fadeDuration`
  - Color: red for matched zones (with computed opacity); neutral/gray for unmatched zones (v1 exact matches only)
  - Add hover/tap tooltip or popup: zone name + “minutes since last alarm” (Hebrew), plus the alarm timestamp

- [x] Add search + focus (Hebrew-only) and a lightweight zones list:
  - Implement search-as-you-type over polygon names (debounced), showing top N matches
  - Selecting a result fits bounds/zooms to polygon and opens its popup
  - Add an optional compact list panel (collapsible on mobile) showing “most recently alarmed” zones for quick navigation
  - Notes: wired Leaflet `fitBounds` + `openPopup`, added “אזורים” panel; covered by `src/App.test.tsx`

- [ ] Add best-effort realtime attempt without risking the prototype:
  - Read `amitfin/oref_alert` implementation to identify any browser-callable realtime endpoints (WebSocket or HTTP) it uses
  - Implement a guarded realtime connector that tries once on load and then periodically (with backoff)
  - If realtime works: treat incoming alert areas as “last alarm = now” and mark as active (full opacity) until replaced by history updates; if “all clear” is detected, keep the fade logic but stop forcing “active”
  - If realtime fails (CORS/geo/blocked): automatically disable realtime and continue using CSV-only, with clear status text (“ריל־טיים לא זמין, משתמשים ב־CSV”)

- [ ] Manual verification checklist (run locally) and fix any issues:
  - `npm install`, `npm run dev` → map renders with polygons even offline (fixtures)
  - With network: CSV fetch updates “last updated” and polygon opacities change after refresh
  - Search selects and zooms correctly; refresh works; fade duration setting changes opacity behavior live
