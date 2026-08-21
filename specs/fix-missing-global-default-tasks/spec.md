# Global default tasks in the task picker

> 75 of 495 active AgileDay projects (15%) have no tasks of their own, which makes
> them impossible to track in the app. AgileDay's web UI lets users log against a
> tenant-level "global default" task instead. This makes the app do the same.

## Status

- [x] Spec complete
- [x] Plan complete
- [x] Implementation complete — code, tests (255 passing) and docs done
- [x] Verified in the app — manual run on 2026-08-20 confirmed AC-17 and AC-18
- [ ] Reviewed

## Background

Confirmed against the live API (see `plan.md` → *Diagnosis*):

- `GET /v1/project/id/{id}/task` returns `200 []` for these projects — they
  genuinely own no tasks.
- An undocumented `GET /v2/task` exposes the whole tenant catalogue (1519 items).
  15 rows have `projectId: null` — tenant-level **task templates**. Project-owned
  tasks reference them via `parentTaskId`.
- Exactly one template has `defaultTemplate: true`:
  `27717b20-864c-408b-89c4-6d0d9806e165` — *Development*, `active: false`,
  `billable: true`. That is the single option AgileDay's web UI offers as
  "Development (global default)".
- `/v2/task` has **no** usable server-side filter for these rows. Every probed
  form (`filter={"defaultTemplate":{"eq":true}}`, `{"projectId":{"is":null}}`,
  `?defaultTemplate=true`, `?parentTaskId=null`, `sortBy=…`) is silently ignored
  and returns an unfiltered page. Only `filter={"projectId":{"in":[…]}}` works.

## Terminology

Additions to `.claude/docs/domain.md`:

| Term | Meaning |
|---|---|
| **Task template** | A tenant-level task with `projectId: null`. Not directly loggable unless it is also a global default. Project-owned tasks descend from one via `parentTaskId`. |
| **Global default task** | A task template with `defaultTemplate: true`. Offered on every project, labelled "(global default)" in AgileDay's web UI. |

Note: `defaultTemplate: true` also appears on 314 **project-owned** tasks. Those
are not global defaults — the distinguishing condition is
`projectId === null && defaultTemplate === true`.

## User Stories

1. As a consultant allocated to a project with no configured tasks, I want to
   select the global default task so that I can track time on that project at all.
2. As a consultant, I want a global default visually distinguished from a
   project's own tasks so that I know I am logging against a tenant-wide task.
3. As a consultant on a project that does have its own tasks, I want those tasks
   to keep appearing exactly as before, with the global default as an extra
   option rather than a replacement.
4. As a consultant, when a project's tasks cannot be loaded, I want the app to
   tell me so rather than silently showing no picker at all.
5. As a consultant, I want time logged against a global default task to reach
   AgileDay like any other entry.

## Acceptance Criteria

### Task list assembly

- [x] AC-1 For a project with zero own tasks, `getTasks(projectId)` returns the
      tenant's global default task(s).
- [x] AC-2 For a project with own tasks, `getTasks(projectId)` returns those
      tasks **plus** the global default(s), with globals ordered last.
- [x] AC-3 Only rows with `projectId === null && defaultTemplate === true` are
      treated as global defaults. Rows with `defaultTemplate: true` *and* a
      `projectId` are ignored.
