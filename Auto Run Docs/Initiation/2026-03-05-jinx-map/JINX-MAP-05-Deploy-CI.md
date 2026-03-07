# Phase 05: GitHub Pages Deployment + CI

This phase makes the app easy to ship and maintain: it adds a repeatable build, automated deployment to GitHub Pages, and lightweight CI checks so changes don’t quietly break the map or data ingestion.

## Tasks

- [ ] Make the app build reliably for GitHub Pages:
  - Search for any existing deployment config patterns in the repo; reuse if present
  - Configure the Vite base path for Pages (repo-name-aware) and ensure asset paths work when hosted under a subpath
  - Ensure `polygons.json` generation is part of the build pipeline (with a committed fallback if download fails)

- [ ] Add CI checks (fast, deterministic):
  - Add a GitHub Actions workflow to run: install, typecheck, lint, unit tests, and build
  - Ensure workflows do not require network at test time (use fixtures); allow optional build-time polygon download with fallback

- [ ] Add GitHub Pages deploy workflow:
  - Add a separate workflow that deploys on default-branch pushes (or tags) using the standard Pages action
  - Confirm the output directory and routing (single-page app) works when hosted

- [ ] Add a minimal “smoke test” runbook embedded in the repo (only if there is already a docs area):
  - Steps: open hosted URL, verify polygons load, search works, refresh works
  - Keep it short and purely actionable (no long narrative)

- [ ] Run CI locally (where possible) and fix issues introduced by deployment wiring:
  - Run the same commands as CI locally and fix only issues caused by this phase
  - Verify `npm run build` output runs via a static preview (`npm run preview`) with correct base path
