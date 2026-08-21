# API & Authentication

## AgileDay REST API

All requests require `Origin: https://qvik.agileday.io` header (Tauri HTTP plugin with `unsafe-headers` feature). Base URL: `https://api.agileday.io`.

### Endpoints Used

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/v1/time_entry/employee/id/{id}?startDate=&endDate=` | Primary entry read, filtered by **work date** (all statuses, includes descriptions). `endDate` is **exclusive** — callers pass `endDate + 1 day` |
| GET | `/v1/time_entry/employee/id/{id}/updated` | Fallback entry read, used **only** if the primary read fails. Filters by last-update timestamp, *not* work date, so it uses a 400-day `updatedAfter` lookback |
| GET | `/v1/timesheets/{id}/summary` | Per-month top-up read (all statuses, no descriptions). Fetched for **every** month the requested window touches |
| POST | `/v1/time_entry/employee/id/{id}` | Create time entry |
| PATCH | `/v1/time_entry/{id}` | Update time entry |
| DELETE | `/v1/time_entry/{id}` | Delete time entry |
| GET | `/v1/project?projectStage=ACTIVE` | List active projects |
| GET | `/v1/absence` | List absence projects (vacation, sick leave, etc.) — a separate entity, NOT returned by `/v1/project` |
| GET | `/v2/opening` | Allocated projects (with employee filter); also surfaces ABSENCE-typed projectlikes as a fallback |
| GET | `/v1/project/id/{id}/task` | Tasks a project owns. Returns `200 []` for the ~15% of projects that own none |
| GET | `/v2/task?limit=&offset=` | **Undocumented.** Whole-tenant task catalogue, used to discover global default tasks. Envelope `{ data, pagination }` |
| GET | `/v1/holiday` | Public holidays by country |

### Request Headers

```
Authorization: Bearer <access_token>
Origin: https://qvik.agileday.io
Content-Type: application/json
```

### Sync Model

**App is source of truth when saving.** The app always sends the full entry state (total minutes + full description string) to AgileDay. No merging, no diffing — just overwrite.

**AgileDay is source of truth when loading.** On startup or sync, entries are fetched from AgileDay and rendered as-is.

**One entry per (project, task, date).** The FAB enforces this locally. The provider checks for existing entries before creating — if one exists, it PATCHes instead of POSTing.

`createTimeEntry` flow:
1. Query that single day by work date (`?startDate={date}&endDate={date+1}`) for an existing entry matching (projectId, taskId, EDITABLE status)
2. If match found → PATCH with app's full state (minutes, description)
3. If no match → POST new entry

### Reading entries: why three sources

Entries are read by **work date**, never by last-update timestamp. `updatedAfter`
on the `/updated` endpoint filters on `updatedAt`, so using it as a date-range
filter silently hides any entry written before the window start — a week of
vacation booked months in advance simply disappears, and because the cutoff
rolls forward daily, entries drop out over time rather than all at once. That
produced a phantom -40h week in the flex balance (see
`specs/fix-flex-missing-entries/plan.md`).

The read therefore layers:
1. **Primary** — date-range GET. Correct by construction.
2. **Fallback** — `/updated` with a 400-day lookback, only if the primary throws
   (an *empty* primary result is legitimate and does not trigger it).
3. **Top-up** — per-month summary for every month in the window, merged by
   `projectId::date` and adding only the deficit. This is what guarantees no
   minutes go missing if the primary read's status coverage is incomplete.

Flex depends entirely on this: `calculateFlex` never reduces *expected* hours
for absence, it counts logged absence entries as worked minutes. A week whose
entries fail to load therefore reads as five no-show days.

### Global default tasks

75 of ~495 active projects own **no tasks at all** — `/v1/project/id/{id}/task`
returns `200 []`. Since the timer refuses to start without a `taskId`, those
projects were untrackable in the app. AgileDay's own web UI covers the case by
offering a tenant-level task labelled "(global default)".

Those live in the tenant task catalogue at the undocumented **`/v2/task`**, as
rows with `projectId: null` and `defaultTemplate: true`. Both conditions matter:
314 rows carry `defaultTemplate: true` *while belonging to a project* — those are
per-project instances of a template, not global defaults, and matching on
`defaultTemplate` alone would offer hundreds of other projects' tasks everywhere.
Project-owned tasks reference their template via `parentTaskId`.

`getTasks(projectId)` therefore returns **own tasks + global defaults**, globals
last, deduped by id with the project's own copy winning. Two rules differ from
the project-owned path:

- **`active` is not applied to globals.** The one real global default is
  `active: false` and the web UI offers it regardless. Project-owned tasks are
  still filtered on `active`.
- **`projectId` is rewritten** to the requested project, so `Task.projectId`
  stays a non-null `string`. `Task.defaultTemplate` preserves the real
  provenance for the UI's "(global default)" hint.

`src/api/global-tasks.ts` does the discovery. `/v2/task` has **no usable
server-side filter** for these rows — `filter={"defaultTemplate":{"eq":true}}`,
`filter={"projectId":{"is":null}}`, `?defaultTemplate=true`, `?parentTaskId=null`
and `sortBy=` were all probed against the live API and are silently ignored,
returning an unfiltered page. Only `filter={"projectId":{"in":[…]}}` works, which
is the wrong direction. So discovery pages the whole catalogue (~1519 rows, 8
pages of 200) and filters client-side:

- page 1 first, to read `pagination.totalPages`; remaining pages in parallel
- memoised per provider instance — one burst per session, started on the first
  `getTasks` call, not at module load
- **never rejects**: any failure resolves to `[]`, leaving the caller with the
  project's own tasks. `/v2/task` is undocumented and carries no stability
  guarantee, so a breaking change there must degrade to the app's previous
  behaviour. A failed attempt clears the memo so a later call can retry.

`GET /v2/task/id/{id}` also works if a single-fetch path is ever needed
(`/v2/task/{id}` 404s — the `/id/` segment is required).

### Entry Status Flow

`NEW` → `SAVED` → `SUBMITTED` → `APPROVED` (or `CHANGE_REQUESTED` → back to `SAVED`)

Submitted/approved entries are locked — the app cannot edit them, only view.

## Authentication (OAuth 2.1 PKCE)

### Flow

1. App generates PKCE code verifier + challenge (`src/api/auth.ts`)
2. Opens browser to AgileDay authorize URL with PKCE params
3. Rust spawns localhost HTTP server on `127.0.0.1:19847`
4. User authenticates in browser → redirected to `http://127.0.0.1:19847/callback`
5. Rust captures `code` + `state` from redirect, returns to frontend
6. Frontend exchanges code for tokens via token endpoint

