# Architecture

QTE Time Tracker is a macOS menu bar app for logging time to AgileDay. It uses Tauri v2 (Rust shell) with a React 19 frontend. There is no backend server — AgileDay is the database.

## Three Layers

### 1. Tauri Shell (`src-tauri/src/lib.rs`)

The Rust layer handles:

- **System tray menu**: Show, Continue, Stop, Sync (Cmd+R), New, Finalize (Cmd+F), Settings (Cmd+,), Quit
- **Window lifecycle**: show/hide toggle, Dock visibility (ActivationPolicy), window close = hide (not quit)
- **OAuth callback server**: Localhost HTTP server on `127.0.0.1:19847` captures OAuth redirect
- **Timer status**: `set_timer_status` Tauri command updates tray menu text and button states (also carries the inactivity prefs)
- **Tray tick**: a 1-second background task keeps the menu bar timer advancing while the window is hidden. It reads state on its own thread but hands the actual tray update (`apply_tray_state`) to `run_on_main_thread`. Tray/menu setters called off the main thread block until the main thread runs them, so calling `apply_tray_state` (which holds locks across those setters) from the tick thread deadlocks against `set_timer_status` and freezes the app. Never update the tray from a background thread.
- **Inactivity detection**: while a timer runs and the feature is enabled, the 1-second tray tick reads system-wide idle via `CGEventSourceSecondsSinceLastEventType` (CoreGraphics FFI, no permission prompt). Past the threshold it shows a red status-dot icon (`tray-inactive.png`) + "You've been inactive for Hh Mm" title, and emits an `inactivity` event. Detection is Rust-owned because the WebView can't see input outside its own (usually hidden) window.
- **Plugin registration**: store, shell, http (with `unsafe-headers`), deep-link, updater, process, log

Communication between Rust and React uses Tauri events (`sync-data`, `tray-stop-timer`, `tray-continue-last`, `tray-open-settings`, `tray-open-finalize`, `inactivity`) and Tauri commands (`invoke`).

### 2. React Frontend (`src/`)

Single-page app rendered in a Tauri webview window (450x700, resizable, overlay title bar).

```
src/
  App.tsx              — Root: auth gate → LoginScreen or AuthenticatedApp
  main.tsx             — React root + AppProvider
  api/                 — API abstraction (provider pattern, auth, types)
  components/          — UI components (all .tsx)
  hooks/               — useTimer custom hook
  store/               — Context + useReducer state management
  utils/               — flex calc, week helpers, holiday set
  styles/index.css     — Tailwind CSS theme (custom colors)
```

### 3. API Abstraction (`src/api/`)

`ApiProvider` interface with two implementations:

| Implementation | File | Purpose |
|---|---|---|
| `AgileDayProvider` | `agileday.ts` | Real REST client with Bearer JWT, token refresh, HTTPS enforcement |
| `MockProvider` | `mock-core.ts` | In-memory storage with seeded data, injectable `EntryStore` (tests only) |

Provider is created in `context.tsx` based on auth state. If authenticated, `createAgileDayProvider()` is used. Otherwise `null` (login screen shown).

`global-tasks.ts` sits alongside them as a helper rather than a provider:
`createGlobalDefaultTaskLoader` discovers the tenant's "(global default)" tasks
and is memoised **per provider instance**, so the page-the-whole-catalogue cost
is paid once per session and only on first use. It resolves to `[]` on any
failure, which is what keeps `getTasks` degrading to the project's own tasks
instead of breaking when an undocumented endpoint changes.

## State Management

Uses React Context + `useReducer` (no external state library).

**Context** (`src/store/context.tsx`): `AppProvider` wraps the app. Exposes `{ state, dispatch, api, isConnected, isAuthLoading, logout, onLogin }`.

**Reducer** (`src/store/reducer.ts`): Pure function, 20 action types. State shape:

```typescript
interface AppState {
  employee: Employee | null;
  projects: Project[];
  myProjectIds: string[];           // allocated projects
  projectOpeningMap: Record<string, string>;
  tasks: Task[];
  taskBillableById: Record<string, boolean>;
  entries: TimeEntry[];             // last 30 days + 30 days ahead
  allocations: Allocation[];
  allocationsFetchedAt: number | null;
  timer: TimerState;                // isRunning, projectId, taskId, startTime
  flexConfig: FlexConfig | null;
  flexEntries: TimeEntry[] | null;  // entries before the 30-day window (for flex calc)
  holidays: Holiday[];
  displayPrefs: DisplayPrefs;       // menuBarMode, theme, inactivity settings
  inactivity: InactivityState;      // idleSeconds, isAway, pendingReturn (Discard/Keep)
  loading: boolean;
  error: string | null;
}
```

**Inactivity slice**: Rust emits `inactivity` ({ idle_seconds, is_away }) on each change of away-state or idle-minute; `useInactivitySync` dispatches `SET_INACTIVITY`. The reducer raises a `pendingReturn` (frozen away duration) on the away→active transition — the `InactivityBanner` then shows a persistent Discard/Keep prompt and `useTimer.stop` is blocked until it's resolved (`RESOLVE_RETURN`). Discard shifts the timer's `startTime` forward by the away duration.

