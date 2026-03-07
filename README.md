# Jinx Map (מפת ג׳ינקס)

Hebrew-only, client-only, mobile-first single-page app prototype for visualizing OREF polygons and “time since last alarm”.

## Data attribution

- Polygon data is sourced from [`amitfin/oref_alert`](https://github.com/amitfin/oref_alert).
- Alarm feed data is sourced from [`yuval-harpaz/alarms`](https://github.com/yuval-harpaz/alarms).

## Local dev

```bash
npm install
npm run dev
```

## Scripts

- `npm run dev` – dev server
- `npm run build` – production build
- `npm run preview` – preview build
- `npm run lint` – ESLint
- `npm run format` / `npm run format:check` – Prettier
- `npm run polygons:sync` – download + normalize OREF polygons into `public/polygons.json`
- `npm run test` – Vitest (CI mode)

## Config

Copy `.env.example` to `.env.local` to override defaults (see `src/config.ts`).

## CI/CD

- CI runs on PRs and `main`: format check, lint, tests, and build.
- PRs get a GitHub Pages preview at `https://<owner>.github.io/jinx-map/pr-preview/pr-<number>/` (same-repo PRs only).
- `main` deploys to GitHub Pages at `https://<owner>.github.io/jinx-map/`.

GitHub repo settings required:

- Settings → Pages → Build and deployment → Source: **Deploy from a branch**
- Branch: **gh-pages** / **/(root)**
