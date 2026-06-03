# Implementation Plan: Connected Stack Card Layout

## Approach

The core insight of this redesign is that **the new card layout maps 1:1 to how AgileDay stores data**. AgileDay has one entry per (project, task, date) with bullet-point descriptions. The current UI shows individual "sessions" that must be merged/consolidated on save — a source of complexity and bugs. The new design eliminates this mismatch entirely: each card IS one AgileDay entry.

The redesign replaces the top-level `Timer` + per-entry `TimeEntry` rows with **ProjectCard** components that own their own timer, billable toggle, and description stack. The `useTimer` hook is refactored so that starting a card's timer stops any other running card (single-timer invariant). Descriptions become an editable array displayed as a vertical "connected stack" with add/remove affordances.

Styling shifts from the current Tailwind theme tokens to the QTE design system tokens (`qte-tokens.css`): Source Sans 3 font, `--accent` #5519D5 as primary, `--qte-sandbox` #F3E8E8 background, 12px card radius, etc. The existing dark-mode support is preserved by mapping QTE tokens to the existing CSS variable override pattern.

## File Changes

### New Files
| File | Purpose |
|------|---------|
| `src/components/ProjectCard.tsx` | Card component: header (project name, status dot, task tag, billable $, elapsed time, play/stop) + description stack with connector rail |
| `src/components/ProjectCardList.tsx` | Groups entries by date, then by (projectId, taskId) within each day. Renders day headers + cards |
| `src/components/Fab.tsx` | Floating action button (+) to add a new project card to Today |
| `src/components/NewCardDialog.tsx` | Inline card (or popover) for selecting project + task when FAB is clicked |

### Modified Files
| File | Changes |
|------|---------|
| `src/styles/index.css` | Replace theme tokens with QTE design system values; add Source Sans 3 import; update scrollbar colors |
| `src/App.tsx` | Remove `<Timer>` from layout; replace `<TimeEntryList>` with `<ProjectCardList>`; add `<Fab>` overlay; update title bar to match design (wordmark center, running total + icons right) |
| `src/hooks/useTimer.ts` | Refactor: timer now takes a target `(projectId, taskId, date)` — starting one card stops any other. Remove description from TimerState (descriptions live on the card/entry). Expose `startForCard(projectId, taskId)` and `stopCard()` |
| `src/store/reducer.ts` | Simplify `TimerState` — remove `description` field, keep `projectId`, `taskId`, `startTime`, `isRunning`. No new actions needed; existing `UPDATE_ENTRY`/`ADD_ENTRY` already support the card model |
| `src/components/DayGroup.tsx` | Rewrite: renders day header (bold 19px name + 18px total) per design spec, then a `.tt-cards` flex column of `ProjectCard`s instead of `TimeEntry` rows |
| `src/components/TabSwitcher.tsx` | Update styling to match design: `--qte-sandbox` background, `#e6dada` track, pill radius, 15px bold tabs |
| `src/components/EntryEditModal.tsx` | Keep but simplify — editing is now inline on the card for descriptions; modal only needed for duration/date overrides |
| `src/components/TimeEntryList.tsx` | Delete (replaced by `ProjectCardList`) |
| `src/components/TimeEntry.tsx` | Delete (replaced by `ProjectCard`) |
| `src/components/Timer.tsx` | Delete (timer moves into each `ProjectCard`) |
| `src/components/BillableIndicator.tsx` | Restyle to match design: 22px square, 4px radius, accent when on, `#c9bfbf` when off, clickable toggle |

### Unchanged (no modifications needed)
| File | Reason |
|------|--------|
| `src/api/agileday.ts` | Provider already handles 1:1 entry model with merged descriptions |
| `src/api/provider.ts` | Interface unchanged |
| `src/store/context.tsx` | Data loading unchanged — entries already fetched and stored flat |
| `src/components/AllocationView.tsx` | Not part of this redesign |
| `src/components/SettingsView.tsx` | Not part of this redesign |
| `src/components/FinalizeView.tsx` | Not part of this redesign |

## Data Model

The key simplification: **no new types needed**. The existing `TimeEntry` already represents one AgileDay row. The card's description stack is derived by splitting `entry.description` on `\n- ` (the bullet format AgileDay uses).

```typescript
// Derived view-model for a card (not stored — computed in component)
interface CardViewModel {
  entry: TimeEntry;                // the underlying AgileDay entry
  project: Project;                // looked up from state.projects
  task?: Task;                     // looked up from state.tasks
  descriptions: string[];          // split from entry.description
  isRunning: boolean;              // timer.projectId === entry.projectId && timer.taskId === entry.taskId && same date
  billable: boolean;               // from taskBillableById[entry.taskId]
  dotColor: 'green' | 'purple' | 'intense'; // derived from project status/type
}

// TimerState simplified — description moves out
interface TimerState {
  isRunning: boolean;
  projectId: string | null;
  taskId: string | null;
  startTime: string | null;
}
```

