# Implementation Plan: Inline Card Editing (time, project/task, delete)

## Approach

Today the only way to edit an entry's duration, project, or to delete it is to
click the small time counter in the card header, which opens `EntryEditModal`.
Description editing is already inline. This feature brings **time**,
**project + task**, and **delete** editing directly onto the card so the modal
is no longer the primary path. We reuse the data plumbing that already exists:
`api.updateTimeEntry` already PATCHes `projectId`/`taskId`/`minutes`, and
`api.deleteTimeEntry` + the `DELETE_ENTRY` reducer action already work — they're
just currently buried in `EntryEditModal`. So this is mostly a UI/UX change on
`ProjectCard.tsx` plus a few small pure helpers that we can unit-test.

The three interactions:

1. **Inline time edit** — the time counter becomes click-to-edit (an inline
   `H:MM` input) instead of opening the modal. Committing PATCHes `minutes`.
   While the card's timer is **running**, committing a new total sets the banked
   `entry.minutes` to the entered value and resets the timer's `startTime` to
   "now", so the clock jumps to the entered total and keeps counting. While
   **stopped**, it simply edits `entry.minutes`.
2. **Inline project + task change** — the project name and task tag in the
   header become clickable on non-submitted cards, swapping to the compact
   `chip` variant of `ProjectPicker`/`TaskPicker` already built for this. Changing
   the project clears the task (task belongs to a project) and updates
   `openingId`. Committing PATCHes the entry. Disabled while that card's timer
   runs and on submitted cards. **Collisions are prevented at the source**: the
   task picker hides any task that already has an entry for that same
   (project, date), so it's impossible to pick a combination that would
   duplicate an existing entry — no error/block needed.
3. **Delete** — a trash icon on non-submitted cards opens an inline
   confirmation row (Cancel / Delete) rendered inside the card (no JS
   `confirm()` dialog — those are forbidden in this Tauri/WebView app). Confirm
   calls `api.deleteTimeEntry` + dispatches `DELETE_ENTRY`. Local-only entries
   (never synced) are removed without an API call.

Because the project's test harness has **no React Testing Library / jsdom**
(all tests are pure-function tests, e.g. `description-helpers.test.ts` imports
helpers straight from `ProjectCard.tsx`), all new logic that needs testing is
extracted into pure, exported helper functions in a new `entry-edit.ts` module
and unit-tested there. The wiring in `ProjectCard.tsx` is verified manually.

## File Changes

### New Files
| File | Purpose |
|------|---------|
| `src/components/entry-edit.ts` | Pure helpers: `parseDurationInput`, `formatDurationInput`, `computeRunningTimeEdit`, `isLocalOnlyEntry`, and `usedTaskIds` (task ids already in use for a project+date, used to filter the picker). Exported so they're unit-testable without rendering. |
| `src/api/__tests__/entry-edit.test.ts` | Unit tests for the helpers above. |

### Modified Files
| File | Changes |
|------|---------|
| `src/components/ProjectCard.tsx` | Replace "click time → modal" with inline time editing; make project/task clickable → inline pickers; add trash icon + inline delete-confirm row. Wire helpers + reducer/API calls. |
| `src/components/EntryEditModal.tsx` | **Delete** — fully replaced by inline editing. Start/end-time editing (only ever exposed here, currently unused) goes away with it. Remove the import + `showEditModal` usage from `ProjectCard`. |
| `src/components/TaskPicker.tsx` | Accept an optional `hiddenTaskIds`/`excludeIds` set so the inline card picker can hide already-used tasks. (FAB usage passes nothing → unchanged.) |
| `.claude/docs/ui-components.md` | Update the `ProjectCard` and `EntryEditModal` rows to describe inline editing + delete. Update the "Patterns" bullets. |

## Data Model

No new persistent types. One small in-component UI-state type to track which
field is being edited:

```typescript
// local to ProjectCard
type CardEdit =
  | { kind: "none" }
  | { kind: "time" }
  | { kind: "project" }
  | { kind: "task" }
  | { kind: "confirmDelete" };
```

Pure helper signatures (in `entry-edit.ts`):

```typescript
/** Parse "1:30" / "1:30:00" / "90" (minutes) → total minutes, or null if invalid. */
export function parseDurationInput(raw: string): number | null;

/** Format minutes → "H:MM" for the inline input's initial value. */
export function formatDurationInput(minutes: number): string;

/**
 * Given the entry's banked minutes, the live elapsed seconds, and the newly
 * entered total minutes, compute the new banked minutes and whether the timer
 * start should be reset to now. While running: bankedMinutes = entered,
 * resetStart = true (clock jumps to entered, keeps counting).
 */
export function computeRunningTimeEdit(enteredMinutes: number): {
  bankedMinutes: number;
  resetStart: boolean;
};

/** True if the entry exists only locally (never persisted to AgileDay). */
export function isLocalOnlyEntry(entry: TimeEntry): boolean;

/**
 * Task ids already in use for a given (projectId, date), excluding the card
 * being edited (selfId). Used to filter the inline task picker so a colliding
 * (project, task, date) combination can never be selected.
 */
export function usedTaskIds(
  entries: TimeEntry[],
  selfId: string,
  projectId: string,
  date: string
): Set<string>;
```

## Tasks

