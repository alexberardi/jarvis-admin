# jarvis-admin

Web admin dashboard for managing Jarvis services. Superuser-only access.

React 19 + Vite frontend served by a Fastify backend that proxies to jarvis-auth, jarvis-config-service, and jarvis-settings-server.

## Quick Start

```bash
# Install dependencies
npm install
cd server && npm install && cd ..

# Development (frontend on :5173, backend on :3000)
npm run dev          # frontend
cd server && npm run dev  # backend

# Production build
npm run build
cd server && npm run build
node server/dist/index.js  # serves frontend + API on :3000
```

## Docker

```bash
docker build -t jarvis-admin .
docker run -p 3000:3000 jarvis-admin
```

The container includes a healthcheck against `GET /health`.

## Architecture

- **Frontend**: React 19, React Router, TanStack Query, Tailwind CSS v4
- **Backend**: Fastify 5, proxies auth/settings/services to upstream Jarvis services
- **Service discovery**: Automatically resolves service URLs from `jarvis-config-service` at startup

## Dependencies

| Service | Required | Purpose |
|---------|----------|---------|
| jarvis-config-service (7700) | Yes | Service discovery |
| jarvis-auth (7701) | Yes | User authentication (superuser only) |
| jarvis-settings-server (7708) | Yes | Settings CRUD |

## Tests

```bash
cd server && npm test
```