- [x] AC-4 A project-owned task with `active: false` is returned by `getTasks`
      and filtered by the picker. **Revised during rebase:** this AC originally
      read "is still excluded", matching the `getTasks` filter that existed when
      the spec was written. `main` has since changed that contract in
      `fix(billable)` (#48) — entries logged against a later-deactivated task
      still need its billable flag, so `getTasks` keeps inactive tasks and
      `describeTaskPickerState` applies the `active` filter instead. The
      user-visible behaviour (deactivated tasks are unselectable) is unchanged.
- [x] AC-5 A global default with `active: false` is **included**. The one real
      template is `active: false` and AgileDay's web UI offers it regardless.
- [x] AC-6 Returned global defaults carry `defaultTemplate: true` and a
      `projectId` rewritten to the requested project id, so `Task.projectId`
      remains a non-null `string`.
- [x] AC-7 The merged list contains no duplicate task ids.

### Discovery of the global defaults

- [x] AC-8 Discovery pages `/v2/task` with `limit=200`, reads
      `pagination.totalPages` from the first response, and fetches the remaining
      pages in parallel.
- [x] AC-9 Discovery runs **at most once per app session**; concurrent callers
      share one in-flight request burst.
- [x] AC-10 Discovery is **deferred to first use** — no `/v2/task` request is
      issued at module load or provider construction, only on the first
      `getTasks` call. (Because AC-2 appends globals to *every* project, that
      first call is in practice the app's first task lookup, so this bounds the
      cost to one burst per session rather than avoiding it.)
- [x] AC-11 If `/v2/task` fails or returns an unexpected shape, discovery
      resolves to `[]` and never throws. `getTasks` still returns the project's
      own tasks — i.e. no regression against today's behaviour.
- [x] AC-12 After a failed discovery, a later call may retry (the memo does not
      cache the failure permanently).

### Task picker UI

- [x] AC-13 A task row whose `defaultTemplate` is true renders a muted
      "(global default)" hint after its name.
- [x] AC-14 When a project is selected and its task list is empty, the picker
      renders a **disabled** control reading "No tasks available" — not nothing.
- [x] AC-15 When the task fetch rejects, the picker renders a disabled control
      reading "Couldn't load tasks", and the rejection is handled (no unhandled
      promise rejection).
- [x] AC-16 When no project is selected, the picker renders nothing (unchanged).
- [x] AC-17 Selecting a global default enables *Start tracking* in the FAB.
      Confirmed by manual run. No code change was needed: `Fab`'s
      `disabled={!projectId || !taskId}` gate is untouched and simply starts
      passing once a `taskId` becomes selectable.

### Sync

- [x] AC-18 Stopping a timer on an entry whose `taskId` is a global default
      persists to AgileDay and the entry ends with `syncStatus: "synced"`.
      Confirmed by manual run — see *Unknowns* for why this could not be settled
      from tests alone.

## Scope

### In Scope
- `getTasks` merging project tasks with global defaults
- A new `/v2/task` discovery module with paging, memoisation, and `[]` fallback
- `Task.defaultTemplate` on the domain type
- `TaskPicker` empty state, error state, and "(global default)" labelling
- Mock provider parity so the contract suite covers the new shape
- Doc updates: `api-and-auth.md`, `ui-components.md`, `domain.md`

### Out of Scope
- Relaxing "both project and task required before starting timer" — a deliberate
  product decision (`CLAUDE.md` → *Key decisions*)
- Creating project tasks via `POST /v1/project/id/{id}/task` (only a fallback if
  AC-18 fails — see below)
- Surfacing non-default templates (the other 14 `projectId: null` rows)
- Task hierarchy / `parentTaskId` display
- Any `/v2/task` write path

## Unknowns & Clarifications

- [RESOLVED 2026-08-20] **AC-18: does `POST /v1/time_entry/employee/id/{id}`
  accept a `taskId` belonging to a global template rather than to the project?**
  **Yes.** Verified by a manual run against the live tenant: the picker offered
  the global default, *Start tracking* enabled, and stopping the timer saved
  through to AgileDay.

  This could not be settled from tests — every suite mocks `fetch`, so they only
  prove the app *sends* the template id, never that AgileDay accepts it. Hence
  the manual check rather than an API probe writing throwaway entries.

  **The fallback is therefore not needed and stays unbuilt:** had AgileDay
  rejected the id, the plan was to `POST /v1/project/id/{id}/task`, instantiating
  the template into the project on first use and logging against the resulting
  project-owned id. That writes project configuration, so it would need its own
  approval if a future API change ever forces it.

- [DECIDED] Append globals to every project, not only task-less ones → the web
  UI's "(global default)" suffix only makes sense in a mixed list, and a rule
  where the option appears and vanishes based on project config is confusing.
- [DECIDED] Do not apply the `active` filter to global defaults → the only real
  template is `active: false` and the web UI still offers it.
- [DECIDED] Discover lazily and memoise per session → 8 requests to find 1 task
  is forced by the missing server-side filter; 85% of projects never need it.
- [DECIDED] Rewrite `projectId` on returned globals to the requested project →
  keeps `Task.projectId` a non-null `string`; `defaultTemplate` preserves
  provenance for the UI.
- [DECIDED] Degrade to `[]` rather than surfacing a `/v2/task` error → the
  endpoint is undocumented, so a breaking change must not regress projects that
  work today.

## Non-Functional Requirements

- **Performance:** at most one `/v2/task` discovery burst per session — 8
  requests for ~1519 rows, page 1 first (to read `totalPages`) then the rest in
  parallel. Because globals are appended to every project (AC-2), this burst
  fires on the app's first task lookup, which today happens during
  `hydrateTaskMetadataForEntries` at load. It must not block rendering: the
  picker shows the project's own tasks as soon as they arrive and adds globals
  when discovery resolves.
- **Resilience:** `/v2/task` is undocumented and carries no stability guarantee.
  Any failure degrades to today's behaviour, never to a crash or a hang.
- **Accessibility:** the disabled empty/error control keeps the picker's existing
  `aria-haspopup`/`aria-expanded` semantics and is reachable by keyboard; the
  "(global default)" hint is plain text, not conveyed by colour alone.
- **Offline:** unchanged — no offline mode exists; a failed fetch shows AC-15's
  error state.
- **Analytics:** none (the app has no analytics).

## Dependencies

- **APIs:** new dependency on undocumented `GET /v2/task?limit=&offset=`
  (envelope `{ data, pagination }`). `GET /v2/task/id/{id}` also exists and works
  if a single-fetch path is ever needed. `specs/agileday-tracker/openapi.yaml`
  documents neither.
- **State/data:** `Task` gains optional `defaultTemplate`. `state.tasks`,
  `taskNamesById` and `taskBillableById` shapes are unchanged, so
  `hydrateTaskMetadataForEntries` (`src/store/context.tsx:633`) picks up global
  defaults for free.
- **Routing/navigation:** none.
- **UI:** `TaskPicker` only. `Fab`'s `disabled={!projectId || !taskId}` gate
  (`Fab.tsx:89`) is unchanged — it starts working because `taskId` becomes
  selectable.

## Design References

- Screenshots supplied by the user: AgileDay web UI showing
  "Development (global default)" for *Kontrollerad Bilverkstad i Sverige AB — KBV
  Ny frontend - Q3*, alongside the app's *New time entry* dialog with no task
  picker and a disabled *Start tracking*.
- Raw API evidence: `plan.md` → *Diagnosis — CONFIRMED against the live API*.
