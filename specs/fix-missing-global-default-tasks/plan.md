# Implementation Plan: Surface "global default" tasks in the task picker

## Diagnosis — CONFIRMED against the live API

Probed the real AgileDay API from inside the app (temporary `diag_log` Tauri
command + throwaway probe module, both reverted). Results are facts, not guesses.

### The task is genuinely not on the endpoint we call

```
200 GET /v1/project/id/17d6cb54…/task                        →  []
200 GET /v1/project/id/17d6cb54…/task?includeInactive=true   →  []
200 GET /v2/task?filter={"projectId":{"in":["17d6cb54…"]}}   →  0 results
```

The KBV project (`17d6cb54-e371-4055-8a4e-2363eac66869`) has **zero own tasks**.
Our `getTasks` is not mis-filtering — the response is an empty array. The earlier
`active`-filter hypothesis (RC-A) is **disproven**; RC-B is what's happening.

### Where the task actually lives

An undocumented **`/v2/task`** endpoint (absent from `specs/agileday-tracker/openapi.yaml`)
exposes the whole tenant task catalogue: `{ data: [...], pagination: {...} }`,
`totalItems: 1519`.

Within it, exactly **15 tasks have `projectId: null`** — these are tenant-level
*templates*. Project-owned tasks point at them via `parentTaskId`. Of those 15,
exactly **one** has `defaultTemplate: true`:

```
27717b20-864c-408b-89c4-6d0d9806e165 | Development | projectId=null
                                     | defaultTemplate=true | active=false | billable=true
```

That is a one-to-one match with the web UI, which offers precisely one option for
this project: **"Development (global default)"**. So the rule the web client
follows is: *project's own tasks, plus the global `defaultTemplate` task(s).*

Note `active: false` on that template. **The web UI shows it anyway**, so the
global-default path must not apply an `active` filter — applying our normal
`filter((t) => t.active)` to it would drop it again.

### Blast radius — systemic, not a one-off

Walked all 495 active projects and counted own tasks:

```
projects with ZERO own tasks = 75 / 495   (15%)
```

Every one of those 75 is currently **untrackable in the app**: no task → no
`taskId` → *Start tracking* permanently disabled. Includes Reaktor DVV,
Terveystalo, OP Financial Group, Strivo, SOK, Mehiläinen, KBV, and 68 more.

### Why the app shows nothing at all rather than an error

Three layers each drop it silently:

| Layer | Code | Behaviour |
|---|---|---|
| Provider | `src/api/agileday.ts:225` | `tasks.filter((t) => t.active)` over an already-empty array |
| Picker | `src/components/TaskPicker.tsx:53` | `if (!projectId \|\| state.tasks.length === 0) return null;` — renders *nothing* |
| FAB | `src/components/Fab.tsx:89` | `disabled={!projectId \|\| !taskId}` — dead button |

`TaskPicker`'s fetch (`TaskPicker.tsx:31`) also has **no `.catch`**, so a 4xx is
indistinguishable from an empty project.

### API capabilities found (constrain the design)

| Probe | Result |
|---|---|
| `GET /v2/task/id/{id}` | **200** — single task fetch by id works |
| `GET /v2/task/{id}` | 404 — needs the `/id/` segment |
| `filter={"projectId":{"in":[…]}}` | **works** (verified: KBV → 0) |
| `filter={"defaultTemplate":{"eq":true}}` | **ignored** — returns an unfiltered page |
| `filter={"projectId":{"is":null}}` / `{"in":[null]}` | **ignored** — unfiltered |
| `?defaultTemplate=true`, `?parentTaskId=null` | **ignored** — unfiltered |
| `sortBy=projectId` / `sortBy=defaultTemplate` | **ignored** — order unchanged |
| `/v1/task`, `/v2/task_template`, `/v2/default_task` | 404 |
| `/v2/project/id/{id}/task` | 404 |

**There is no server-side filter for the global defaults.** Discovering them
means paging the full catalogue (1519 items ÷ 200 = 8 requests) and filtering
client-side on `projectId === null && defaultTemplate === true`. That cost is why
the design below discovers once and caches, rather than fetching per project.

