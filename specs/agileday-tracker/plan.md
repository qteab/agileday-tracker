# Implementation Plan: QTE Time Tracker (AgileDay Menu Bar App)

## Approach

Build a macOS menu bar app using **Tauri v2** with a **React + TypeScript** frontend. The app lives in the system tray and opens a popover window styled after Toggl's layout — a timer input at top, start/stop button, and a time entry list grouped by day with expandable sessions.

Since we don't have AgileDay API access yet, the first version uses an **API abstraction layer** with a **mock/local provider** that stores data in the app's local storage. The interface mirrors AgileDay's data model (projects, tasks, time entries) so swapping in the real API later is a one-file change. This means **no backend is needed** — AgileDay will be the database once connected, and local storage serves as the stand-in for now.

The UI follows QTE's brand: purple primary (#7A59FC), dark purple accents (#5519D5), light backgrounds (#FAF5F5), with the purple teddy bear logo in the menu bar tray.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Shell | Tauri v2 (Rust) — system tray, popover window |
| Frontend | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS 4 |
| State | React Context + useReducer (lightweight, no Redux) |
| Storage | Tauri's `@tauri-apps/plugin-store` (JSON file on disk) |
| API layer | TypeScript interface with mock + AgileDay implementations (OpenAPI spec included) |

## No Backend Needed

AgileDay is the database. The app is a thin client:
- **Auth**: OAuth 2.1 PKCE handled by Tauri's HTTP client (when API access is available)
- **Data**: Projects/tasks fetched from AgileDay, time entries POSTed to AgileDay
- **Offline/Mock**: Local JSON store via Tauri's store plugin — same interface, swappable provider
- **No server, no database, no deployment** — just a `.dmg` you install

## Brand / Design

| Token | Value | Usage |
|-------|-------|-------|
| `--color-primary` | `#7A59FC` | Buttons, active states, play icon |
| `--color-primary-dark` | `#5519D5` | Hover states, gradients |
| `--color-primary-light` | `#AEA7FF` | Tags, project dots |
| `--color-bg-light` | `#FAF5F5` | Main background |
| `--color-bg-dark` | `#170E23` | Dark mode (future) |
| `--color-text` | `#241143` | Primary text |
| `--color-text-muted` | `#5F5273` | Secondary text |
| Logo | Purple teddy bear | Tray icon + header |

## File Structure

```
agileday-tracker/
├── src-tauri/                  # Rust / Tauri config
│   ├── Cargo.toml
│   ├── tauri.conf.json         # Window config, tray, permissions
│   ├── src/
│   │   └── lib.rs              # Tray setup, popover window
│   └── icons/                  # App icons (from teddy bear logo)
├── src/                        # React frontend
│   ├── main.tsx                # Entry point
│   ├── App.tsx                 # Root component
│   ├── components/
│   │   ├── Timer.tsx           # "What are you working on?" + timer + play/stop
│   │   ├── ProjectPicker.tsx   # Dropdown to select AgileDay project
│   │   ├── TaskPicker.tsx      # Dropdown to select task within project
│   │   ├── TimeEntryList.tsx   # Grouped-by-day list of entries
│   │   ├── DayGroup.tsx        # Collapsible day row (date + total)
│   │   └── TimeEntry.tsx       # Single session row
│   ├── api/
│   │   ├── types.ts            # Project, Task, TimeEntry interfaces
│   │   ├── provider.ts         # ApiProvider interface
│   │   ├── mock.ts             # Mock implementation (local storage)
│   │   ├── agileday.ts         # Real AgileDay API client (Phase 4)
│   │   └── auth.ts             # OAuth 2.1 PKCE flow (Phase 4)
│   ├── store/
│   │   ├── context.tsx         # React context for app state
│   │   └── reducer.ts          # State reducer (entries, timer, projects)
│   ├── hooks/
│   │   └── useTimer.ts         # Timer logic (start, stop, tick)
│   └── styles/
│       └── index.css           # Tailwind + QTE brand tokens
├── index.html
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── vite.config.ts
```

## Data Model

Types are modeled to match AgileDay's API schema so the mock↔real swap is seamless.
See `specs/agileday-tracker/openapi.yaml` for the full OpenAPI spec.

