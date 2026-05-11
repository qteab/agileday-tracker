# Implementation Plan: Timesheet Finalization with 15-Minute Rounding

## Approach

The Qte time-logging policy requires entries rounded up to the nearest 15 minutes. Submission remains in AgileDay as a final review step — this feature only handles rounding.

The **Finalize view** is a two-level UI accessible from a title bar button (and tray menu):

1. **Week list** (main view): Summary cards for all weeks covered by loaded entries (~30 days). Each card shows total hours, entry count, and a tri-state status badge: **Active** (has unrounded SAVED entries), **Rounded** (all SAVED entries are multiples of 15), or **Submitted** (all entries SUBMITTED/APPROVED). Cards are ordered newest-first.
2. **Week detail** (drill-down): Click a week card to see its entries grouped by day, with current→rounded preview for each entry. Each day row shows a total with a highlight if it differs from 8h. A "Round All" button is shown with a warning explaining what will happen ("This will round all entries up to the nearest 15 minutes in AgileDay. Review the changes below before proceeding."). Clicking it triggers an "Are you sure?" confirmation. The button is disabled if all entries are already rounded or if the week is fully submitted.

Status badges carry through both levels — the detail view header shows the same Active/Rounded/Submitted state as the card.

Rounding operates on **AgileDay entries** (one per project+task+date), not local sessions. `roundUpTo15(minutes)` = `Math.ceil(minutes / 15) * 15`, with 0 staying 0. After rounding, a sync reloads entries so the UI reflects the updated values. The week range uses the existing `getWeekRange()` from AllocationView (Mon–Sun).

## File Changes

### New Files
| File | Purpose |
|------|---------|
| `src/api/rounding.ts` | `roundUpTo15` utility + `buildRoundingPlan` |
| `src/api/__tests__/rounding.test.ts` | Tests for rounding logic |
| `src/components/FinalizeView.tsx` | Two-level finalize UI: week list + week detail |

### Modified Files
| File | Changes |
|------|---------|
| `src/api/agileday.ts` | Add `batchUpdateEntries` — single PATCH with array body |
| `src/api/provider.ts` | Add `batchUpdateEntries` to `ApiProvider` interface |
| `src/api/mock-core.ts` | Implement `batchUpdateEntries` for mock provider |
| `src/App.tsx` | Add finalize button in title bar, toggle FinalizeView |
| `src-tauri/src/lib.rs` | Add "Finalize Timesheet" tray menu item |

## Data Model

```typescript
// src/api/rounding.ts

export function roundUpTo15(minutes: number): number {
  if (minutes <= 0) return 0;
  return Math.ceil(minutes / 15) * 15;
}

export interface RoundingEntry {
  id: string;
  date: string;
  projectName?: string;
  description: string;
  currentMinutes: number;
  roundedMinutes: number;
  needsRounding: boolean; // currentMinutes !== roundedMinutes
  status: TimeEntryStatus;
}

export function buildRoundingPlan(entries: TimeEntry[]): RoundingEntry[];
```

```typescript
// Week summary for the list view — tri-state status
type WeekStatus = "active" | "rounded" | "submitted";

interface WeekSummary {
  weekStart: string;      // YYYY-MM-DD (Monday)
  weekEnd: string;        // YYYY-MM-DD (Sunday)
  label: string;          // e.g. "May 5 – 9"
  totalMinutes: number;
  entryCount: number;
  needsRounding: number;  // count of SAVED entries that need rounding
  status: WeekStatus;
}
```

```typescript
// Addition to ApiProvider interface
batchUpdateEntries(
  employeeId: string,
  updates: Array<{ id: string } & Partial<TimeEntry>>
): Promise<TimeEntry[]>;
```

## Tasks

- [x] 1. **Test: `roundUpTo15` utility**
  - Files: `src/api/__tests__/rounding.test.ts`
  - Details: 0→0, 1→15, 14→15, 15→15, 16→30, 59→60, 60→60, 61→75

- [x] 2. **Implement: `roundUpTo15`**
  - Files: `src/api/rounding.ts`
  - Depends on: 1

- [x] 3. **Test: `buildRoundingPlan`**
  - Files: `src/api/__tests__/rounding.test.ts`
  - Details: Only includes SAVED entries, marks needsRounding correctly, computes rounded values, includes SUBMITTED entries as already-done (needsRounding: false)

- [x] 4. **Implement: `buildRoundingPlan`**
  - Files: `src/api/rounding.ts`
  - Depends on: 3

- [x] 5. **Test: `batchUpdateEntries` on AgileDay provider**
  - Files: `src/api/__tests__/agileday-provider.test.ts`
  - Details: Sends single PATCH with array body containing multiple entries, returns all updated

- [x] 6. **Implement: `batchUpdateEntries` on AgileDay provider + interface**
  - Files: `src/api/agileday.ts`, `src/api/provider.ts`
  - Depends on: 5

