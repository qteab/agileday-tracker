# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev              # Start Vite dev server (port 1420)
npm run tauri dev        # Start full Tauri app in dev mode (Rust + Vite)
npm run check            # Run all checks: typecheck → lint → format:check → test
npm run test             # Vitest (32 tests, single run)
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

**No backend.** AgileDay is the database. Local Tauri store is the offline/mock fallback.

### Three layers

1. **Tauri shell** (`src-tauri/src/lib.rs`) — system tray menu, window lifecycle (show/hide, Dock visibility toggle), deep-link handler for OAuth callback, plugin registration
2. **React frontend** (`src/`) — UI components, state via Context+useReducer, timer logic
3. **API abstraction** (`src/api/provider.ts`) — `ApiProvider` interface with two implementations:
   - `mock-core.ts` → local storage, seeded data, testable via injectable `EntryStore`
   - `agileday.ts` → real REST API client with Bearer JWT, token refresh, HTTPS enforcement

### Provider switching

`src/store/context.tsx` checks auth state on mount. If authenticated → `createAgileDayProvider()`, otherwise → `mockProvider`. Swaps automatically on login/logout. Data reloads when `isConnected` changes.

### Auth flow (OAuth 2.1 PKCE)

`src/api/auth.ts` has the PKCE primitives. `src/api/auth-manager.ts` orchestrates the flow using Tauri's deep-link plugin (`qte-tracker://auth/callback`). Constants (tenant, client_id) are hardcoded in `auth-manager.ts` for company-wide use.

### State shape

`src/store/reducer.ts` — `AppState` holds: employee, projects, tasks, entries (last 30 days), timer (running state + timestamps), loading, error. The timer uses timestamp-based elapsed calculation (no drift).

## Testing

Tests live in `src/api/__tests__/mock-provider.test.ts`. They test the `ApiProvider` contract through the mock implementation using an in-memory `EntryStore` (no Tauri dependency). Covers all CRUD methods, date filtering, error propagation, and data isolation.

To run a single test file or pattern: `npx vitest run --reporter=verbose src/api/__tests__/mock-provider.test.ts`

## CI/CD

- **CI** (`.github/workflows/ci.yml`): runs on push to main + PRs. Typecheck, lint, format, test.
- **Release** (`.github/workflows/release.yml`): manual dispatch from GitHub Actions. Choose patch/minor/major → auto-bumps version in 3 files (`package.json`, `tauri.conf.json`, `Cargo.toml`), commits, tags, builds macOS DMG, publishes GitHub Release with updater manifest.

Secrets: `TAURI_SIGNING_PRIVATE_KEY` (minisign key for update signing).

## Key decisions

- **Saving to AgileDay is immediate** — stop timer → POST. Edit → PATCH. Delete → DELETE. No sync button, no queue. Failed saves are marked `syncStatus: "unsaved"` with manual retry.
- **Projects are read-only** — fetched from AgileDay (`projectStage=ACTIVE`), never created locally. Colors assigned locally (AgileDay doesn't return them).
- **Description is optional** — matches AgileDay's schema. Project is required before starting timer.
- **Continue button always starts as today** — retroactive entries only via editing.
- **Window close hides, doesn't quit** — quit only via tray menu. App shows in Dock/Cmd+Tab when window is visible.

## Specs

`specs/agileday-tracker/` contains `plan.md` (implementation plan with task checkboxes), `spec.md` (acceptance criteria, 48 ACs), and `openapi.yaml` (AgileDay REST API spec).