```typescript
// Matches AgileDay ProjectResponse (subset we need)
interface Project {
  id: string;              // UUID from AgileDay
  name: string;
  customerName?: string;   // from AgileDay's customer.name
  color: string;           // local-only — AgileDay doesn't return colors
}

// Matches AgileDay TaskResponse (subset we need)
interface Task {
  id: string;              // UUID
  projectId: string;
  name: string;
  billable: boolean;
  active: boolean;
}

// Matches AgileDay timeEntryResponse + local timer fields
interface TimeEntry {
  id: string;              // UUID
  description: string;
  projectId: string;
  projectName?: string;    // denormalized for display
  taskId?: string;
  date: string;            // YYYY-MM-DD (AgileDay format)
  startTime: string;       // ISO timestamp (local-only, for timer)
  endTime?: string;        // ISO timestamp (null = running)
  minutes: number;         // AgileDay stores duration in minutes
  status: 'NEW' | 'SAVED' | 'CHANGE_REQUESTED' | 'SUBMITTED' | 'APPROVED';
  syncStatus: 'synced' | 'unsaved' | 'pending'; // local-only: tracks API save state
}

// Mirrors the employee info we need from GET /v1/employee/id/{id}
interface Employee {
  id: string;              // UUID — needed for all time entry API calls
  name: string;
  email: string;
}

interface ApiProvider {
  // Auth
  getCurrentEmployee(): Promise<Employee>;

  // Projects & tasks
  getProjects(): Promise<Project[]>;
  getTasks(projectId: string): Promise<Task[]>;

  // Time entries — AgileDay scopes these by employee ID
  getTimeEntries(employeeId: string, startDate: string, endDate: string): Promise<TimeEntry[]>;
  createTimeEntry(employeeId: string, entry: Omit<TimeEntry, 'id'>): Promise<TimeEntry>;
  updateTimeEntry(employeeId: string, id: string, updates: Partial<TimeEntry>): Promise<TimeEntry>;
  deleteTimeEntry(ids: string[]): Promise<void>;
}
```

### AgileDay API Mapping

| App Operation | AgileDay Endpoint | Notes |
|--------------|-------------------|-------|
| Get current user | `GET /v1/employee` | Filter by auth token's identity |
| List projects | `GET /v1/project?projectStage=ACTIVE` | Only show active projects |
| List tasks | `GET /v1/project/id/{id}/task` | Tasks per project |
| Get entries | `GET /v1/time_entry/employee/id/{id}?startDate=X&endDate=Y` | Date-range query |
| Create entry | `POST /v1/time_entry/employee/id/{id}` | Body: array of `timeEntryPostRequest` |
| Update entry | `PATCH /v1/time_entry/employee/id/{id}` | Body: array of `timeEntryPatchRequest` |
| Delete entry | `DELETE /v1/time_entry?ids=X` | Supports batch delete |

**Auth:** Bearer JWT token in `Authorization` header. Token obtained via OAuth 2.1 PKCE flow.
**Base URL:** Tenant-specific, e.g. `https://{tenant}.agileday.io/api`

## Tasks

### Phase 0: Project Setup

