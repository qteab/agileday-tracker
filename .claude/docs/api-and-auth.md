# API & Authentication

## AgileDay REST API

All requests require `Origin: https://qvik.agileday.io` header (Tauri HTTP plugin with `unsafe-headers` feature). Base URL: `https://api.agileday.io`.

### Endpoints Used

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/v1/time_entry/employee/id/{id}/updated` | Read entries (all statuses, includes descriptions) |
| GET | `/v1/timesheets/{id}/summary` | Fallback entry read (all statuses, no descriptions) |
| POST | `/v1/time_entry/employee/id/{id}` | Create time entry |
| PATCH | `/v1/time_entry/{id}` | Update time entry |
| DELETE | `/v1/time_entry/{id}` | Delete time entry |
| GET | `/v1/project?projectStage=ACTIVE` | List active projects |
| GET | `/v1/absence` | List absence projects (vacation, sick leave, etc.) — a separate entity, NOT returned by `/v1/project` |
| GET | `/v2/opening` | Allocated projects (with employee filter); also surfaces ABSENCE-typed projectlikes as a fallback |
| GET | `/v1/project/id/{id}/task` | Tasks for a project |
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
1. Query `/updated` for existing entry matching (projectId, taskId, date, EDITABLE status)
2. If match found → PATCH with app's full state (minutes, description)
3. If no match → POST new entry

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
  getTasks(projectId: string): Promise<Task[]>;
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
