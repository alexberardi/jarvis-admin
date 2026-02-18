# jarvis-admin

Web admin dashboard for managing Jarvis service settings. Superuser-only access.

## Quick Reference

```bash
# Setup
npm install

# Dev server (http://localhost:7710)
npm run dev

# Type check
npx tsc -b

# Build
npm run build
```

## Architecture

```
src/
├── api/            # Axios clients (auth, settings), configured dynamically
├── auth/           # AuthContext (login, token refresh, superuser gate)
├── discovery/      # Network discovery (find config-service, resolve URLs)
├── hooks/          # useAuth, useSettings (TanStack Query)
├── components/
│   ├── layout/     # AppShell, Sidebar, Header
│   └── settings/   # ServiceCard, CategoryGroup, SettingRow, SettingEditor
├── pages/          # LoginPage, SettingsPage, NotFoundPage
├── theme/          # ThemeProvider (dark/light), color tokens
├── types/          # TypeScript interfaces (mirrored from backend)
└── lib/            # Utility functions (cn)
```

## Auth Flow

1. Login via `POST /auth/login` to jarvis-auth (port 7701)
2. Non-superuser accounts are rejected at the frontend (error shown, tokens not stored)
3. Tokens stored in localStorage, attached to settings-server requests via axios interceptor
4. On 401 from settings-server, auto-refresh is attempted; if that fails, redirect to login

## Network Discovery

Service URLs are resolved automatically at startup via `jarvis-config-service` — no environment variables needed.

**Discovery flow:**
1. Check localStorage cache for a previously-discovered config service URL; validate with `/info` probe
2. Scan `localhost` ports 7700-7711, hitting `/info` on each
3. If not found, discover local IP via WebRTC, then scan the /24 subnet on ports 7700-7711
4. First response where `{"service": "jarvis-config-service"}` matches wins
5. Use config service's `GET /services/jarvis-auth` to resolve auth URL; settings API lives on the config service itself
6. Cache discovered config URL in localStorage for fast subsequent loads

**Requires:** `jarvis-config-service` running on the network with `jarvis-auth` registered. Settings API is served by the config service itself at `/v1/settings`.

## Dependencies

**Frontend Libraries:**
- React 19, React Router, TanStack Query, Axios, Lucide icons, Sonner (toasts)
- Tailwind CSS v4, CSS custom properties for theming

**Service Dependencies:**
- ✅ **Required**: `jarvis-config-service` (7700) - Network discovery to find services
- ✅ **Required**: `jarvis-auth` (7701) - User authentication (superuser only)
- ✅ **Required**: `jarvis-settings-server` (7708) - Settings CRUD operations

**Used By:**
- Administrators (web browser)

**Impact if Down:**
- ⚠️ No web UI for settings management
- ✅ All backend services continue to work
- ✅ Settings can still be managed via direct API calls or env vars

## Adding New Pages

1. Create `src/pages/MyPage.tsx`
2. Add route in `src/App.tsx` inside the `<AppShell>` route
3. Add nav item in `src/components/layout/Sidebar.tsx` navItems array

## Theme

Colors match jarvis-node-mobile. Dark/light mode toggled via header button, persisted to localStorage.