Description parsing (already exists in `agileday.ts`):
- `"- Line one\n- Line two"` → `["Line one", "Line two"]`
- `"Single line"` → `["Single line"]`
- `""` → `[]`

## Tasks

### Phase 1: Design system tokens & typography

- [x] 1. Update CSS theme to QTE design tokens
  - Files: `src/styles/index.css`
  - Details: Replace current Tailwind theme colors with QTE token values. Add Source Sans 3 Google Font import (or self-host). Map: `--color-primary` → `#5519D5`, `--color-bg` → `#F3E8E8` (sandbox), `--color-bg-card` → `#FFFFFF`, `--color-text` → `#0B0415` (black-orchid), `--color-text-muted` → `#4A4353`, `--color-border` → `#E5DCDC`, `--color-danger` → `#f0454b`. Add new tokens: `--color-text-subtle: #7C7585`, `--color-accent-green: #1f8a5b`, `--color-billable-off: #c9bfbf`, `--color-tab-track: #e6dada`. Update dark mode overrides accordingly.

### Phase 2: Core card component

- [x] 2. Create `ProjectCard` component
  - Files: `src/components/ProjectCard.tsx`
  - Details: The central new component. Renders: card container (white, 12px radius, 1px border, shadow-xs) → header row (project name truncated, sub-row with status dot + task tag, right side: billable toggle + elapsed time + play/stop circle button) → description stack (connector rail with 2px left border, bullet points, inline-editable text, "add description" ghost button). Props: `entry: TimeEntry`, callbacks for timer start/stop, description edit, billable toggle. Running state detected via context (timer matches this card's projectId+taskId+date).

- [x] 3. Create description stack sub-component logic
  - Files: `src/components/ProjectCard.tsx` (inline or extracted)
  - Details: Parse `entry.description` into lines. Each line is a `contentEditable` span (or controlled input). On blur → commit edit by updating the description string (re-join with `\n- ` prefix). "Add description" button appends an empty focused line. Delete empty lines on blur. Focus styling: `bg-[#faf6ff]` + `ring-2 ring-accent/25`.

### Phase 3: List restructure

- [x] 4. Create `ProjectCardList` component
  - Files: `src/components/ProjectCardList.tsx`
  - Details: Replace `TimeEntryList`. Groups `state.entries` by date (descending), renders day header per group (bold 19px day name + 18px total, tabular-nums), then maps entries within each day to `ProjectCard` components with 12px gap. Since entries are already 1:1 with AgileDay (one per project+task+date after the flatten-entries commit), no further grouping is needed within a day.

- [x] 5. Rewrite `DayGroup` or inline into `ProjectCardList`
  - Files: `src/components/DayGroup.tsx`
  - Details: Update day header styling to match design: 19px bold black-orchid day name, 18px bold total with tabular-nums. Remove the white-card wrapper (each ProjectCard is its own card now). Cards stack in a flex column with 12px gap. Day header padding: `18px 4px 10px`.

### Phase 4: Timer refactor

- [x] 6. Refactor `useTimer` hook for card-level timer
  - Files: `src/hooks/useTimer.ts`
  - Details: Remove `description` from timer state. Timer now starts/stops per card identified by `(projectId, taskId)`. `startForCard(projectId, taskId)` sets timer state and auto-stops any running timer first (saving its time). `stopCard()` saves elapsed minutes to the entry, syncs to AgileDay. The card's description is read from the entry, not the timer. Keep tray-menu integration (Continue Last, Stop).

- [x] 7. Simplify `TimerState` in reducer
  - Files: `src/store/reducer.ts`
  - Details: Remove `description` from `TimerState` interface and `initialState`. Timer description was only used to match timer→entry; now we match by `(projectId, taskId, date)` which is the AgileDay key.

### Phase 5: App layout & title bar

- [x] 8. Update `App.tsx` layout
  - Files: `src/App.tsx`
  - Details: Remove `<Timer>` component from layout (timer is card-level now). Replace `<TimeEntryList>` with `<ProjectCardList>`. Update title bar: center = "QTE TIME TRACKER" wordmark (700, 14px, tracking 0.12em, accent color); right = running total time (green, bold) + finalize icon + settings icon. Add `<Fab>` component at bottom-right. Update background to `--qte-sandbox`.

- [x] 9. Update `TabSwitcher` styling
  - Files: `src/components/TabSwitcher.tsx`
  - Details: Match design: sandbox background padding, `#e6dada` track, pill radius, 15px bold text, white active tab with shadow-sm.

### Phase 6: FAB & new card flow

- [x] 10. Create `Fab` component
  - Files: `src/components/Fab.tsx`
  - Details: Absolutely positioned bottom-right (16px offset), 52px purple circle, white + icon, shadow. On click → opens project/task selection flow (either a new card with picker inline, or a small dialog). Hover darkens to `#4512b0`, press scales 0.95.

- [x] 11. Create new-card flow
  - Files: `src/components/NewCardDialog.tsx`
  - Details: When FAB is clicked, insert a "new card" at top of Today with project picker + task picker inline. Once both are selected, create a local entry (id = UUID, minutes = 0, date = today, description = "") and optionally auto-start the timer. Reuses existing `ProjectPicker` and `TaskPicker` components.

### Phase 7: Billable toggle & inline editing

- [x] 12. Restyle `BillableIndicator` to match design
  - Files: `src/components/BillableIndicator.tsx`
  - Details: 22px square, 4px radius, "$" text, bold 14px. When `on` (task is billable): accent color. When `off`: `#c9bfbf`. Display-only — not interactive. Billable is determined by the task on the project, not togglable per entry.

- [x] 13. Wire inline description editing to API
  - Files: `src/components/ProjectCard.tsx`
  - Details: On description blur/commit: re-join description lines into AgileDay bullet format, call `api.updateTimeEntry()` to sync. Debounce or commit-on-blur to avoid excessive API calls. Handle optimistic update + error rollback.

### Phase 8: Cleanup & tests

- [x] 14. Delete replaced components
  - Files: `src/components/Timer.tsx`, `src/components/TimeEntry.tsx`, `src/components/TimeEntryList.tsx`
  - Details: Remove old entry-centric components. Update any imports that reference them.

- [x] 15. Update tests
  - Files: `src/api/__tests__/mock-provider.test.ts`
  - Details: Existing provider tests should still pass (API layer unchanged). Add tests for description parsing (split/join), card grouping logic, and timer state transitions. Verify that the timer-per-card invariant (only one running) is enforced.

- [x] 16. Update `.claude/docs/` specs
  - Files: `.claude/docs/ui-components.md`, `.claude/docs/architecture.md`
  - Details: Document the new card layout, removed components, updated timer model, and design token changes.

## Test Plan

| Scenario | Type | File | Task # |
|----------|------|------|--------|
| Description split/join preserves AgileDay format | unit | `src/api/__tests__/description.test.ts` | 15 |
| Starting card timer stops other running card | unit | `src/hooks/__tests__/useTimer.test.ts` | 15 |
| Entry grouping by date produces correct card list | unit | `src/components/__tests__/ProjectCardList.test.ts` | 15 |
| Provider contract tests still pass | unit | `src/api/__tests__/mock-provider.test.ts` | 15 |
| AgileDay provider tests still pass | unit | `src/api/__tests__/agileday-provider.test.ts` | 15 |
| Inline description edit syncs to API | integration | manual | 13 |
| FAB → new card → timer start → stop → entry saved | integration | manual | 11 |
| Billable toggle updates correctly | integration | manual | 12 |

## Risks & Edge Cases

- **Description format fragility** — AgileDay uses `- ` prefix for bullet lines. Parsing must handle: single-line (no prefix), multi-line with `- ` prefix, empty string, and descriptions that contain literal `- ` mid-sentence. The existing `mergeDescriptions` helper in `agileday.ts` already handles this; reuse it.
- **Billable is task-level, not entry-level** — The `$` indicator is display-only, showing whether the task on the project is billable. Not interactive.
- **Entries with no task** — The current model requires both project AND task. If an AgileDay entry has no task (edge case from web UI), the card still needs to render. Handle gracefully.
- **No timer on past days** — Play/stop buttons only appear on Today's cards. Past-day cards are view/edit only (descriptions, duration) if not submitted. No "continue" on past cards.
- **Submitted/locked entries** — Cards for SUBMITTED/APPROVED entries should disable editing (descriptions read-only, no play button, no billable toggle). Show lock indicator.
- **Font loading** — Source Sans 3 from Google Fonts requires network. Consider self-hosting for offline reliability, or accept the fallback to system sans-serif.

## Acceptance Verification

| # | Criterion | Task | Verification |
|---|-----------|------|-------------|
| AC-1 | Each day shows project cards (not individual entry rows) | 4, 5 | Visual: entries grouped as cards per project+task per day |
| AC-2 | Single timer across all cards — starting one stops another | 6, 7 | Start card A, start card B → A stops and saves |
| AC-3 | Description stack with connector rail, inline editing | 2, 3, 13 | Edit description in-place, blur saves to AgileDay |
| AC-4 | "Add description" appends new line to card | 3 | Click → new empty focused line appears |
| AC-5 | FAB adds new project card to Today | 10, 11 | Click + → project picker → card appears at top |
| AC-6 | Billable $ indicator on each card (display-only) | 12 | Shows accent when billable, grey when not |
| AC-7 | Title bar matches design: wordmark, running total, icons | 8 | Visual match to HTML prototype |
| AC-8 | QTE design tokens applied: colors, font, spacing | 1 | Visual match to qte-tokens.css values |
| AC-9 | Tab switcher matches design styling | 9 | Visual match |
| AC-10 | Existing 57 tests still pass | 15 | `npm run test` green |
| AC-11 | Submitted entries show as locked (no edit/timer) | 2 | Submitted cards have read-only descriptions, no play button |
| AC-12 | Past-day cards have no play/stop button | 2 | Only Today's cards show timer controls; past cards allow edit only |
