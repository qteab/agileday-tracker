# Implementation Plan: Simplify AgileDay Sync Model

## Approach

The current sync model treats AgileDay entries as aggregated containers that the app must query, diff, merge, and consolidate on every save. With the new card layout mapping 1:1 to AgileDay entries, this complexity is unnecessary. The new model is simple: **app is source of truth when saving** (PATCH full state), **AgileDay is source of truth when loading** (fetch and render).

The key change is replacing the 120-line `createTimeEntry` consolidation flow (query→match→branch on 0/1/N matches→merge descriptions→consolidate duplicates→verify deletions) with a two-path approach: if the entry exists on AgileDay, PATCH it with the app's current state; if not, POST it. No description merging, no duplicate consolidation, no description cache. The app always sends the full description string and total minutes — AgileDay just stores what it receives.

This also enforces a clean invariant: **one entry per (project, task, date)**. The FAB already checks for duplicates locally. The provider no longer needs to handle the multiple-match case because the app prevents it.

## File Changes

### Modified Files
| File | Changes |
|------|---------|
| `src/api/agileday.ts` | Replace `createTimeEntry` consolidation with simple POST-or-PATCH. Remove `mergeDescriptions`, `removeDescription`, `descriptionCache`. Keep `getTimeEntries` two-source merge, `updateTimeEntry`, `deleteTimeEntry`, `batchUpdateEntries` unchanged. |
| `src/api/mock-core.ts` | Remove grouping/merge logic from `createTimeEntry`. Simple create-or-update by (project, task, date). Remove `mergeDescriptions` import. |
| `src/api/provider.ts` | No interface changes needed — `createTimeEntry` signature stays the same. |
| `src/hooks/useTimer.ts` | Simplify `stop()`: send full entry state (description + total minutes) to `createTimeEntry`, not just the session delta. |
| `src/components/Fab.tsx` | Enforce one-per-day constraint: if entry exists for project+task+date, just start the timer on it instead of creating a new one. |
| `src/api/__tests__/agileday-provider.test.ts` | Remove consolidation tests (~17 tests: mergeDescriptions, removeDescription, grouping, multi-match). Update createTimeEntry tests for new simple flow. |
| `src/api/__tests__/mock-provider.test.ts` | Remove grouping tests (~10 tests: grouped create, grouped delete/edit). Update createTimeEntry tests. |
| `src/api/__tests__/entry-sync.test.ts` | Remove consolidation tests (~6 tests: multi-match, grouped delete). Update remaining tests for simplified flow. |
| `.claude/docs/api-and-auth.md` | Update sync model documentation. |
| `.claude/docs/architecture.md` | Update entry consolidation section. |

### Unchanged Files
| File | Reason |
|------|--------|
| `src/components/ProjectCard.tsx` | Already sends full description via `updateTimeEntry` — no consolidation involved |
| `src/components/ProjectCardList.tsx` | Just renders cards |
| `src/store/context.tsx` | Entry loading unchanged — `getTimeEntries` stays the same |
| `src/store/reducer.ts` | No state changes |
| `src/api/__tests__/description-helpers.test.ts` | splitDescriptions/joinDescriptions are UI utilities, unrelated to consolidation |

## Data Model

No type changes. The `ApiProvider` interface and `TimeEntry` type stay identical. The simplification is purely in the provider implementation.

**New mental model:**

```
SAVE (app → AgileDay):
  App state is truth.
  Entry exists on server? → PATCH with full state (description, minutes)
  Entry is new?           → POST with full state

LOAD (AgileDay → app):
  AgileDay is truth.
  Fetch entries → render as cards. Done.

INVARIANT:
  One entry per (project, task, date) — enforced by FAB + provider.
```

## Tasks

### Phase 1: Simplify the AgileDay provider

- [x] 1. Remove `mergeDescriptions`, `removeDescription`, and `descriptionCache` from agileday.ts
  - Files: `src/api/agileday.ts`
  - Details: Delete the two utility functions (lines 29-81), the descriptionCache map (line 137), and all references to them within the file. The description cache entries in `getTimeEntries` can also be removed — descriptions come directly from the API response.

