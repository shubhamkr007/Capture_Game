Render single-service deploy instructions

- Service Type: Web Service
- Root Directory: project root (leave blank) or set to the repo root where `package.json` lives
- Build Command: `npm ci && npm run build`
- Start Command: `npm start`
- Environment:
  - `DATABASE_URL` - your Postgres connection string
  - `PORT` - optional (Render sets this automatically)

Notes:
- The backend `server/index.js` now embeds Next.js and calls `next.prepare()` at startup. Run `npm run build` before `npm start` so Next has production build artifacts.
- Local commands to verify:

```bash
npm install
npm run build
npm start
```

- If you prefer static export instead of server-side Next, change `package.json` to run `next export` and ensure `server/index.js` serves the exported `/out` folder (previous commit had that). For app-router features and SSR, keep the current Next server approach.
