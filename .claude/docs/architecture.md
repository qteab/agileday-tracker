# Architecture

QTE Time Tracker is a macOS menu bar app for logging time to AgileDay. It uses Tauri v2 (Rust shell) with a React 19 frontend. There is no backend server — AgileDay is the database.

## Three Layers

### 1. Tauri Shell (`src-tauri/src/lib.rs`)

The Rust layer handles:

- **System tray menu**: Show, Continue, Stop, Sync (Cmd+R), New, Finalize (Cmd+F), Settings (Cmd+,), Quit
- **Window lifecycle**: show/hide toggle, Dock visibility (ActivationPolicy), window close = hide (not quit)
- **OAuth callback server**: Localhost HTTP server on `127.0.0.1:19847` captures OAuth redirect
- **Timer status**: `set_timer_status` Tauri command updates tray menu text and button states (also carries the inactivity prefs)
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
  components/          — 18 UI components (all .tsx)
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
  timer: TimerState;                // isRunning, description, projectId, taskId, startTime
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

1. User selects project + task (both required), optionally enters description
2. Start → `dispatch SET_TIMER { isRunning: true, startTime: now() }`
3. `useTimer` hook calculates elapsed from `now() - startTime` every second (no drift)
4. Tray menu shows elapsed time via `set_timer_status` Tauri command
5. Stop → capture timer state, `dispatch RESET_TIMER`, add local entry with `pending` sync status
6. `api.createTimeEntry()` — provider handles consolidation (see Entry Consolidation below)
7. On success: mark `synced`. On failure: mark `unsaved`, show error banner.

## Entry Consolidation

AgileDay stores one entry per project+task+date+description combination. The app shows individual sessions in the UI but consolidates on save:

- **0 existing matches**: create new entry
- **1 match**: PATCH — merge description, add minutes to existing total
- **Multiple matches**: create new entry with combined total, delete old duplicates

This logic lives in `agileday.ts` (`createTimeEntry` method).

## Window Behavior

- Window close hides the window (doesn't quit). Quit only via tray menu.
- When window is visible: app appears in Dock and Cmd+Tab.
- When hidden: app disappears from Dock (ActivationPolicy toggle in Rust).
- Title bar uses macOS overlay style with custom drag region.