Test-first. Helper logic is locked in by unit tests before the component wiring
(which is verified manually, since there's no component-render harness).

- [x] 1. **Test** duration parse/format round-trips and edge cases
  - Files: `src/api/__tests__/entry-edit.test.ts`
  - Details: `parseDurationInput("1:30")===90`, `"90"===90`, `"1:30:00"===90`,
    invalid (`"abc"`, `""`, negative) → `null`; `formatDurationInput(90)==="1:30"`.
- [x] 2. **Implement** `parseDurationInput` + `formatDurationInput`
  - Files: `src/components/entry-edit.ts`
  - Depends on: 1
- [x] 3. [P] **Test** `computeRunningTimeEdit` and `isLocalOnlyEntry`
  - Files: `src/api/__tests__/entry-edit.test.ts`
  - Details: running edit returns `{bankedMinutes: entered, resetStart: true}`;
    `isLocalOnlyEntry` true for never-synced entries (no AgileDay id / synthetic id).
- [x] 4. [P] **Implement** `computeRunningTimeEdit` + `isLocalOnlyEntry`
  - Files: `src/components/entry-edit.ts`
  - Depends on: 3
- [x] 5. [P] **Test** `usedTaskIds`
  - Files: `src/api/__tests__/entry-edit.test.ts`
  - Details: collects task ids for a (project, date), excludes self, ignores
    other projects/dates, returns empty set when none.
- [x] 6. [P] **Implement** `usedTaskIds`
  - Files: `src/components/entry-edit.ts`
  - Depends on: 5
- [x] 7. **Implement** inline time editing in `ProjectCard`
  - Files: `src/components/ProjectCard.tsx`
  - Details: time span → input on click (editable cards only). On commit:
    stopped → PATCH `minutes` via `createTimeEntry`/`updateTimeEntry` + `UPDATE_ENTRY`;
    running → apply `computeRunningTimeEdit`, dispatch `UPDATE_ENTRY` (minutes) +
    `SET_TIMER` (reset startTime), then persist. Esc cancels, Enter/blur commits.
  - Depends on: 2, 4
- [x] 8. **Implement** inline project + task change in `ProjectCard`
  - Files: `src/components/ProjectCard.tsx`, `src/components/TaskPicker.tsx`
  - Details: project name + task tag clickable on non-submitted cards → `chip`
    pickers. Changing project clears task + updates `openingId`. Pass
    `usedTaskIds(...)` to the task picker so colliding combos can't be picked.
    PATCH via `updateTimeEntry` + `UPDATE_ENTRY`. Disabled while this card's timer runs.
  - Depends on: 6
- [x] 9. **Implement** delete icon + inline confirm in `ProjectCard`
  - Files: `src/components/ProjectCard.tsx`
  - Details: trash icon on non-submitted cards → inline "Delete this entry?
    Cancel / Delete" row. Confirm: local-only → `DELETE_ENTRY` only; synced →
    `api.deleteTimeEntry` + `DELETE_ENTRY`. If this card's timer runs, stop it
    first. Show error inline on failure.
  - Depends on: 4
- [x] 10. **Delete** `EntryEditModal`
  - Files: `src/components/ProjectCard.tsx`, `src/components/EntryEditModal.tsx`
  - Details: remove the click-time→modal path + `showEditModal` state + import;
    delete `EntryEditModal.tsx`. Start/end-time editing is dropped with it.
  - Depends on: 7, 8, 9
- [x] 11. **Docs** update `ui-components.md`
  - Files: `.claude/docs/ui-components.md`
  - Depends on: 10
- [x] 12. Run `npm run check` (typecheck → lint → format → test) and fix fallout
  - Depends on: 11

## Test Plan

| Scenario | Type | File | Task # |
|----------|------|------|--------|
| Duration parse/format round-trips & invalid input | unit | `entry-edit.test.ts` | 1 |
| Running-time edit math (banked + reset flag) | unit | `entry-edit.test.ts` | 3 |
| Local-only entry detection | unit | `entry-edit.test.ts` | 3 |
| Already-used task ids for picker filter | unit | `entry-edit.test.ts` | 5 |
| Inline time edit (running + stopped) | manual | — | 7 |
| Inline project/task change + collision guard | manual | — | 8 |
| Delete confirm (local-only + synced + running) | manual | — | 9 |

## Risks & Edge Cases

- **Edit time while running** — the trickiest UX. Decided semantics ("Set &
  keep counting"): entered value becomes the new total and the clock keeps
  counting from there (`computeRunningTimeEdit` → set banked minutes, reset startTime).
- **Project/task change collision** — prevented at the source by filtering the
  task picker with `usedTaskIds`, so a colliding (project, task, date) can't be
  chosen. No block/merge logic needed.
- **Project/task change while running** — timer state references projectId/taskId.
  Mitigation: disable project/task editing while that card's timer runs.
- **No JS dialogs** — `confirm()`/`alert()` freeze the WebView (per repo rules).
  Delete confirmation must be in-DOM (inline row), not a native dialog.
- **Local-only entries** — entries created by the FAB but never synced have a
  client UUID; deleting must skip the API call. `isLocalOnlyEntry` handles this.
- **Changing project should reset task** — a task belongs to a project; an
  orphaned taskId from the old project would be invalid.
- **Submitted/approved cards** stay fully read-only — no time/project/task/delete
  affordances appear (`isEditable` already gates this).

## Acceptance Verification

| # | Criterion | Task | Verification |
|---|-----------|------|-------------|
| AC-1 | Time editable inline when stopped | 7 | Click time on a past editable card, change to 2:00, confirm it PATCHes |
| AC-2 | Time editable inline while running | 7 | Edit running clock; it jumps to entered total and keeps counting |
| AC-3 | Project changeable in card (non-submitted) | 8 | Click project name, pick another, task resets, entry updates |
| AC-4 | Task changeable in card (non-submitted) | 8 | Click task tag, pick another (used tasks hidden), entry updates |
| AC-5 | Delete icon present with warning | 9 | Trash icon → inline confirm → entry removed |
| AC-6 | Submitted cards remain read-only | 7,8,9 | Submitted card shows none of the new affordances |
