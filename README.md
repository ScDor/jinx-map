# Jinx Map (מפת ג׳ינקס)

Client-only, mobile-first Hebrew web app that maps OREF polygons and shows time since the last alarm.

## Quick Start

```bash
npm install
npm run dev
```

## Main Commands

- `npm run dev` - start local server
- `npm run build` - create production build
- `npm run test` - run tests
- `npm run polygons:sync` - refresh `public/polygons.json`

## Configuration

Copy `.env.example` to `.env.local` for local overrides (`src/config.ts`).

## Data Sources

- Polygons: [`amitfin/oref_alert`](https://github.com/amitfin/oref_alert)
- Alarm feed: [`yuval-harpaz/alarms`](https://github.com/yuval-harpaz/alarms)

## Deployment

CI validates format, lint, tests, and build on PRs and `main`.
`main` deploys to GitHub Pages at `https://<owner>.github.io/jinx-map/`.
