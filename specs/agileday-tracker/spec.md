# QTE Time Tracker — AgileDay Menu Bar App

> A lightweight macOS menu bar time tracker that syncs to AgileDay, giving QTE employees a fast Toggl-like experience for logging hours against AgileDay projects.

## Status

- [x] Spec complete
- [x] Plan complete
- [ ] Implementation complete
- [ ] Reviewed

## User Stories

1. **As a QTE employee**, I want to start/stop a timer from my menu bar so that I can log time without opening the AgileDay web UI.
2. **As a QTE employee**, I want to select a project (and optionally a task) before starting a timer so that my time is attributed correctly.
3. **As a QTE employee**, I want to see my time entries grouped by day so that I can review what I worked on.
4. **As a QTE employee**, I want to expand a day to see individual sessions so that I can verify each entry.
5. **As a QTE employee**, I want to edit or delete a time entry so that I can correct mistakes.
6. **As a QTE employee**, I want my data to persist across app restarts so that I don't lose my history.
7. **As a QTE employee**, I want to connect the app to AgileDay with my credentials so that my time entries sync to the company system.
8. **As a QTE employee**, I want to be confident my credentials and company data are handled securely.

## Acceptance Criteria

### Timer & Core Flow
- [ ] AC-1: App icon appears in macOS menu bar; clicking it opens a popover window (~400×600px)
- [ ] AC-2: App does NOT appear in the Dock (menu bar only)
- [ ] AC-3: Popover shows a "What are you working on?" text input, timer display (0:00:00), and play button
- [ ] AC-4: Clicking play starts the timer; the button changes to a stop button; timer counts up in real time
- [ ] AC-5: Clicking stop saves the session as a time entry with description, project, date, and duration in minutes — when connected to AgileDay, this immediately POSTs to the API
- [ ] AC-5a: Edits immediately PATCH to AgileDay; deletes immediately DELETE — no batch sync, no "sync" button
- [ ] AC-5b: If an API call fails, the entry is kept in the UI marked as "unsaved" with a visible retry button
- [ ] AC-5c: Unsaved entries are persisted locally so they survive app restarts — user can manually retry
- [ ] AC-6: Multiple sessions in one day are saved as separate entries

### Project & Task Selection
- [ ] AC-7: A project picker dropdown lists available projects with colored dots
- [ ] AC-8: Selecting a project optionally shows a task picker for that project's tasks
- [ ] AC-9: Project selection is required before starting a timer
- [ ] AC-10: In mock mode, projects are seeded with sample data (Fokus, DHL-PIL, maverick, KBV, QTE-möten)

### Time Entry List
- [ ] AC-11: Below the timer, a scrollable list shows time entries grouped by day
- [ ] AC-12: Each day group header shows the date (e.g. "Mon, 20 Apr") and total time for that day
- [ ] AC-13: Day groups are collapsed by default; clicking expands to show individual sessions
- [ ] AC-14: Each session row shows: description, project name with colored dot, and duration
- [ ] AC-15: Clicking an entry allows editing description, project, and duration
- [ ] AC-16: Entries can be deleted

### Persistence
- [ ] AC-17: Time entries persist across app quit and relaunch (Tauri store plugin)
- [ ] AC-18: A running timer persists across restarts — on relaunch, the timer resumes from where it left off

### Security
- [ ] AC-19: No credentials, tokens, or API keys are stored in plain text — use macOS Keychain via Tauri's secure store
- [ ] AC-20: OAuth tokens are stored encrypted, refreshed on expiry, and fully cleared on logout
- [ ] AC-21: No hardcoded credentials, API keys, or tenant URLs in source code — all configured at runtime
- [ ] AC-22: All API communication is HTTPS only — reject HTTP
- [ ] AC-23: No sensitive data (tokens, employee details, project financials) in logs or error messages
- [ ] AC-24: OAuth uses PKCE flow (no implicit grant) — prevents token interception
- [ ] AC-25: On logout, all auth state, cached data, and tokens are wiped from local storage and keychain
- [ ] AC-26: The app requests only the minimum API scopes needed for time tracking

### API Abstraction
- [ ] AC-27: An `ApiProvider` interface defines all data operations (CRUD for entries, list projects/tasks, get current employee)
- [ ] AC-28: A mock provider implements `ApiProvider` using local storage — fully functional without AgileDay access
- [ ] AC-29: An AgileDay provider implements `ApiProvider` using the real REST API (see `openapi.yaml`)
- [ ] AC-30: Switching from mock to AgileDay requires only changing the provider — no UI or state changes

