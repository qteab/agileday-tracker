# Implementation Plan: Submission Deadline Alert

## Approach

Add a banner alert in the main window (same position as the error banner) that reminds users to submit unfinished timesheets. The alert checks all weeks with entries (not just last week) and groups multiple unsubmitted weeks into a single message. It follows the policy deadline: **Monday 12:00**.

Three escalation levels based on current time and deadline status:

1. **Info** (blue/primary): Monday 00:00–10:59 with unsubmitted entries. "Last week's timesheet hasn't been submitted. Deadline: Monday 12:00."
2. **Warning** (amber): Monday 11:00–11:59. "Deadline in less than 1 hour — submit your timesheet now."
3. **Overdue** (danger/red): After Monday 12:00 (any day) with still-unsubmitted entries. "Deadline passed — submit your timesheet ASAP."

For multiple unsubmitted weeks, the message adapts: "2 weeks have unsubmitted timesheets" or "3 weeks..." with the most urgent deadline driving the alert level. A **"Finalize"** button on the banner opens the Finalize view directly.

The alert disappears when all weeks' entries are SUBMITTED/APPROVED. It's dismissible per-session but reappears on app restart if conditions still hold. The component re-checks every minute to catch the 11:00 and 12:00 transitions.

Week utilities are extracted from `FinalizeView.tsx` into `src/utils/week.ts` so both features share the same logic.

## File Changes

### New Files
| File | Purpose |
|------|---------|
| `src/utils/week.ts` | Shared week utilities + submission checks + alert level computation |
| `src/components/SubmissionAlert.tsx` | The alert banner component |
| `src/utils/__tests__/week.test.ts` | Tests for week utilities, submission checks, and alert level |

### Modified Files
| File | Changes |
|------|---------|
| `src/components/FinalizeView.tsx` | Import week utilities from `src/utils/week.ts` instead of defining locally |
| `src/App.tsx` | Render `SubmissionAlert`, pass `onOpenFinalize` callback |

## Data Model

```typescript
// src/utils/week.ts

export function getWeekStart(ref: Date): Date;
export function fmtDate(d: Date): string;
export function formatWeekLabel(monday: Date): string;

export interface WeekRange {
  start: string; // YYYY-MM-DD (Monday)
  end: string;   // YYYY-MM-DD (Sunday)
  label: string; // e.g. "May 5 – 9"
}

/** Get all week ranges covered by the given entries, excluding the current week */
export function getPastWeekRanges(entries: TimeEntry[], now: Date): WeekRange[];

/** Check if any synced SAVED entries exist in the range */
export function hasUnsubmittedEntries(entries: TimeEntry[], range: WeekRange): boolean;

/** Get all past weeks that have unsubmitted entries */
export function getUnsubmittedWeeks(entries: TimeEntry[], now: Date): WeekRange[];

type AlertLevel = "info" | "warning" | "overdue";

/** Compute alert level based on current time:
 *  - info:    Monday 00:00–10:59
 *  - warning: Monday 11:00–11:59
 *  - overdue: Monday 12:00+ or Tue–Sun (deadline passed)
 */
export function getAlertLevel(now: Date): AlertLevel;
```

## Tasks

- [x] 1. **Test: week utility functions**
  - Files: `src/utils/__tests__/week.test.ts`
  - Details: `getWeekStart`, `fmtDate`, `getPastWeekRanges` for various dates, `hasUnsubmittedEntries` with SAVED/SUBMITTED/empty entries, `getUnsubmittedWeeks` with single and multiple unsubmitted weeks

- [x] 2. **Implement: shared week utilities**
  - Files: `src/utils/week.ts`
  - Depends on: 1

