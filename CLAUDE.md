# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev              # Start Vite dev server (port 1420)
npm run tauri dev        # Start full Tauri app in dev mode (Rust + Vite)
npm run check            # Run all checks: typecheck → lint → format:check → test
npm run test             # Vitest (57 tests, single run)
npm run test:watch       # Vitest watch mode
npm run lint             # ESLint (src/ only)
npm run typecheck        # tsc --noEmit
npm run format           # Prettier write
npm run format:check     # Prettier check (CI uses this)
```

Building the app:
```bash
source "$HOME/.cargo/env"    # Rust must be in PATH
npx tauri build --bundles app   # Build .app only (faster)
npx tauri build                 # Build .app + .dmg
```

The built app lands at `src-tauri/target/release/bundle/macos/QTE Time Tracker.app`.

## Architecture

macOS menu bar time tracker that syncs to AgileDay. Tauri v2 (Rust) shell + React 19 frontend.

**No backend.** AgileDay is the database. Users must sign in with AgileDay OAuth — there is no offline/mock mode for end users (mock provider exists only for tests).

### Three layers

1. **Tauri shell** (`src-tauri/src/lib.rs`) — system tray menu (Show, Sync, New, Stop, Quit), window lifecycle (show/hide, Dock visibility toggle), localhost OAuth callback server, plugin registration
2. **React frontend** (`src/`) — UI components, state via Context+useReducer, timer logic
3. **API abstraction** (`src/api/provider.ts`) — `ApiProvider` interface with two implementations:
   - `mock-core.ts` → in-memory storage, seeded data, testable via injectable `EntryStore` (tests only)
   - `agileday.ts` → real REST API client with Bearer JWT, token refresh, HTTPS enforcement, Origin header override

### Provider switching

`src/store/context.tsx` checks auth state on mount. If authenticated → `createAgileDayProvider()`, otherwise → `null` (login screen shown). Data reloads when `isConnected` or `syncCounter` changes. Sync can be triggered via tray menu (Cmd+R).

### Auth flow (OAuth 2.1 PKCE)

`src/api/auth.ts` has the PKCE primitives. `src/api/auth-manager.ts` orchestrates the flow using a localhost HTTP server on port 19847 to capture the OAuth callback redirect. Constants (tenant `qvik`, client_id) are hardcoded in `auth-manager.ts` for company-wide use. Background token refresh runs every 30s, refreshes when < 1 min to expiry.

### State shape

`src/store/reducer.ts` — `AppState` holds: employee, projects, myProjectIds (allocated projects), tasks, entries (last 30 days), timer (running state + timestamps), loading, error. The timer uses timestamp-based elapsed calculation (no drift).

## API endpoints used

AgileDay requires `Origin: https://qvik.agileday.io` header on all requests (Tauri HTTP plugin with `unsafe-headers` feature).

- Reading entries: `/v1/time_entry/employee/id/{id}/updated` (returns all statuses with descriptions)
- Fallback: `/v1/timesheets/{id}/summary` (all statuses, no descriptions)
- Creating: `POST /v1/time_entry/employee/id/{id}` — checks for existing entry first (same project+date+description), PATCHes if found, creates if not. Multiple duplicates are consolidated (create new total, delete old).
- Projects: `GET /v1/project?projectStage=ACTIVE`
- Allocated projects: `GET /v2/opening` with employee filter
- Tasks: `GET /v1/project/id/{id}/task`

## Testing

Tests live in `src/api/__tests__/`. Two test suites:
- `mock-provider.test.ts` — 32 tests for the ApiProvider contract via mock implementation
- `agileday-provider.test.ts` — 25 tests for the AgileDay client (mocked fetch, JWT decode, auth flow)

Total: 57 tests. Run a single file: `npx vitest run src/api/__tests__/mock-provider.test.ts`

## CI/CD

- **CI** (`.github/workflows/ci.yml`): runs on push to main + PRs. Typecheck, lint, format, test.
- **Release** (`.github/workflows/release.yml`): manual dispatch from GitHub Actions. Choose patch/minor/major → auto-bumps version in 3 files (`package.json`, `tauri.conf.json`, `Cargo.toml`), commits, tags, builds macOS DMG + updater artifacts, publishes GitHub Release.

Secrets: `TAURI_SIGNING_PRIVATE_KEY` (Tauri-generated key for update signing).

## Key decisions

- **Both project and task are required** before starting timer. Description is optional.
- **Entry consolidation on AgileDay** — same description + project + date = one entry. Timer stop checks for existing entry, PATCHes if 1 match, consolidates if multiple matches (create + delete old).
- **Individual sessions in app UI** — each timer stop adds a visible session locally, grouped by description. AgileDay gets the aggregated total.
- **Saving to AgileDay is immediate** — stop timer → POST/PATCH. Failed saves marked `syncStatus: "unsaved"`.
- **Submitted entries are locked** — can't edit in the app, only via AgileDay web. Play button still works (starts new today entry).
- **Projects filtered by allocation** — default shows only projects user is allocated to. Search bar searches all active projects.
- **Continue button always starts as today** — date changes only via AgileDay.
- **Window close hides, doesn't quit** — quit only via tray menu. App shows in Dock/Cmd+Tab when window is visible.

## Specs

`specs/agileday-tracker/` contains `plan.md` (implementation plan), `spec.md` (acceptance criteria), and `openapi.yaml` (AgileDay REST API spec). Note: plan.md task checkboxes may be outdated — most Phase 1-4 tasks are complete.