### API Provider Tests
- [ ] AC-38: Every `ApiProvider` method has unit tests covering success and error cases
- [ ] AC-39: Mock provider tests verify CRUD operations return correct data and mutate state correctly
- [ ] AC-40: Tests verify that `getProjects` only returns projects, not other entity types
- [ ] AC-41: Tests verify that `getTimeEntries` filters strictly by date range — no entries outside the range are returned
- [ ] AC-42: Tests verify that `createTimeEntry` requires all mandatory fields (date, minutes, projectId, status) and rejects incomplete input
- [ ] AC-43: Tests verify that `updateTimeEntry` only modifies the specified entry and no others
- [ ] AC-44: Tests verify that `deleteTimeEntry` only removes the specified IDs and no others
- [ ] AC-45: Tests verify that `getTasks` only returns tasks for the requested project, not other projects
- [ ] AC-46: Tests verify that no provider method exposes or leaks data from other employees
- [ ] AC-47: Tests verify error handling — failed API calls throw/reject properly and don't silently corrupt state
- [ ] AC-48: AgileDay provider tests (when built) verify that only the expected HTTP methods and paths are called — no unexpected endpoints

### AgileDay Integration (Phase 4 — when API access is available)
- [ ] AC-31: Settings view allows entering tenant URL and initiating OAuth login
- [ ] AC-32: OAuth PKCE flow redirects to AgileDay login, receives token, stores securely
- [ ] AC-33: Projects are fetched from `GET /v1/project?projectStage=ACTIVE` (no local project creation)
- [ ] AC-34: Tasks are fetched from `GET /v1/project/id/{id}/task` for the selected project
- [ ] AC-35: Time entries are created via `POST /v1/time_entry/employee/id/{id}` with `timeEntryPostRequest` body
- [ ] AC-36: Time entries are updated via `PATCH /v1/time_entry/employee/id/{id}`
- [ ] AC-37: Time entries are deleted via `DELETE /v1/time_entry?ids=X`

## Scope

### In Scope
- macOS menu bar app (system tray + popover)
- Start/stop timer with description
- Project and task selection (from AgileDay projects, not user-created)
- Time entry list grouped by day, expandable to individual sessions
- CRUD on time entries
- Mock data provider for offline/pre-API development
- AgileDay REST API client (built against OpenAPI spec, activated when token available)
- QTE brand styling (purple #7A59FC, teddy bear logo)
- Secure credential storage (macOS Keychain)
- OAuth 2.1 PKCE authentication

### Out of Scope
- Web app or mobile app
- Creating/editing projects or tasks (read-only from AgileDay)
- Timesheet submission/approval workflows
- Dark mode
- Windows/Linux support
- Billing/invoicing features
- Automatic background retry / offline sync queue (failed saves require manual retry)
- Multi-tenant support (one tenant configured at a time)

## Unknowns & Clarifications

- [DECIDED] No backend needed → AgileDay is the database, Tauri store is the local fallback
- [DECIDED] Tech stack → Tauri v2 + React + TypeScript + Tailwind
- [DECIDED] Auth → OAuth 2.1 PKCE, tokens in macOS Keychain
- [NEEDS CLARIFICATION] How does the logged-in user get their own employee ID? The API has `GET /v1/employee` but no explicit "me" endpoint. We may need to decode the JWT or match by email. Will verify once we have API access.
- [DECIDED] Project list shows all active projects (`projectStage=ACTIVE`). May revisit to filter by employee allocation once API is live.
- [NEEDS CLARIFICATION] Do AgileDay projects have colors? The API response doesn't include a color field. We'll assign colors locally (hash of project name → color from a palette).

## Non-Functional Requirements

- **Performance:** Popover opens in <200ms. Timer updates every second with no drift (timestamp-based).
- **Size:** App bundle <15MB (Tauri advantage over Electron)
- **Startup:** Launch on macOS login, no splash screen
- **Security:** See AC-19 through AC-26. All company data treated as confidential.

## Dependencies

- **APIs/services:** AgileDay REST API (Bearer JWT, tenant-specific base URL). Full spec in `openapi.yaml`.
- **Auth:** OAuth 2.1 PKCE — requires registering an OAuth client in AgileDay admin panel (one-time admin action)
- **State/data:** Tauri store plugin for local persistence. macOS Keychain for secure token storage.
- **System:** Rust toolchain (rustup), Node.js 24+, Xcode CLI tools — all except Rust already installed.

## Design References

- **Layout:** Toggl macOS menu bar app (see screenshot in plan conversation)
- **Brand:** QTE purple (#7A59FC), teddy bear logo, colors from qte.se
- **API:** `specs/agileday-tracker/openapi.yaml`