- [ ] 1. **Install Rust toolchain**
  - Run `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
  - Prerequisite for everything else

- [ ] 2. **Scaffold Tauri v2 + React + TypeScript project**
  - Run `npm create tauri-app@latest` in the qte folder
  - Select: React, TypeScript, Vite
  - Name: `agileday-tracker`

- [ ] 3. **Initialize git repo**
  - `git init`, initial commit, `.gitignore`

- [ ] 4. **Configure Tauri for menu bar app**
  - Set up system tray with icon
  - Configure popover window (no dock icon, no title bar)
  - Set window size ~400x600 (like Toggl)
  - Files: `src-tauri/tauri.conf.json`, `src-tauri/src/lib.rs`

- [ ] 5. **Set up Tailwind + QTE brand tokens**
  - Install Tailwind CSS 4
  - Define color tokens from QTE brand
  - Files: `tailwind.config.ts`, `src/styles/index.css`

### Phase 1: Core Data Layer

- [ ] 6. **Define TypeScript types and API interface**
  - Files: `src/api/types.ts`, `src/api/provider.ts`

- [ ] 7. **Build mock API provider with local storage**
  - Seed with sample projects (Fokus, DHL-PIL, maverick, KBV, QTE-möten)
  - CRUD operations backed by Tauri store plugin
  - Files: `src/api/mock.ts`

- [ ] 8. **Create app state context and reducer**
  - State: entries, projects, tasks, active timer, selected project
  - Files: `src/store/context.tsx`, `src/store/reducer.ts`

### Phase 2: UI Components

- [ ] 9. **Timer component**
  - "What are you working on?" text input
  - Running timer display (0:00:00)
  - Play/stop button (purple)
  - Files: `src/components/Timer.tsx`, `src/hooks/useTimer.ts`

- [ ] 10. **Project picker dropdown**
  - Select from available projects
  - Colored dot per project
  - Files: `src/components/ProjectPicker.tsx`

- [ ] 11. **Task picker dropdown**
  - Select task within chosen project (optional)
  - Files: `src/components/TaskPicker.tsx`

- [ ] 12. **Time entry list with day grouping**
  - Group entries by date
  - Day header: "Mon, 20 Apr" + total time
  - Collapsed by default, expandable to show individual sessions
  - Files: `src/components/TimeEntryList.tsx`, `src/components/DayGroup.tsx`, `src/components/TimeEntry.tsx`

- [ ] 13. **Wire up App.tsx — full layout**
  - Compose all components into the Toggl-like layout
  - Files: `src/App.tsx`, `src/main.tsx`

### Phase 3: Polish

- [ ] 14. **App icon from teddy bear logo**
  - Generate tray icon (template image for macOS) and app icon
  - Files: `src-tauri/icons/`

- [ ] 15. **Edit/delete time entries**
  - Click entry to edit description/project/duration
  - Delete option
  - Inline editing or small modal

- [ ] 16. **Persist timer state across app restarts**
  - Save running timer to Tauri store, restore on launch

### Phase 4: AgileDay API Client (ready to activate when token is available)

- [ ] 17. **Build AgileDay API client implementing ApiProvider**
  - Uses the OpenAPI spec (`specs/agileday-tracker/openapi.yaml`) as reference
  - Bearer JWT auth, tenant-specific base URL
  - Maps AgileDay response schemas to our app types
  - Files: `src/api/agileday.ts`

- [ ] 18. **Add settings view for API connection**
  - Input for tenant URL and Bearer token (manual paste for now)
  - Toggle between mock and live API
  - Files: `src/components/Settings.tsx`

- [ ] 19. **OAuth 2.1 PKCE flow (when client credentials available)**
  - Register app in AgileDay admin → get client_id
  - Tauri HTTP client handles the PKCE redirect
  - Store/refresh tokens via Tauri secure store
  - Files: `src/api/auth.ts`

### Phase 5: Release & Distribution

Two options depending on how seriously we want to distribute.

#### Option A: Lightweight (free, internal/team use)

- [ ] 20. **GitHub Actions CI — build on tag**
  - Workflow triggers on `v*` tags
  - Builds macOS `.dmg` (aarch64 + x86_64 universal binary)
  - Uploads artifacts to GitHub Release automatically
  - Files: `.github/workflows/release.yml`

- [ ] 21. **Tauri updater plugin — auto-update from GitHub Releases**
  - Install `@tauri-apps/plugin-updater`
  - Configure update endpoint pointing to GitHub Releases
  - App checks for updates on launch, prompts user to install
  - Users download DMG once, self-updates after that
  - Files: `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src/components/UpdateChecker.tsx`

- [ ] 22. **Versioning strategy**
  - Semver: `MAJOR.MINOR.PATCH`
  - Bump version in `package.json` + `src-tauri/tauri.conf.json` + `src-tauri/Cargo.toml`
  - Tag with `git tag v0.2.0` → push → CI builds and publishes
  - Changelog in GitHub Release notes

- [ ] 23. **README with install instructions**
  - Download link to latest GitHub Release
  - "Right-click → Open" workaround for unsigned app
  - Files: `README.md`

**Trade-offs:** No code signing — users get "unidentified developer" warning on first open. Fine for internal/team use where you can tell people to right-click → Open.

#### Option B: Production (paid, company-wide distribution)

Everything in Option A, plus:

- [ ] 24. **Apple Developer Program ($99/year)**
  - Enroll at developer.apple.com
  - Get Developer ID certificate for code signing
  - Get notarization credentials

- [ ] 25. **Code signing in CI**
  - Store signing certificate + notarization credentials in GitHub Secrets
  - CI signs the `.app` and `.dmg` with Developer ID
  - CI submits to Apple for notarization (staples the ticket)
  - No "unidentified developer" warning — clean install experience
  - Files: `.github/workflows/release.yml` (update signing config)

- [ ] 26. **Homebrew Cask (optional)**
  - Create a Homebrew tap repo (`homebrew-qte`)
  - Users install with `brew install --cask qte/qte/time-tracker`
  - Auto-updated via Homebrew
  - Files: separate repo `qte/homebrew-qte`

**Trade-offs:** $99/year for Apple Developer, CI secrets management for signing certs, notarization adds ~2min to CI builds.

### Future (not in v1)

- Dark mode
- Keyboard shortcuts
- Weekly summary view
- Export/submit timesheets

## Risks & Edge Cases

- **Rust installation**: User needs to install Rust first — one-time setup, well-documented
- **Tauri v2 tray API**: Tray + popover is supported but the API has changed between betas — pin to stable release
- **Timer accuracy**: Use `setInterval` with timestamp comparison, not pure interval counting, to avoid drift
- **Large entry lists**: Virtualize the list if performance becomes an issue (unlikely for personal use)
- **No API access yet**: The mock provider must mirror AgileDay's data model closely enough that swapping is trivial — the `ApiProvider` interface is the contract

## Acceptance Verification

| # | Criterion | Task | Verification |
|---|-----------|------|-------------|
| AC-1 | App appears in macOS menu bar with QTE icon | 4, 14 | Click icon → popover opens |
| AC-2 | Can start/stop a timer with description | 9 | Type description, click play, see timer counting, click stop |
| AC-3 | Can select project from dropdown | 10 | Open picker, see mock projects with colored dots |
| AC-4 | Time entries grouped by day | 12 | Multiple entries on same day collapse under day header |
| AC-5 | Day groups show total time and are expandable | 12 | Click day → see individual sessions |
| AC-6 | Data persists across app restarts | 7, 16 | Quit and reopen → entries still there |
| AC-7 | API layer is swappable | 6, 7 | `ApiProvider` interface exists, mock implements it, future agileday.ts can replace it |
