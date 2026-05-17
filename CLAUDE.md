# jarvis-admin

Web admin app for the Jarvis stack. **Two-part service**: a React/Vite frontend (TypeScript, Tailwind) plus a Fastify backend (Node.js) that proxies to other services and orchestrates Docker. Used for first-boot wizard, ongoing settings management, container lifecycle, and observability.

> **Identity rule:** the backend doesn't own *settings data* — it proxies aggregated settings from config-service's gateway. It DOES own the **deployment / orchestration logic** (compose generation, install reconcile, update apply). When in doubt: "this is about *running* services" → admin owns it; "this is about *configuring* services" → admin proxies.

---

## Topology

```
                   Browser
                      │
                      ▼
         ┌───────────────────────┐
         │  jarvis-admin :7710   │
         │  (Fastify backend +   │
         │   static SPA bundle)  │
         └──┬─────────┬─────────┘
            │         │
            │         ├──▶ jarvis-auth        (login, JWT issue)
            │         ├──▶ jarvis-config-service ─── /v1/settings/* (aggregated settings)
            │         ├──▶ jarvis-command-center ── /api/v0/admin/traces (request traces)
            │         ├──▶ jarvis-config-service ─── /v1/services/registry (bootstrap state)
            │         └──▶ jarvis-llm-proxy-api ─── /v1/model/info (model selection UX)
            │
            │ Docker socket (/var/run/docker.sock)
            ▼
   docker daemon: ps, logs, restart, compose up/down
```

The frontend is also **served by the backend** in production (static bundle in `dist/`). In dev, Vite runs on its own port and proxies API calls to the Fastify backend.

---

## Quick Reference

```bash
# Production: the ./jarvis CLI starts admin in Docker automatically.
# You usually don't need to run anything manually.

# Frontend dev (only the SPA, hits the backend separately)
npm install
npm run dev          # Vite on :5173

# Type check
npx tsc -b

# Build SPA → dist/, then backend can serve it
npm run build

# Backend dev (with hot reload)
cd server && npm install && npm run dev

# Docker dev (recommended — full stack)
docker compose -f docker-compose.dev.yaml up -d

# Tests (backend only — no frontend tests yet)
cd server && npm test
```

---

## Dependency graph

**Upstream (admin depends on):**
- **Docker daemon** — required; admin reads `/var/run/docker.sock` for container ops
- **jarvis-config-service** (port 7700) — required at startup to discover service URLs; also serves the settings-gateway that admin proxies
- **jarvis-auth** (port 7701) — required for login + JWT issuance; superuser-only access enforced at the SPA
- **jarvis-command-center** (port 7703, optional) — request trace viewer
- **jarvis-llm-proxy-api** (port 7704, optional) — model info for the LLM-setup wizard
- **Filesystem** — reads/writes `~/.jarvis/compose/docker-compose.yml`, `~/.jarvis/state.json`, etc. via the compose service

**Downstream:** browsers only.

**Impact if down:**
- No admin UI; everything backend still works
- Settings can still be changed by hitting config-service `/v1/settings/*` directly with a superuser JWT
- Containers can still be managed with `docker compose` CLI

---

## Backend API surface (Fastify, `server/src/routes/*`)

| Prefix | Module | What it does |
|---|---|---|
| `/health` | `health.ts` | Liveness probe |
| `/api/auth` | `auth.ts` | Login + token refresh — forwards to jarvis-auth |
| `/api/settings` | `settings.ts` | **Proxies to `${configUrl}/v1/settings/*`** (config-service gateway). The settings aggregator. |
| `/api/services` | `services.ts` | Registered services + status (uses `services/registry.ts`) |
| `/api/containers` | `containers.ts` | Docker container list, logs, restart, start/stop |
| `/api/system` | `system.ts` | Host info, disk usage, version |
| `/api/nodes` | `nodes.ts` | Pi Zero node CRUD (via command-center) |
| `/api/setup` | `setup.ts` | First-boot wizard — `/status`, `/probe`, persisted config save |
| `/api/llm-setup` | `llm-setup.ts` | LLM-specific quickstart (model selection, prompt-provider config) |
| `/api/quick-sets` | `quick-sets.ts` | Preset configuration bundles (declarative one-click setups) |
| `/api/models` | `models.ts` | LLM model info from llm-proxy |
| `/api/update` | `update.ts` | Stack-wide update flow — check + apply |
| `/api/install` | `install.ts` | Install/reconcile services — invokes compose generation + docker compose up |
| `/api/traces` | `traces.ts` | Request trace viewer — proxies to CC `/api/v0/admin/traces` |

