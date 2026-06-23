# Implementation Plan: Absence Projects Visibility

## Approach

The user can't see certain "projects" — absence reporting (vacation, sick
leave, parental leave, etc.). The root cause is that **these are not regular
projects** and never enter the app's project list.

The app builds its project list from one source:

- `getProjects()` → `GET /v1/project?projectStage=ACTIVE` — returns only
  regular projects (with a customer).

It then enriches that list with `projectType` from `getMyProjects()`
(`GET /v2/opening`), and the project picker shows, by default, only projects
the user is allocated to (`state.myProjectIds`), with non-allocated projects
appearing only when searching.

AgileDay models absence as a **separate entity** exposed at its own endpoint,
`GET /v1/absence` (tag "Projects:Absence Projects" in `openapi.yaml`). Absence
projects are *used like* projects for time entry (`taskId` + `projectId` on a
time entry), but they are **not returned by `/v1/project`**. So they never land
in `state.projects`, and even if a user were allocated to one via an opening,
the picker's `state.projects.filter(p => myProjectIds.includes(p.id))` would
drop it because there is no matching project object.

The fix: add a `getAbsenceProjects()` method to the `ApiProvider`, fetch it
alongside the regular project list on connect, merge absence projects into
`state.projects` tagged `projectType: "ABSENCE"`, and surface them in the
project picker as their own always-visible group (not gated behind allocation,
since absence is company-wide and rarely allocated). Tasks for an absence
project are fetched with the existing `getTasks(projectId)` since absence
projects expose tasks the same way.

**Why this approach over alternatives:**

- *Backfilling from openings only* (constructing project entries from
  `projectlikeName` for allocated projectlikes not in `state.projects`) would
  only surface absence projects the user is *allocated* to. Absence reporting
  is typically company-wide and not allocated, so this would miss most cases.
- *Removing the `projectStage=ACTIVE` filter* does not help — absence is a
  different entity, not a project in a different stage.

The dedicated `/v1/absence` endpoint is the only source that reliably returns
all absence projects regardless of allocation.

> **Open question (verify during implementation):** whether `/v1/absence`
> requires a specific scope on the OAuth token, and the exact field shape of
> the entries (the spec shows `id`, `name`, `customer`, `duration`). If the
> live token can't read `/v1/absence`, fall back to the openings backfill.

## File Changes

### New Files
| File | Purpose |
|------|---------|
| (none) | Reuses existing files; no new modules needed |

### Modified Files
| File | Changes |
|------|---------|
| `src/api/provider.ts` | Add `getAbsenceProjects(): Promise<Project[]>` to the `ApiProvider` interface |
| `src/api/agileday.ts` | Implement `getAbsenceProjects()` calling `GET /v1/absence`, mapping to `Project` with `projectType: "ABSENCE"` and a stable color |
| `src/api/mock-core.ts` | Implement `getAbsenceProjects()` returning a seeded absence project (e.g. "Vacation", "Sick leave") |
| `src/store/context.tsx` | Fetch absence projects in `useConnectedDataLoad`, merge into the projects list (dedupe by id, absence entries keep `projectType: "ABSENCE"`) |
| `src/components/ProjectPicker.tsx` | Render an always-visible "Absence" group (projects with `projectType === "ABSENCE"`), both in the default view and in search results |
| `src/api/__tests__/mock-provider.test.ts` | Add contract tests for `getAbsenceProjects()` |
| `src/api/__tests__/agileday-provider.test.ts` | Add tests for the `/v1/absence` fetch + mapping |
| `.claude/docs/api-and-auth.md` | Document the `/v1/absence` endpoint and `getAbsenceProjects()` |
| `.claude/docs/domain.md` | Clarify that absence projects come from `/v1/absence`, not `/v1/project` |
| `.claude/docs/ui-components.md` | Note the Absence group in `ProjectPicker` |

## Data Model

No new types required — absence projects reuse the existing `Project` type:

```ts
// A Project with projectType === "ABSENCE", sourced from /v1/absence
{
  id: string;            // absence id
  name: string;          // e.g. "Vacation", "Sick leave"
  customerName?: string; // absence.customer?.name (usually undefined)
  color: string;         // assigned from PROJECT_COLORS
  projectType: "ABSENCE";
}
```

