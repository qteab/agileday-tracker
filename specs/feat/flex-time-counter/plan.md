# Implementation Plan: Per-Day Rounding with Editable Overrides

## Approach

The current finalize timesheet feature rounds entries at the **project weekly total** level — all entries for a project in a week are summed, then the total is ceiled to the nearest 15 minutes. The change moves rounding granularity to **per project, per day**: each day's entries for a project are summed and rounded individually.

Additionally, the finalize view will gain **editable override inputs** on each rounded value. After automatic rounding (ceil to 15), the user can manually adjust any value — for example, changing an auto-rounded "1:15" back to "1:00". When the user edits a value, the system recalculates the difference and adjusts accordingly. The constraint is that the final value must still be a multiple of 15 minutes (the input enforces 15-minute steps).

This approach keeps the rounding logic in `rounding.ts` pure and testable, while the UI state for overrides lives in the `WeekDetail` component.

## File Changes

### Modified Files
| File | Changes |
|------|---------|
| `src/api/rounding.ts` | Change `buildRoundingPlan` to group by **project + day** instead of project only. Update `ProjectRounding` → rename/restructure to `DayProjectRounding`. Add support for manual override minutes. |
| `src/api/__tests__/rounding.test.ts` | Update all tests to reflect per-day grouping. Add tests for override scenarios. |
| `src/components/FinalizeView.tsx` | Add editable time inputs on rounded entries. Manage override state. Update summary display and info panel text. |

## Data Model

```typescript
// Rounding now groups by project+day, not just project
export interface DayProjectRounding {
  projectId: string;
  projectName?: string;
  date: string;
  totalMinutes: number;        // sum of SAVED entries for this project on this day
  roundedTotal: number;        // ceilTo15(totalMinutes), or user override
  difference: number;          // roundedTotal - totalMinutes
  entries: RoundingEntry[];
}

// RoundingEntry stays the same shape

// Override map keyed by "projectId:date" → overridden rounded total (must be multiple of 15)
type RoundingOverrides = Map<string, number>;
```

## Tasks

- [x] 1. **Test: per-day rounding in `buildRoundingPlan`**
  - Files: `src/api/__tests__/rounding.test.ts`
  - Details: Update existing tests and add new ones where entries for the same project on different days produce separate rounding groups. E.g., project P1 with 47m on Monday and 33m on Tuesday → two groups, each rounded independently (60m and 45m), not one group of 80m→90m.

- [x] 2. **Implement: change `buildRoundingPlan` to group by project+day**
  - Files: `src/api/rounding.ts`
  - Depends on: 1
  - Details: Change the grouping key from `projectId` to `projectId:date`. Rename `ProjectRounding` to `DayProjectRounding` (or add `date` field). Update the function signature and return type.

- [x] 3. **Test: override support in rounding**
  - Files: `src/api/__tests__/rounding.test.ts`
  - Depends on: 2
  - Details: Add tests for a new `applyOverrides` function: given a rounding plan and an overrides map, recalculate `roundedTotal`, `difference`, and `adjustedMinutes` per group. Override of 60→45 with an entry of 47m → adjustedMinutes = 47 - 2 = 45 (difference = -2, applied to largest entry). Override must be ≥ totalMinutes' floor to nearest 15? No — user can go below auto-rounded, but not below 0.

- [x] 4. **Implement: `applyOverrides` function**
  - Files: `src/api/rounding.ts`
  - Depends on: 3
  - Details: New function that takes `DayProjectRounding[]` and an overrides `Map<string, number>`, returns a new plan with recalculated values. The override replaces `roundedTotal`, recomputes `difference`, and re-assigns `adjustedMinutes` to the largest SAVED entry.

- [x] 5. **Update FinalizeView: per-day display and editable inputs**
  - Files: `src/components/FinalizeView.tsx`
  - Depends on: 2, 4
  - Details: In `WeekDetail`, change entry grouping to use the new per-day-per-project structure. Add an editable time input (stepping by 15 minutes) next to each day-project rounded total. Store overrides in component state. On input change, call `applyOverrides` and re-render. Update the "Project totals to round" summary to show per-day breakdowns. Update info panel text.

- [x] 6. **Update handleRound to use overridden values**
  - Files: `src/components/FinalizeView.tsx`
  - Depends on: 5
  - Details: When the user confirms rounding, use the (potentially overridden) adjusted entries for the API call instead of the auto-rounded ones.

## Test Plan

| Scenario | Type | File | Task # |
|----------|------|------|--------|
| Same project, different days → separate rounding groups | unit | `rounding.test.ts` | 1 |
| Same project, same day → single group (summed) | unit | `rounding.test.ts` | 1 |
| Override reduces rounded total | unit | `rounding.test.ts` | 3 |
| Override to exact total (no rounding adjustment) | unit | `rounding.test.ts` | 3 |
| Override below auto-rounded but ≥ totalMinutes | unit | `rounding.test.ts` | 3 |
| SUBMITTED/APPROVED entries still excluded from rounding | unit | `rounding.test.ts` | 1 |

## Risks & Edge Cases

- **Override floor**: The minimum override value is `floorTo15(totalMinutes)` — the user can reduce the rounding buffer but never under-report tracked time. This prevents negative adjustments on individual entries.
- **Multiple entries on same project+day**: The largest entry still absorbs the difference (positive or zero).
- **Display density**: Per-day-per-project grouping produces more rows than per-project. The UI may need to be more compact.

## Acceptance Verification

| # | Criterion | Task | Verification |
|---|-----------|------|-------------|
| AC-1 | Rounding is per project per day, not per project per week | 2 | Unit tests + manual check in UI |
| AC-2 | Rounded values are editable in the finalize view | 5 | Manual: click/type to change value |
| AC-3 | Editing a rounded value recalculates the adjustment | 5 | Manual: change 1:15 → 1:00, see entry adjustment update |
| AC-4 | Editable values step in 15-minute increments | 5 | Manual: input only allows multiples of 15 |
| AC-5 | Overridden values are used when submitting | 6 | Manual: confirm rounded entries match overridden values |
