# jarvis-admin

Web admin dashboard for managing Jarvis service settings. Superuser-only access.

## Quick Reference

```bash
# Setup
npm install

# Dev server (http://localhost:5173)
npm run dev

# Type check
npx tsc -b

# Build
npm run build
```

## Architecture

```
src/
├── api/            # Axios clients (auth, settings)
├── auth/           # AuthContext (login, token refresh, superuser gate)
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

1. Login via `POST /auth/login` to jarvis-auth (port 8007)
2. Non-superuser accounts are rejected at the frontend (error shown, tokens not stored)
3. Tokens stored in localStorage, attached to settings-server requests via axios interceptor
4. On 401 from settings-server, auto-refresh is attempted; if that fails, redirect to login

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_AUTH_URL` | `http://localhost:8007` | jarvis-auth base URL |
| `VITE_SETTINGS_URL` | `http://localhost:8014` | jarvis-settings-server base URL |

## Dependencies

- **Runtime**: React 19, React Router, TanStack Query, Axios, Lucide icons, Sonner (toasts)
- **Styling**: Tailwind CSS v4, CSS custom properties for theming
- **Backend**: jarvis-auth (8007) for authentication, jarvis-settings-server (8014) for settings CRUD

## Adding New Pages

1. Create `src/pages/MyPage.tsx`
2. Add route in `src/App.tsx` inside the `<AppShell>` route
3. Add nav item in `src/components/layout/Sidebar.tsx` navItems array

## Theme

Colors match jarvis-node-mobile. Dark/light mode toggled via header button, persisted to localStorage.