## Approach

`getTasks(projectId)` returns the project's own tasks **plus** the tenant's
global default templates, matching what the web UI offers.

Three decisions worth stating:

**1. Discover the templates once per session.** Paging 8 requests is far too slow
to repeat per project selection, so: a memoised promise inside the provider,
started on the first `getTasks` call and reused thereafter. One burst per app run.

Because decision 2 appends globals to *every* project, that burst fires on the
app's first task lookup — in practice during `hydrateTaskMetadataForEntries`
(`src/store/context.tsx:633`) at load, not on a task-less project specifically.
It is therefore one fixed cost per session, not an avoidable one, and it must not
block the picker: own tasks render as soon as they arrive, globals join when
discovery resolves.

**2. Append the defaults always, not only when the project has none.** The
web UI's "(global default)" *suffix* exists to distinguish them from project
tasks in a mixed list — that only makes sense if both can appear together. Also,
appending unconditionally avoids a confusing rule where the option appears and
disappears based on project configuration.

**3. Do not apply the `active` filter to global defaults.** The one real template
has `active: false` and the web UI still offers it. `active` is meaningful for
project-owned tasks and is filtered there as today.

Also fixed, because the invisibility is a defect in its own right: `TaskPicker`
gets a `.catch` and renders a disabled "No tasks available" / "Couldn't load
tasks" state instead of `null`. A project the user cannot track must *say why*.

Not in scope: relaxing "task required to start a timer" (a deliberate product
decision, CLAUDE.md *Key decisions*), and adding `/v2/task` write support.

## Open question — the write path

**Unverified: whether `POST /v1/time_entry/employee/id/{id}` accepts a `taskId`
that is a global template rather than a task owned by the project.**

I did not test this, because it means writing a real entry to your live
timesheet. The web UI offering the option is strong evidence it is accepted, but
it is evidence, not proof. If AgileDay rejects it, the picker will show
*Development* and the save will fail with `syncStatus: "unsaved"` — visible, but
a bad experience.

Two ways to close it, your call:
- I create a 1-minute entry on KBV against the template, confirm the response, then delete it.
- You try it manually in the app once the fix is in.

Task 7 below is that verification; the rest of the plan does not depend on it.

## File Changes

### New Files
| File | Purpose |
|------|---------|
| `src/api/global-tasks.ts` | Paged `/v2/task` crawl + memoised global-default cache |
| `src/api/__tests__/global-tasks.test.ts` | Paging, filtering, memoisation, failure fallback |
| `src/components/__tests__/TaskPicker.test.tsx` | Empty/error-state rendering |

### Modified Files
| File | Changes |
|------|---------|
| `src/api/agileday.ts` | `getTasks` merges project tasks + global defaults; `defaultTemplate` carried through |
| `src/api/types.ts` | `Task` gains `defaultTemplate?: boolean` |
| `src/api/mock-core.ts` | Mock a global default task so the contract suite covers it |
| `src/components/TaskPicker.tsx` | `.catch`; disabled empty/error state; label global defaults |
| `src/api/__tests__/agileday-provider.test.ts` | `getTasks` merge cases |
| `.claude/docs/api-and-auth.md` | Document `/v2/task`, the template model, and the merge rule |
| `.claude/docs/ui-components.md` | Document `TaskPicker` empty/error states |
| `.claude/docs/domain.md` | Define *task template* and *global default task* |

## Data Model

```typescript
// src/api/types.ts
export interface Task {
  id: string;
  projectId: string;   // global defaults are surfaced under the requesting project's id
  name: string;
  billable: boolean;
  active: boolean;
  defaultTemplate?: boolean;  // true => tenant-level "(global default)"
}
```

`/v2/task` row shape (observed, trimmed):

```jsonc
{
  "id": "27717b20-…", "name": "Development", "projectId": null,
  "active": false, "billable": true, "defaultTemplate": true,
  "parentTaskId": null, "order": null, "description": "",
  "_permissions": { "canManage": false }
}
```

Envelope: `{ "data": [...], "pagination": { "page", "pageSize", "totalItems", "totalPages", "hasNext", "hasPrevious" } }`

## Tasks