### Constants (hardcoded in `auth-manager.ts`)

- **Tenant**: `qvik`
- **Client ID**: hardcoded (company-wide, no secret needed for PKCE)
- **Redirect URI**: `http://127.0.0.1:19847/callback`
- **OAuth endpoints**: `https://qvik.agileday.io/auth/authorize`, `https://qvik.agileday.io/auth/token`

### Token Management

- Access token + refresh token stored in Tauri store (persists across restarts)
- Background refresh: checks every 30s, refreshes when < 1 min to expiry
- Visibility change handler: re-checks token on window focus (handles sleep/wake where setInterval pauses)
- Failed refresh: logs user out with "Session expired" message
- Token refresh uses `refreshAccessToken()` from `auth.ts`

### AuthState Shape

```typescript
interface AuthState {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;  // Date.now() + expires_in * 1000
}
```

### Provider Creation

`context.tsx` creates the provider with closures for reading/writing auth state:

```typescript
createAgileDayProvider(config, getAuth, setAuth, onAuthFailure)
```

- `getAuth`: reads current AuthState from ref (avoids stale closures)
- `setAuth`: updates React state + persists to Tauri store
- `onAuthFailure`: clears auth, shows error, forces re-login

## ApiProvider Interface

```typescript
interface ApiProvider {
  getCurrentEmployee(): Promise<Employee>;
  getProjects(): Promise<Project[]>;
  getAbsenceProjects(): Promise<Project[]>; // /v1/absence, tagged projectType: "ABSENCE"; returns [] if unauthorized
  getTasks(projectId: string): Promise<Task[]>; // project's own tasks + tenant global defaults (see above)
  getTimeEntries(employeeId: string, startDate: string, endDate: string): Promise<TimeEntry[]>;
  createTimeEntry(employeeId: string, entry: Omit<TimeEntry, "id" | "syncStatus">): Promise<TimeEntry>;
  updateTimeEntry(employeeId: string, id: string, updates: Partial<TimeEntry>): Promise<TimeEntry>;
  deleteTimeEntry(ids: string[]): Promise<void>;
  batchUpdateEntries(employeeId: string, updates: Array<{ id: string } & Partial<TimeEntry>>): Promise<TimeEntry[]>;
  getAllocations(employeeId: string): Promise<Allocation[]>;
  getMyProjects(employeeId: string): Promise<MyProjectInfo[]>;
  getHolidays(countryCode: string, startDate: string, endDate: string): Promise<Holiday[]>;
}
```

Both `AgileDayProvider` and `MockProvider` implement this interface. The mock provider uses an in-memory `EntryStore` that can be injected for testing.

### Project list assembly

`useConnectedDataLoad` (in `store/context.tsx`) builds the picker's project list from three sources via `mergeProjectSources`, deduped by id:

1. **Regular projects** — `getProjects()` (`/v1/project`), enriched with `projectType` from allocations.
2. **Absence projects** — `getAbsenceProjects()` (`/v1/absence`), tagged `projectType: "ABSENCE"`. The full absence catalogue, regardless of allocation.
3. **Fallback** — ABSENCE-typed projectlikes from `getMyProjects()` (`/v2/opening`), synthesized into `Project` entries using the opening's `name`. Covers tenants where `/v1/absence` is unauthorized for the user's token, but only for absences the user is allocated to. `MyProjectInfo` carries `name` for this purpose.

A regular project is never clobbered by an absence sharing the same id.
