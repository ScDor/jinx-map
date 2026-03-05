# Jinx Map (מפת ג׳ינקס)

Hebrew-only, client-only, mobile-first single-page app prototype for visualizing OREF polygons and “time since last alarm”.

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