`ApiProvider` gains:

```ts
getAbsenceProjects(): Promise<Project[]>;
```

## Tasks

Test-first (TDD). Mark parallelizable groups with [P].

- [x] 1. **Test** — mock provider exposes `getAbsenceProjects()` returning
      seeded absence projects, each with `projectType: "ABSENCE"`.
  - Files: `src/api/__tests__/mock-provider.test.ts`
  - Details: locks in the contract that absence projects are distinct from
    `getProjects()` results and tagged ABSENCE.
- [x] 2. **Implement** — add `getAbsenceProjects()` to `ApiProvider` and the
      mock implementation with seeded data.
  - Files: `src/api/provider.ts`, `src/api/mock-core.ts`
  - Depends on: 1
- [x] 3. [P] **Test** — `agileday` provider calls `GET /v1/absence` and maps
      `id`/`name`/`customer` to `Project` with `projectType: "ABSENCE"` and a
      color; returns `[]` on failure.
  - Files: `src/api/__tests__/agileday-provider.test.ts`
- [x] 4. [P] **Implement** — `getAbsenceProjects()` in `agileday.ts`.
  - Files: `src/api/agileday.ts`
  - Depends on: 3
- [x] 5. **Implement** — fetch absence projects in `useConnectedDataLoad`
      (add to the `Promise.all`), merge into the projects payload, dedupe by
      id, keep `projectType: "ABSENCE"`. Do **not** add them to
      `myProjectIds` (they are surfaced by type, not allocation).
  - Files: `src/store/context.tsx`
  - Depends on: 2, 4
- [x] 6. **Implement** — `ProjectPicker` renders an "Absence" group from
      `state.projects.filter(p => p.projectType === "ABSENCE")`, always
      visible in the default (non-search) view and included in search results.
  - Files: `src/components/ProjectPicker.tsx`
  - Depends on: 5
- [x] 7. **Verify + docs** — run `npm run check`; update `.claude/docs/`
      (api-and-auth, domain, ui-components).
  - Files: `.claude/docs/*`
  - Depends on: 6

## Test Plan

| Scenario | Type | File | Task # |
|----------|------|------|--------|
| Mock `getAbsenceProjects()` returns ABSENCE-typed projects | unit | `mock-provider.test.ts` | 1 |
| Absence projects are not in `getProjects()` output | unit | `mock-provider.test.ts` | 1 |
| `getAbsenceProjects()` calls `/v1/absence` and maps fields | unit | `agileday-provider.test.ts` | 3 |
| `getAbsenceProjects()` returns `[]` when the endpoint errors | unit | `agileday-provider.test.ts` | 3 |

## Risks & Edge Cases

- **`/v1/absence` may be unauthorized for the user's token scope.** Mitigation:
  `getAbsenceProjects()` catches errors and returns `[]` (same pattern as other
  fetches), so the app degrades gracefully. Verify against the live API early.
- **ID collision** between an absence project and a regular project. Mitigation:
  dedupe by id on merge; if a regular project and an absence share an id, prefer
  the absence tag so it's grouped correctly (unlikely — they're different
  entities).
- **Absence projects might already be in `/v1/project`** in some tenants. The
  merge dedupes by id, so no duplicates; the ABSENCE type just gets applied.
- **Tasks for absence projects**: assumed reachable via the existing
  `GET /v1/project/id/{id}/task`. Verify; if absence uses a different task
  endpoint, `getTasks` needs a branch. (Spec says absence projects are
  "regular projects," so this should hold.)
- **Picker UX**: absence is a third group alongside "My projects" / "Other
  projects". Keep it compact and clearly labeled so it doesn't crowd the
  default view.

## Acceptance Verification

| # | Criterion | Task | Verification |
|---|-----------|------|-------------|
| AC-1 | Absence projects appear in the project picker without searching | 6 | Open picker, see "Absence" group with vacation/sick leave |
| AC-2 | User can start a timer / log time against an absence project | 5,6 | Select absence project + task, start timer, stop, entry saves |
| AC-3 | App still works if `/v1/absence` is unavailable | 4 | Mock endpoint failure → no crash, regular projects unaffected |
| AC-4 | No duplicate projects when absence overlaps `/v1/project` | 5 | Merge dedupes by id |