- [x] 1. **Test** — global-default discovery: pages until `hasNext` is false, keeps only `projectId === null && defaultTemplate === true`, memoises across calls, returns `[]` (never throws) if `/v2/task` fails
  - Files: `src/api/__tests__/global-tasks.test.ts`
  - Details: mocked fetch returning two pages; assert exactly one request burst for two callers.

- [x] 2. **Implement** — `src/api/global-tasks.ts`
  - Files: `src/api/global-tasks.ts`
  - Details: `fetchGlobalDefaultTasks(apiFetch)` — page 1 with `limit=200`, read `pagination.totalPages`, fetch remaining pages **in parallel**, keep `projectId === null && defaultTemplate === true`, map to `Task`. Memoise the promise (created on first call, not at module load); on rejection clear the memo so a later attempt can retry. Degrade to `[]` — never throw.
  - Depends on: 1

- [x] 3. **Test** — `getTasks` merges own tasks with global defaults
  - Files: `src/api/__tests__/agileday-provider.test.ts`
  - Details: (a) project with 0 own tasks → returns the global default, `defaultTemplate: true`, `projectId` set to the requested project; (b) project with 2 own tasks → returns 3, defaults last; (c) an own task with `active: false` is still dropped; (d) a global default with `active: false` is **kept**; (e) `/v2/task` failing leaves own tasks intact.
  - Depends on: 2

- [x] 4. **Implement** — merge in `getTasks`
  - Files: `src/api/agileday.ts`, `src/api/types.ts`
  - Details: keep the existing `filter((t) => t.active)` for project-owned tasks; append globals (no `active` filter), rewriting `projectId` to the requested id so `Task.projectId` stays a `string`; dedupe by id, own tasks winning. Await own tasks and globals concurrently so discovery never delays the project's own list beyond its own latency.
  - Depends on: 3

- [x] 5. [P] **Test** — `TaskPicker` empty and error states
  - Files: `src/components/__tests__/TaskPicker.test.tsx`
  - Details: `[]` → disabled control reading "No tasks available"; rejecting provider → "Couldn't load tasks", no unhandled rejection; `projectId === null` → still renders nothing.

- [x] 6. [P] **Implement** — `TaskPicker` states + global-default label
  - Files: `src/components/TaskPicker.tsx`
  - Details: local `status` state (`loading`/`ready`/`error`); `.catch`; replace the `length === 0 → null` branch; append a muted "(global default)" hint on rows where `defaultTemplate` is true, mirroring the web UI.
  - Depends on: 5

- [x] 7. **Verify the write path** — confirm AgileDay accepts a global-template `taskId` on a real entry — **confirmed 2026-08-20: accepted**
  - Details: **resolved to a manual check by the user, folded into task 10** — no API probe, so no throwaway entry is written by an agent. If AgileDay rejects the id, replan — likely by POSTing the template into the project first (`POST /v1/project/id/{id}/task` exists in the openapi) and using the resulting project-owned task id. That writes project configuration and needs its own approval.
  - Depends on: 4

- [x] 8. **Mock parity** — mock provider serves a global default so the contract suite covers the new shape
  - Files: `src/api/mock-core.ts`
  - Depends on: 4

- [x] 9. **Docs** — `/v2/task`, template model, merge rule, picker states, glossary terms
  - Files: `.claude/docs/api-and-auth.md`, `.claude/docs/ui-components.md`, `.claude/docs/domain.md`
  - Depends on: 4, 6

- [x] 10. **Verify in the app** (user) — **done 2026-08-20: picker, FAB and save all confirmed working** — KBV shows *Development (global default)*, *Start tracking* enables (AC-17), timer stop settles at `syncStatus: "synced"` (AC-18)
  - Details: the only step left. Everything above is done and `npm run check` is green (255 tests). Run `npm run tauri dev`, open the KBV *Ny frontend - Q3* project, and walk the three checks in order — the task appearing at all proves the read path, the FAB enabling proves AC-17, a synced entry proves AC-18.
  - Depends on: 4, 6

## Test Plan