All `/api/*` routes (except `/auth/login`) require a valid superuser JWT, enforced via `middleware/auth.ts`. Tokens come from jarvis-auth.

---

## Lifecycle / common operations

### 1. First-boot wizard

```
User visits / ──▶ Frontend hits /api/setup/status
                       │
                       ├── If configured: render dashboard
                       └── If not: render wizard
                              │
                              ├── Step 1: discover config-service (network scan or manual URL)
                              ├── Step 2: superuser setup — calls jarvis-auth /auth/setup-status + /auth/setup
                              ├── Step 3: module selection — checkboxes against service-registry.json
                              ├── Step 4: port + host overrides
                              ├── Step 5: install — POST /api/install
                              │     │
                              │     ├── compose-generator.ts generates docker-compose.yml from wizard state
                              │     │   (macOS: filters out llm-proxy — runs natively on GPU)
                              │     ├── compose.ts writes the file
                              │     ├── orchestrator.ts runs `docker compose up -d` tier-by-tier
                              │     │   (tier 1: config-service → tier 2: auth → tier 3: logs → tier 4: rest)
                              │     └── pollServiceHealth() waits for each tier to be healthy
                              └── Step 6: register services via config-service /v1/services/register
                                  (which also creates app credentials in jarvis-auth and writes .env files)
```

### 2. Editing settings (steady state)

```
SPA → Fastify /api/settings ─proxy─▶ config-service /v1/settings/*
                                            │
                                            ├── fan-out: each service's /settings/* via jarvis-settings-client mount
                                            └── aggregates results, returns to admin
```

Writes use `PUT /v1/settings/{service}/{key}` — the gateway proxies the write to the owning service.

### 3. Container management

```
SPA → Fastify /api/containers → DockerService (services/docker.ts) → Docker SDK → daemon
```

`DockerService` wraps the dockerode library. Container actions: list, logs, restart, stop, start. Compose operations go through `ComposeService` (services/compose.ts), which shells out to `docker compose` CLI.

### 4. Update flow

```
SPA → /api/update/check → UpdateChecker
        │
        ├── Reads ~/.jarvis/state.json for current versions
        ├── Hits ghcr.io for latest tags per service
        └── Returns diff

SPA → /api/update/apply → pulls images + runs compose up -d per tier
```

---

## "How to..." recipes

### Add a new admin page

1. **Frontend:** Create `src/pages/MyPage.tsx`. Add route in `src/App.tsx` inside the `<AppShell>` route. Add nav item in `src/components/layout/Sidebar.tsx`.
2. **Backend (if needed):** Create `server/src/routes/my-thing.ts` exporting a `myThingRoutes(app)` function. Register in `server/src/app.ts`'s `buildApp()`.
3. **Auth:** All `/api/*` routes get the superuser JWT middleware by default; no extra work needed.

### Add a new service to the wizard

Edit `server/src/data/service-registry.json`. The registry declares:
- `core` (always included) — config, auth, logs, command-center, llm-proxy
- `recommended` (default-on) — typical full install
- `optional` (default-off) — power features
- `infrastructure` (always included) — postgres, redis, minio, mosquitto
- `workers` (background workers per service)

Each entry has `id`, `port`, `image`, `healthCheck`, `description`, dependencies. Compose generation reads this file at request time — no rebuild needed when adding entries.