- [x] 7. **Implement: `batchUpdateEntries` on mock provider**
  - Files: `src/api/mock-core.ts`

- [x] 8. **Test: mock provider `batchUpdateEntries`**
  - Files: `src/api/__tests__/mock-provider.test.ts`
  - Depends on: 7

- [x] 9. **Build `FinalizeView` — week list (main view)**
  - Files: `src/components/FinalizeView.tsx`
  - Details: Back button header. Builds WeekSummary list from state.entries (same ~30 day range as main view). Each card shows: week label, total hours, entry count, status badge (Active/Rounded/Submitted). Cards ordered newest-first. Clicking a card navigates to detail view.

- [x] 10. **Build `FinalizeView` — week detail (drill-down)**
  - Files: `src/components/FinalizeView.tsx`
  - Details: Back arrow to week list. Header with week label + status badge. Entry list grouped by day. Each day has a total row highlighted amber if ≠ 480 min (8h). Each entry shows: project dot + name, description (truncated), "47 min → 60 min" or "60 min (no change)". "Round All" button with warning text above it: "This will round all entries up to the nearest 15 minutes in AgileDay. Review the changes above first." Info tooltip (?) next to warning quoting the policy and giving examples (47→60, 60→60, 1→15). Button disabled if status is "rounded" or "submitted".

- [x] 11. **Wire FinalizeView into App.tsx**
  - Files: `src/App.tsx`
  - Details: Add finalize icon button in title bar (between title and gear), toggle showFinalize state, render FinalizeView (same pattern as SettingsView)

- [x] 12. **Add tray menu item for Finalize**
  - Files: `src-tauri/src/lib.rs`, `src/App.tsx`
  - Details: "Finalize Timesheet" menu item emits `tray-open-finalize` event, App.tsx listens and shows FinalizeView

- [x] 13. **Integration: Round All flow with confirmation**
  - Files: `src/components/FinalizeView.tsx`
  - Details: Click "Round All" → show "Are you sure?" confirmation dialog (inline, same pattern as logout confirm). On confirm: build rounding plan, call `batchUpdateEntries` with rounded minutes for entries where needsRounding=true, trigger sync to reload entries. Show success/error feedback. Update view to reflect new status.

- [x] 14. **Run full check suite**
  - Command: `npm run check`

## Test Plan

| Scenario | Type | File | Task # |
|----------|------|------|--------|
| roundUpTo15 edge cases (0, 1, 15, 16, 60, 61) | unit | `rounding.test.ts` | 1 |
| buildRoundingPlan filters SAVED, marks needsRounding | unit | `rounding.test.ts` | 3 |
| buildRoundingPlan includes SUBMITTED as needsRounding=false | unit | `rounding.test.ts` | 3 |
| batchUpdateEntries sends array PATCH | unit | `agileday-provider.test.ts` | 5 |
| batchUpdateEntries mock provider updates multiple | unit | `mock-provider.test.ts` | 8 |

## Risks & Edge Cases

- **Rounding pushes daily total above 8h**: Policy says this signals allocation issue. Show total with amber highlight but don't cap.
- **Entries with 0 minutes**: Stay at 0 (don't round to 15).
- **Unsaved entries (syncStatus: "unsaved")**: Skip — can't update what isn't in AgileDay yet. Show a note.
- **Re-opening already-rounded week**: All entries show "no change", button disabled, status = "Rounded".
- **Submitted week**: Card shows "Submitted" badge, detail view is informational only, Round All disabled.
- **Batch PATCH failure**: No entries modified — show error, user retries.
- **Week with mixed statuses**: Some SAVED, some SUBMITTED — only round the SAVED ones, status = "Active".
- **Week spans month boundary**: Entries still group correctly by their date — no special handling needed.

## Acceptance Verification

| # | Criterion | Task | Verification |
|---|-----------|------|-------------|
| AC-1 | Entries rounded up to nearest 15 min | 1-4 | Unit tests |
| AC-2 | Week list shows past weeks with tri-state status | 9 | Open finalize → see week cards with badges |
| AC-3 | Week detail shows entries with before/after minutes | 10 | Click week → see entry list with rounding preview |
| AC-4 | Daily totals shown, highlighted if ≠ 8h | 10 | Day row shows total, amber if not 480 min |
| AC-5 | Round All updates AgileDay entries | 5-6, 13 | Click apply → verify minutes updated |
| AC-6 | Round All disabled if week submitted | 10 | Submitted week → button grayed out |
| AC-7 | Round All disabled if all already rounded | 10 | All entries ≡ 0 mod 15 → button grayed out |
| AC-8 | Round All requires two clicks (warning + "Are you sure?") | 13 | Click Round All → confirmation → apply |
| AC-9 | Zero-minute entries stay zero | 1 | roundUpTo15(0) === 0 |
| AC-10 | After rounding, entries reload from AgileDay | 13 | Sync triggered → fresh data |
| AC-11 | Status badges consistent between list and detail | 9-10 | Same badge on card and detail header |