**Persistence** (via Tauri store plugin):
- `timer-store.ts` — running timer survives app quit/crash
- `unsaved-store.ts` — entries whose save failed (`syncStatus: "unsaved"`) survive sync and restart; `SET_ENTRIES` keeps them over the fetched copy until the card's Retry succeeds or Discard drops them
- `flex-store.ts` — flex config (startDate + initialHours)
- Auth tokens stored in Tauri store (see auth section)

## Data Loading

On auth, `context.tsx` loads data in this order:

1. `getCurrentEmployee()` — user identity
2. `getProjects()` + `getMyProjects()` — in parallel, enriches projects with type from allocations
3. `getTimeEntries()` — last 30 days + 30 days ahead (local dates, not UTC)
4. Background: flex config → holidays → extended entries (if flex start is older than 30 days)
5. Background: task billable flags for all projects with entries

Sync can be re-triggered via tray menu (Cmd+R) or the `sync-data` event, which increments `syncCounter` and re-runs the data load effect.

## Timer Flow

Timer is card-level — each project card (1:1 with an AgileDay entry) has its own play/stop button. Only Today's cards show timer controls.

1. User clicks play on a project card → `startForCard(projectId, taskId)`
2. Any running timer is stopped first (single-timer invariant)
3. `dispatch SET_TIMER { projectId, taskId, isRunning: true, startTime: now() }`
4. `useTimer` hook calculates elapsed from `now() - startTime` every second (no drift)
5. Tray menu shows elapsed time via `set_timer_status` Tauri command
6. Stop → capture timer state, `dispatch RESET_TIMER`, compute total minutes (entry + session)
7. `api.createTimeEntry()` — sends full state (total minutes + description) to AgileDay
8. On success: mark `synced`. On failure: mark `unsaved`, show error banner.

Timer state no longer includes `description` — descriptions live on entries and are edited inline on cards.

## Entry Layout

The UI uses a **card-per-project-per-day** layout that maps 1:1 to AgileDay's data model. Each card represents one AgileDay entry with:
- Project name + task tag in header
- Billable indicator (display-only)
- Elapsed time + play/stop (Today's cards only)
- Stacked description lines with connector rail (inline-editable)

New cards are created via the floating + button (FAB), which opens a project/task picker dialog.

## Sync Model

**App is source of truth when saving.** The app always sends the full entry state to AgileDay — total minutes and complete description string. No merging, no diffing, no consolidation. `createTimeEntry` checks if an entry already exists for the same (project, task, date); if so, it PATCHes with the app's state; otherwise, it POSTs a new one.

**AgileDay is source of truth when loading.** On startup/sync, entries are fetched and rendered as-is. The card layout maps 1:1 to AgileDay entries.

**One entry per (project, task, date).** Enforced by the FAB (checks before creating) and the provider (PATCHes existing instead of creating duplicates).

## Window Behavior

- Window close hides the window (doesn't quit). Quit only via tray menu.
- When window is visible: app appears in Dock and Cmd+Tab.
- When hidden: app disappears from Dock (ActivationPolicy toggle in Rust).
- Title bar uses macOS overlay style with custom drag region.

## Telemetry (PostHog)

`src/posthog.ts` initialises `posthog-js` and exports `posthogClient` and `posthogLogger`. Both are `undefined` when telemetry is off, so call sites use optional chaining (`posthogClient?.capture(...)`).

**When it runs.** Only when `VITE_POSTHOG_KEY` and `VITE_POSTHOG_HOST` are present at build time. Release builds get them from the GitHub repo variables `POSTHOG_KEY` / `POSTHOG_HOST`. Tests never send. Dev builds send only with `VITE_POSTHOG_ENABLE_IN_DEV=true` in `.env` (see `.env.example`).

**What is sent.**
- Product events: `timer_started`, `time_entry_saved`, `time_entry_updated`, `time_entry_deleted`, `timesheet_submitted`, `timesheet_rounded`, `clickup_connected`. Properties are counts and flags — never descriptions, project or customer names.
- Unhandled errors and promise rejections (`$exception`), scrubbed — see below.
- Logs: `agileday_api_request_failed` / `agileday_api_network_error` from `request()` in `src/api/agileday.ts`, with method, status and duration (no URL).
- Unhandled errors are scrubbed by `scrubExceptionEvent` (`src/utils/telemetry-scrub.ts`, wired as `before_send`): the message is cut at the first `": "` and URLs/emails are redacted, because AgileDay errors embed the request URL (employee ID) and response body.
- **Anonymous by design.** No `identify()`, `person_profiles: "never"`, `$geoip_disable: true`. Each install keeps a random PostHog ID so unique-user counts work, but nothing links it to a person. Never add employee ID, email, name, descriptions, project or customer names to events.
- Every event carries `app_version` (registered from Tauri `getVersion()`).

**What is off.** Autocapture, session replay, heatmaps, dead clicks, surveys, product tours. `disable_external_dependency_loading` is on and the exception/logs extensions are bundled from `posthog-js/dist/*`, so the webview never loads remote scripts. CSP allows `connect-src https://*.posthog.com` only.

**Not covered.** Rust panics in the Tauri shell are not reported.