### Add a preset configuration ("quick set")

Edit `server/src/data/quick-sets.json`. A quick-set is a named bundle of setting writes — e.g., "small GPU box" might set `tts.provider=piper`, `tts.kokoro_device=cpu`, `model.live.path=...`. The wizard exposes them as one-click presets after install.

### Proxy a new downstream service

Use the proxy pattern in `server/src/services/proxy.ts`. Resolve the target URL from `app.config` (URLs come from config-service at startup via `resolveServiceUrls`). Forward the user's JWT in the Authorization header.

---

## Invariants & gotchas

1. **Admin's settings aggregator is the config-service gateway, not jarvis-settings-server.** See `server/src/routes/settings.ts:15`. The standalone settings-server (port 7708) is the deprecation candidate — don't switch to it.
2. **URL resolution at startup, not per-request.** `buildApp()` calls `resolveServiceUrls` once. If config-service is unreachable at startup, admin falls back to env defaults but logs a warning. Service URL changes after startup require an admin restart. (This is fine for the wizard's first-boot use case — order of operations: start config-service → start admin.)
3. **Env vars override discovered URLs.** If `AUTH_URL=...` is set in admin's env, the resolved URL from config-service is ignored. Useful for development; risky in production because it can silently mask a misconfigured config-service entry.
4. **The backend serves the SPA in production.** Static files live at `config.staticDir` (default `./dist`). In dev, Vite serves the SPA on a different port; in prod, Fastify serves both.
5. **SPA fallback for non-API routes.** `setNotFoundHandler` serves `index.html` for anything not under `/api/*` or `/health`. Don't add server-side rendering — it'll break this routing.
6. **`buildApp(opts)` accepts service injections for tests.** Pass mocked `docker`, `compose`, `registry` services to override the real implementations. `services/docker.ts` and `services/compose.ts` should never be imported directly inside route handlers — always read from `app.docker` / `app.compose` so tests can mock them.
7. **macOS GPU services are filtered out of compose.** `compose-generator.ts:getComposeServices` excludes GPU-dependent services on `process.platform === 'darwin'` because they run natively (MLX / Metal GGUF) to access the GPU. If you add a new GPU service, mark `gpuDependent: true` in service-registry.json.
8. **Empty JSON bodies are tolerated.** A custom content-type parser converts empty `application/json` bodies to `{}` (`server/src/app.ts:81`). This is for argument-less POSTs like `/api/update/apply`. Don't remove it — the SPA depends on this.
9. **CORS is `origin: true`.** Reflects the request origin, so any browser-loaded host that can hit admin can call its API. Fine in a trusted LAN; would need tightening for a public-facing deployment.
10. **First-boot setup is one path; ongoing admin is another.** The wizard intentionally calls different endpoints (`/api/setup/*`) than ongoing settings (`/api/settings/*`). Don't merge them — the wizard has special bootstrap concerns (no superuser yet, services not running yet, etc.).
11. **Request logger hook prints every response.** `app.addHook('onResponse', ...)` is verbose by design — it's the simplest way to debug proxy issues. If logging becomes noisy in prod, gate it behind a config flag rather than removing the hook.

---

## Frontend architecture (`src/`)

```
src/
├── App.tsx                       # Top-level routes; <AppShell> wraps authed pages
├── auth/                         # AuthContext, login flow, token refresh
├── api/                          # Axios clients — pre-configured with base URL + auth interceptor
├── hooks/                        # useAuth, useSettings (TanStack Query)
├── context/                      # App context providers
├── components/
│   ├── layout/                   # AppShell, Sidebar, Header
│   ├── settings/                 # ServiceCard, CategoryGroup, SettingRow, SettingEditor
│   ├── wizard/                   # First-boot wizard steps
│   ├── dashboard/                # Service tiles, health badges, traces table
│   └── services/                 # Per-service detail components
├── pages/                        # Top-level pages (Login, Settings, Dashboard, Wizard, etc.)
├── theme/                        # Dark/light tokens, ThemeProvider
├── types/                        # Mirror of backend types
└── lib/                          # cn() etc.
```

Frontend uses **React 19**, **TanStack Query** for server state, **Axios** for HTTP, **Tailwind v4** (CSS custom properties for theming), **Lucide** icons, **Sonner** toasts.

---

## Backend architecture (`server/src/`)

```
server/src/
├── index.ts                       # Entry — calls buildApp() and listens
├── app.ts                         # buildApp() — Fastify factory + URL resolution + route wiring
├── config.ts                      # loadConfig + savePersistedConfig (writes ~/.jarvis/admin.json)
├── version.ts                     # Static version constant
├── middleware/auth.ts             # Superuser JWT validation
├── data/
│   ├── service-registry.json      # Declarative service registry (drives wizard, compose gen)
│   └── quick-sets.json            # Preset configuration bundles
├── routes/                        # See API surface table above
├── services/
│   ├── docker.ts                  # Docker SDK wrapper (ps, logs, restart, start/stop)
│   ├── compose.ts                 # docker-compose CLI wrapper (up, down, ps, generate)
│   ├── registry.ts                # In-memory service registry from service-registry.json
│   ├── configService.ts           # resolveServiceUrls (fetches from config-service /services)
│   ├── orchestrator.ts            # Tiered startup + health polling
│   ├── proxy.ts                   # Generic HTTP proxy to downstream services
│   ├── update-checker.ts          # Stack version diff against ghcr.io
│   └── generators/
│       ├── compose-generator.ts   # Wizard state → docker-compose.yml
│       ├── service-registry.ts    # Registry filter helpers (core/recommended/optional)
│       └── port-utils.ts          # Port → env var name conventions
└── types/                         # service-registry, wizard types
```

---

## Config surface (env, no DB)

| Variable | Default | Purpose |
|---|---|---|
| `JARVIS_CONFIG_URL` | `http://localhost:7700` | Where to find config-service for URL resolution |
| `AUTH_URL` | (resolved) | Override discovered jarvis-auth URL |
| `LLM_PROXY_URL` | (resolved) | Override discovered llm-proxy URL |
| `COMMAND_CENTER_URL` | (resolved) | Override discovered CC URL |
| `JARVIS_ROOT` | `/home/jarvis/jarvis` or similar | Root for docker-compose path resolution |
| `STATIC_DIR` | `./dist` | Where the built SPA lives — backend serves this in prod |
| `JARVIS_ADMIN_PORT` | `7710` | Bind port |

Settings are not persisted by this service. Wizard state is persisted to `~/.jarvis/admin.json` (see `config.ts:savePersistedConfig`).

---

## Testing

- **Backend has tests** (`server/tests/`) — Vitest. They test route handlers with mocked Docker, Compose, Registry services. Run: `cd server && npm test`.
- **Frontend has no tests today.** Type-check via `npx tsc -b`.
- When adding a route handler, always factor through `app.docker`/`app.compose`/`app.registry` (not direct imports) so tests can mock cleanly.

---

## Failure modes

| Failure | Behavior |
|---|---|
| Config-service unreachable at startup | Admin starts with default URLs; warns in logs |
| Auth down | Login fails; existing sessions degrade when JWT expires |
| Docker daemon unreachable | `/api/containers/*` returns 500; rest of admin still works |
| Compose file write fails | `/api/install` returns 500; wizard step fails cleanly |
| Service registry JSON malformed | Backend fails to start — fail loud at boot |
| Frontend can't reach backend | Auth context shows "service unavailable", retries on user action |

---

## Out of scope / explicitly not here

- **Settings storage.** Each service owns its settings; admin only aggregates the view.
- **Authentication.** Login is forwarded to jarvis-auth; this service has no user table.
- **User management.** Admin users (superusers) are managed in jarvis-auth's database.
- **Per-household admin UI.** The wizard and settings views are global — no household scoping yet.
- **MQTT or push.** Admin is request/response only. Real-time updates come from polling.