| Scenario | Type | File | Task # |
|----------|------|------|--------|
| Pages `/v2/task` until `hasNext` false | unit | `global-tasks.test.ts` | 1 |
| Keeps only `projectId===null && defaultTemplate` | unit | `global-tasks.test.ts` | 1 |
| Memoised — two callers, one burst | unit | `global-tasks.test.ts` | 1 |
| `/v2/task` failure → `[]`, no throw | unit | `global-tasks.test.ts` | 1 |
| 0 own tasks → global default returned | unit | `agileday-provider.test.ts` | 3 |
| 2 own tasks → 3 returned, defaults last | unit | `agileday-provider.test.ts` | 3 |
| Own task `active:false` dropped | unit | `agileday-provider.test.ts` | 3 |
| Global default `active:false` **kept** | unit | `agileday-provider.test.ts` | 3 |
| `/v2/task` down → own tasks unaffected | unit | `agileday-provider.test.ts` | 3 |
| Picker: "No tasks available" | unit | `TaskPicker.test.tsx` | 5 |
| Picker: "Couldn't load tasks" | unit | `TaskPicker.test.tsx` | 5 |
| Picker: nothing when no project selected | unit | `TaskPicker.test.tsx` | 5 |

## Risks & Edge Cases

- **Write path unverified** — see *Open question*. The one real unknown left.
- **8 requests to discover 1 task** is a poor ratio forced on us by `/v2/task`
  having no usable filter (all filter forms probed and ignored). Mitigated by
  lazy + memoised + parallel pages. If AgileDay later supports
  `filter={"defaultTemplate":{"eq":true}}`, this collapses to one request.
- **`/v2/task` is undocumented** in our bundled openapi, so it carries no
  stability guarantee. The `[]` fallback means a breaking change degrades to
  today's behaviour rather than a crash.
- **`projectId` rewriting** makes a global template look project-owned inside
  the app. Acceptable — `projectId` is only used for scoping — and
  `defaultTemplate` preserves the real provenance for the UI label.
- **314 tasks carry `defaultTemplate: true` but have a `projectId`.** Those are
  project-owned instances, *not* global defaults; the filter deliberately
  requires `projectId === null`. Filtering on `defaultTemplate` alone would
  wrongly pull in hundreds of other projects' tasks.
- **`TaskPicker` has no existing tests** — task 5 is the first, so an RTL setup
  check may be needed.

## Acceptance Verification

Criteria are defined in `spec.md`. Every AC maps to a task and a check.

| # (spec.md) | Criterion | Task | Verification |
|---|---|---|---|
| AC-1 | Task-less project offers the global default | 4 | Test 3(a) + task 10 |
| AC-2 | Own tasks plus globals, globals last | 4 | Test 3(b) |
| AC-3 | Only `projectId===null && defaultTemplate` count as global | 2 | Test 1 |
| AC-4 | Own task `active:false` still excluded | 4 | Test 3(c) |
| AC-5 | Global default `active:false` included | 4 | Test 3(d) |
| AC-6 | Globals carry `defaultTemplate` + rewritten `projectId` | 4 | Test 3(a) |
| AC-7 | No duplicate task ids | 4 | Test 3(b) |
| AC-8 | Pages with `limit=200`, rest in parallel | 2 | Test 1 |
| AC-9 | At most one discovery burst per session | 2 | Test 1 (memoisation) |
| AC-10 | Deferred to first use, not construction | 2, 4 | Test 1 (no call until invoked) |
| AC-11 | `/v2/task` failure → `[]`, own tasks intact | 2 | Tests 1, 3(e) |
| AC-12 | A failed discovery may retry | 2 | Test 1 |
| AC-13 | "(global default)" hint on those rows | 6 | Test 5 |
| AC-14 | Empty list → disabled "No tasks available" | 6 | Test 5 |
| AC-15 | Fetch rejection → disabled "Couldn't load tasks" | 6 | Test 5 |
| AC-16 | No project selected → renders nothing | 6 | Test 5 |
| AC-17 | Selecting a global default enables *Start tracking* | 4, 6 | Task 10 |
| AC-18 | Entry against a global default reaches AgileDay | 7 | Task 7 — **blocked, see spec.md unknown** |
