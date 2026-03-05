# Phase 02: Data Quality + Performance

This phase makes the prototype fast and trustworthy at scale: it hardens CSV/polygon ingestion, improves matching coverage (while keeping v1 “exact match” as the default), and tunes map rendering so it stays responsive on mobile even with many polygons.

## Tasks

- [ ] Profile and optimize polygon rendering for thousands of shapes:
  - Search for existing performance patterns in the repo first (clustering, simplification, canvas renderer) and reuse if present
  - Switch Leaflet polygon rendering to a faster mode where possible (e.g., canvas renderer) and avoid re-creating layers on every refresh
  - Add memoization and state partitioning so refresh updates styles without rebuilding geometry
  - Add a simple performance guardrail: if polygon count is high, delay non-critical UI work until after first render

- [ ] Improve CSV tail-fetch robustness and caching:
  - Implement a “progressive tail fetch”: start with a small `Range` (e.g., last 256KB), detect earliest parsed timestamp, and expand range if needed to cover the configured fade window
  - Add ETag/If-Modified-Since handling if the host supports it; otherwise keep a “last seen” hash to skip redundant parsing
  - Keep an in-memory + `localStorage` cache keyed by URL + last-modified so reloads render instantly

- [ ] Add name normalization and an optional mapping file (default off):
  - Keep “exact match only” as the default behavior
  - Add a normalization function used only in “smart match” mode (strip extra spaces, unify punctuation, normalize hyphens/quotes, etc.)
  - Add an override mapping file (e.g., `src/data/nameOverrides.json`) to map CSV place names → polygon area names for known mismatches
  - Add a small UI toggle: “התאמה חכמה (ניסיוני)” and show a match-coverage percentage indicator

- [ ] Improve zone info UX (still simple, still Hebrew):
  - Add consistent tooltip/popup formatting: last alarm time (local), “minutes ago”, and data source (Realtime/CSV/Cache/Fixture)
  - Add a focused-zone header when a zone is selected, with a quick “קישור לשיתוף” using URL hash/query (deep link)

- [ ] Add targeted tests for the critical data layer (no UI snapshots yet):
  - Unit tests for: CSV parsing, timestamp parsing, tail-range expansion logic, name normalization, opacity calculation
  - Ensure tests run fast and don’t require network (use fixtures)

- [ ] Run tests and fix failures:
  - Run the test suite and address only failures caused by this phase’s changes
  - Re-check that the dev server still loads quickly on mobile-sized viewports
