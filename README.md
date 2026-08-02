# SURVEY_API — Noosphere Survey Fastify service

TypeScript Fastify API for anonymous psychological survey enrollment, consent, IPIP-50 collection, server-side scoring, and withdrawal.

## Setup

```powershell
cd SURVEY_API
copy .env.example .env
yarn install
yarn typecheck
yarn test:unit
```

Set `DATABASE_URL` in `.env` to either:

- **Neon** (recommended remote): your Neon connection string with `sslmode=require`
- **Local Docker**: run `DATABASE\scripts\up.ps1`, then use the localhost URL from `.env.example`

`.env` is gitignored — never commit real credentials.

```powershell
yarn dev
```

Default: `http://localhost:8787`

Check DB: `GET /ready` → `{ "ok": true, "database": "up" }`

## Deploy on Render

Repo is ready for a Render **Web Service** linked to this GitHub repo.

| Setting | Value |
|---------|--------|
| Runtime | Node |
| Root Directory | *(leave empty — this repo is the API root)* |
| Build Command | `yarn install --frozen-lockfile && yarn build` |
| Start Command | `yarn start` |
| Health Check Path | `/health` |

**Environment variables** (Dashboard → Environment):

| Key | Value |
|-----|--------|
| `DATABASE_URL` | Neon connection string (`sslmode=require`) |
| `HOST` | `0.0.0.0` |
| `NODE_ENV` | `production` |
| `CORS_ORIGIN` | `*` or your app origin(s), comma-separated |
| `RESEARCHER_API_KEY` | long random secret (optional until research endpoints) |

Render sets `PORT` automatically — do not override it.

Optional: apply the Blueprint in [`render.yaml`](./render.yaml) (New → Blueprint). Set `DATABASE_URL` and `RESEARCHER_API_KEY` when prompted (`sync: false`).

After deploy: `https://<service>.onrender.com/health` and `/ready` should both return ok.

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | no | Liveness |
| GET | `/ready` | no | DB readiness |
| GET | `/v1/studies/:studyCode` | no | Study + protocol metadata |
| POST | `/v1/enroll` | no | Create anonymous participant + installation token |
| POST | `/v1/consent` | Bearer | Record protocol consent |
| GET | `/v1/instruments/:code/:version?locale=en` | no | Enabled instrument + items |
| POST | `/v1/sessions` | Bearer | Create/resume session (manifest hash required) |
| POST | `/v1/sessions/:id/responses` | Bearer | Batch upsert responses; `complete=true` scores |
| POST | `/v1/sessions/:id/telemetry` | Bearer | Consented heartbeat/session-integrity events |
| GET | `/v1/sessions/:id` | Bearer | Session status |
| GET | `/v1/me` | Bearer | Anonymous participant status |
| POST | `/v1/withdraw` | Bearer | Withdraw / delete retained data |
| GET | `/v1/research/live-sessions` | Researcher Bearer key | Latest consented session status |

Set `RESEARCHER_API_KEY` to a long random secret before using the protected live-session
endpoint. Do not expose this endpoint directly to the public internet.

## Session telemetry

Telemetry is accepted only when the participant separately consented under
`consent_v2`. It includes heartbeat, progress count, current page, foreground/background,
inactivity duration, and upload state. It excludes answer content, camera, microphone,
location, and screen recordings.

## Security notes

- Parameterized SQL only
- Helmet, CORS, rate limiting, body size limit
- Installation tokens stored hashed (`sha256:`)
- No scientific scores returned to clients (neutral receipt only)
- TLS required in production
- Logs must not include raw response payloads in production deployments

## Research readiness warning

Software completeness does **not** authorize human data collection. Obtain ethics determination, approved consent text, DPIA/security review, and validated Portuguese wording before enabling `pt-BR` or recruiting participants.