- [x] 2. Simplify `createTimeEntry` in agileday.ts
  - Files: `src/api/agileday.ts`
  - Details: Replace the 4-branch consolidation flow with: (1) Query for existing entry matching (projectId, taskId, date, EDITABLE status). (2) If exactly one match: PATCH with full state from app (minutes = app total, description = app description). (3) If no match: POST new entry. (4) If multiple matches: still PATCH the first match with full state (ignore others — they're server-side duplicates the user can clean up). No description merging, no consolidation, no delete-old-entries.

- [x] 3. Simplify `createTimeEntry` in mock-core.ts
  - Files: `src/api/mock-core.ts`
  - Details: Remove `mergeDescriptions` import. Change createTimeEntry to: find existing by (projectId, taskId, date). If found: overwrite minutes and description with incoming values. If not: create new entry. No merging.

### Phase 2: Simplify timer stop

- [x] 4. Update `useTimer.stop()` to send full entry state
  - Files: `src/hooks/useTimer.ts`
  - Details: When stopping, compute total minutes (entry.minutes + session minutes) and send that as the entry's minutes to `createTimeEntry`. Send the entry's current description (not empty). The provider will PATCH AgileDay with this full state. No more "send only this session's minutes and let the provider add them".

### Phase 3: Enforce one-per-day constraint

- [x] 5. Update FAB to prevent duplicate entries
  - Files: `src/components/Fab.tsx`
  - Details: Already checks for existing entry. Ensure it starts the timer on the existing card instead of creating a duplicate. Add user feedback if entry already exists ("Already tracking this project today").

### Phase 4: Update tests

- [x] 6. Remove obsolete consolidation tests from agileday-provider.test.ts
  - Files: `src/api/__tests__/agileday-provider.test.ts`
  - Details: Remove: `mergeDescriptions` suite (~10 tests), `removeDescription` suite (~8 tests), multi-match consolidation tests, grouping tests. Keep: basic CRUD, auth, error handling, HTTPS enforcement tests.

- [x] 7. Update createTimeEntry tests in agileday-provider.test.ts
  - Files: `src/api/__tests__/agileday-provider.test.ts`
  - Details: Add tests for the new simple flow: (a) no match → POST, (b) one match → PATCH with full state, (c) PATCH sends app's description (overwrites, not merges), (d) error handling on PATCH failure.

- [x] 8. Remove obsolete tests from mock-provider.test.ts
  - Files: `src/api/__tests__/mock-provider.test.ts`
  - Details: Remove: grouped create tests, grouped delete/edit tests (~10 tests). Keep: basic CRUD, data isolation, error handling tests. Update createTimeEntry tests for overwrite-not-merge behavior.

- [x] 9. Remove obsolete tests from entry-sync.test.ts
  - Files: `src/api/__tests__/entry-sync.test.ts`
  - Details: Remove: multi-match consolidation tests, grouped delete tests (~6 tests). Update remaining tests for simplified flow (PATCH sends full state).

### Phase 5: Update documentation

- [x] 10. Update `.claude/docs/api-and-auth.md`
  - Files: `.claude/docs/api-and-auth.md`
  - Details: Document the new sync model: app is source of truth when saving, AgileDay is source of truth when loading. Remove references to description merging, consolidation, descriptionCache. Document one-per-day invariant.

- [x] 11. Update `.claude/docs/architecture.md`
  - Files: `.claude/docs/architecture.md`
  - Details: Rewrite "Entry Consolidation" section to describe the simplified model. Update "Timer Flow" to reflect full-state PATCH.

- [x] 12. Run full check suite and verify
  - Files: all
  - Details: `npm run check` — typecheck, lint, format, test. All must pass.

## Test Plan

| Scenario | Type | File | Task # |
|----------|------|------|--------|
| createTimeEntry: no match → POST new entry | unit | `agileday-provider.test.ts` | 7 |
| createTimeEntry: one match → PATCH with full state | unit | `agileday-provider.test.ts` | 7 |
| createTimeEntry: PATCH overwrites description (not merge) | unit | `agileday-provider.test.ts` | 7 |
| createTimeEntry: error handling on PATCH failure | unit | `agileday-provider.test.ts` | 7 |
| mock createTimeEntry: overwrite existing entry | unit | `mock-provider.test.ts` | 8 |
| FAB: prevents duplicate entry for same project+task+date | manual | - | 5 |
| Timer stop: sends full minutes total to API | manual | - | 4 |
| All existing auth/CRUD/read tests still pass | unit | all test files | 12 |
| splitDescriptions/joinDescriptions still pass | unit | `description-helpers.test.ts` | 12 |

## Risks & Edge Cases

- **Server-side duplicates**: If a user creates entries via AgileDay web for the same project+task+date, the app will match the first one and PATCH it. Other duplicates are left untouched. This is acceptable — cleaning up duplicates is the user's responsibility via AgileDay web.
- **Race conditions on save**: If two saves happen in quick succession (e.g., timer stop + description edit), the second PATCH will overwrite the first. Since the app always sends full state, the final state is correct. No data loss.
- **Entries without descriptions from API**: `getTimeEntries` already handles this via the two-source merge. Without the descriptionCache, entries that arrive without descriptions will show as empty until the next sync. This is acceptable — the user can add descriptions inline.
- **`removeDescription` removal**: This function is only called in tests (simulating old grouped-mode edits). No live code uses it. Safe to remove.
- **`batchUpdateEntries` unchanged**: Used only by FinalizeView for bulk minute adjustments. Not affected by this change.

## Acceptance Verification

| # | Criterion | Task | Verification |
|---|-----------|------|-------------|
| AC-1 | createTimeEntry does POST when no match exists | 2, 7 | Test: no-match → POST |
| AC-2 | createTimeEntry does PATCH with full state when match exists | 2, 7 | Test: one-match → PATCH with app's minutes + description |
| AC-3 | No description merging — app description overwrites server | 2, 7 | Test: PATCH body contains app's description, not merged |
| AC-4 | mergeDescriptions and removeDescription removed | 1 | Grep: no references in src/ (except tests if kept for reference) |
| AC-5 | descriptionCache removed | 1 | Grep: no references |
| AC-6 | Mock provider matches simplified behavior | 3, 8 | Test: mock overwrite-not-merge |
| AC-7 | Timer stop sends full entry state (total minutes + description) | 4 | Code review of useTimer.stop() |
| AC-8 | FAB prevents duplicate entries per (project, task, date) | 5 | Manual: try adding same project+task twice |
| AC-9 | All remaining tests pass | 12 | `npm run check` green |
| AC-10 | Docs updated to reflect simplified sync model | 10, 11 | Read .claude/docs/ |