- [x] 3. **Refactor: FinalizeView to use shared utilities**
  - Files: `src/components/FinalizeView.tsx`
  - Details: Replace local `getWeekStart`, `fmtDate`, `formatWeekLabel`, `syncedOnly` with imports from `src/utils/week.ts`. Keep `computeWeekStatus` and `buildWeekSummaries` in FinalizeView (they're UI-specific).

- [x] 4. **Test: alert level computation**
  - Files: `src/utils/__tests__/week.test.ts`
  - Details: Monday 09:00 → info, Monday 11:00 → warning, Monday 12:00 → overdue, Monday 14:00 → overdue, Tuesday → overdue, Friday → overdue, Sunday 23:59 → overdue

- [x] 5. **Implement: `getAlertLevel`**
  - Files: `src/utils/week.ts`
  - Depends on: 4

- [x] 6. **Build SubmissionAlert component**
  - Files: `src/components/SubmissionAlert.tsx`
  - Details:
    - Uses `getUnsubmittedWeeks` + `getAlertLevel`
    - Three visual levels: info (primary/blue bg), warning (amber bg), overdue (danger/red bg)
    - Single week: "Last week's timesheet hasn't been submitted."
    - Multiple weeks: "N weeks have unsubmitted timesheets."
    - Deadline suffix: info → "Deadline: Monday 12:00", warning → "Less than 1 hour left", overdue → "Deadline passed — submit ASAP"
    - "Finalize" button opens finalize view
    - Dismiss X button (session-only, useState)
    - 1-minute interval to re-check alert level
    - Returns null if no unsubmitted weeks or dismissed

- [x] 7. **Wire SubmissionAlert into App.tsx**
  - Files: `src/App.tsx`
  - Details: Render after UpdateChecker, before error banner. Pass `state.entries` and `onOpenFinalize={() => setShowFinalize(true)}`.

- [x] 8. **Run full check suite**
  - Command: `npm run check`

## Test Plan

| Scenario | Type | File | Task # |
|----------|------|------|--------|
| getWeekStart for Mon/Wed/Sun | unit | `week.test.ts` | 1 |
| getPastWeekRanges excludes current week | unit | `week.test.ts` | 1 |
| hasUnsubmittedEntries with SAVED entries | unit | `week.test.ts` | 1 |
| hasUnsubmittedEntries all submitted | unit | `week.test.ts` | 1 |
| hasUnsubmittedEntries empty week | unit | `week.test.ts` | 1 |
| getUnsubmittedWeeks single week | unit | `week.test.ts` | 1 |
| getUnsubmittedWeeks multiple weeks | unit | `week.test.ts` | 1 |
| getAlertLevel Monday 09:00 → info | unit | `week.test.ts` | 4 |
| getAlertLevel Monday 11:00 → warning | unit | `week.test.ts` | 4 |
| getAlertLevel Monday 12:30 → overdue | unit | `week.test.ts` | 4 |
| getAlertLevel Tuesday → overdue | unit | `week.test.ts` | 4 |
| getAlertLevel Sunday → overdue | unit | `week.test.ts` | 4 |

## Risks & Edge Cases

- **No entries at all**: No alert — nothing to submit.
- **Multiple unsubmitted weeks**: Message groups them ("3 weeks have unsubmitted timesheets"). Alert level is always based on current time vs Monday 12:00 deadline.
- **Current week excluded**: Alert only fires for past weeks, never the current one (you can't submit a week that's still in progress).
- **Mixed week status**: A week with some SUBMITTED and some SAVED entries counts as unsubmitted.
- **Timezone**: Uses local time via `new Date()` — matches the user's wall clock.
- **Interval cleanup**: 1-minute `setInterval` must be cleared on unmount to prevent memory leaks.
- **Dismissed alert reappears on sync**: Dismissal is session-local (useState). If entries reload and the condition still holds, the dismissed state persists for the session. On app restart, it reappears.

## Acceptance Verification

| # | Criterion | Task | Verification |
|---|-----------|------|-------------|
| AC-1 | Info alert on Monday AM with unsubmitted last week | 6-7 | Blue banner with deadline text |
| AC-2 | Warning alert at Monday 11:00+ | 5-6 | Amber banner, "less than 1 hour" |
| AC-3 | Overdue alert after Monday 12:00 | 5-6 | Red banner, "deadline passed" |
| AC-4 | Multiple weeks grouped in message | 6 | "3 weeks have unsubmitted timesheets" |
| AC-5 | Alert disappears when all submitted | 6 | Sync → all SUBMITTED → banner gone |
| AC-6 | Dismiss hides alert for session | 6 | Click X → hidden until restart |
| AC-7 | Finalize button opens finalize view | 7 | Click → opens finalize view |
| AC-8 | No alert for current week | 1-2 | Current week always excluded |
| AC-9 | No alert when no entries | 1-2 | Empty state → no banner |
| AC-10 | Overdue persists Tue–Sun until submitted | 5-6 | Open app Wednesday → red banner if unsubmitted |
