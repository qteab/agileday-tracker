# Implementation Plan: Flex Time Counter

## Approach

Add a flex time (flexsaldo) counter that shows accumulated overtime/undertime based on an 8-hour workday / 40-hour workweek. The counter is independent of AgileDay's buggy flex tracking and handles Swedish public holidays correctly.

The core idea: **flex = initial_balance + Σ(hours_worked - expected_hours) per week**. Each week's expected hours = `workdays × 8h`, where workdays = Mon–Fri excluding Swedish holidays. A week with one holiday expects 32h, two holidays expects 24h, etc. Weekend/holiday work only contributes to flex if the week's total hours exceed the week's expected hours — there is no per-day flex increment.

We calculate flex through **yesterday only** so the counter doesn't start at -8h each morning. The current (incomplete) week counts workdays from Monday through yesterday, and sums all hours logged Mon through yesterday.

**Persistence:** Flex settings (start date, initial balance) are stored locally via Tauri's store plugin (same pattern as timer state). The calculation itself is derived from entries fetched from AgileDay. Since the default entry window is ±30 days, we'll fetch additional entries from start_date to 30-days-ago when the flex start date is older than 30 days.

**Holidays:** Fetched from AgileDay's Work Packages API (`GET /v1/workpackages/SE/holidays?startDate=...&endDate=...`). This returns exactly the holidays the company has enabled, including custom company holidays. Cached locally per year so we don't re-fetch on every calculation. No hardcoded holiday tables needed — AgileDay is the source of truth.

**UI placement:** A compact flex badge in the title bar (always visible) + a detailed FlexView accessible as a third tab ("Flex") showing weekly breakdown and settings to configure start date/initial balance.

## File Changes

### New Files
| File | Purpose |
|------|---------|
| `src/utils/holidays.ts` | Holiday helpers: fetch from AgileDay Work Packages API, cache locally, expose `isHoliday(date)` and `getHolidayName(date)` |
| `src/utils/flex.ts` | Pure flex calculation: `calculateFlex(entries, startDate, initialBalance, referenceDate)` |
| `src/store/flex-store.ts` | Tauri store persistence for flex config (start date, initial hours) |
| `src/components/FlexBadge.tsx` | Compact ±Xh display for the title bar |
| `src/components/FlexView.tsx` | Detailed flex breakdown (weekly table) + settings form |
| `src/api/__tests__/flex.test.ts` | Tests for flex calculation logic |
| `src/api/__tests__/holidays.test.ts` | Tests for holiday fetching and caching |

### Modified Files
| File | Changes |
|------|---------|
| `src/App.tsx` | Add FlexBadge to title bar, add "flex" tab, render FlexView |
| `src/components/TabSwitcher.tsx` | Support third "flex" tab |
| `src/store/context.tsx` | Fetch extended entries for flex calculation when start date > 30 days ago; load flex config on mount |
| `src/store/reducer.ts` | Add `flexConfig` and `flexEntries` to AppState; add actions `SET_FLEX_CONFIG`, `SET_FLEX_ENTRIES` |

## Data Model

```typescript
// src/store/flex-store.ts
interface FlexConfig {
  startDate: string;       // YYYY-MM-DD — flex counting starts the day AFTER this
  initialHours: number;    // flex balance as of startDate (can be negative)
}

// Added to AppState in reducer.ts
interface AppState {
  // ... existing fields ...
  flexConfig: FlexConfig | null;     // null = not configured yet
  flexEntries: TimeEntry[] | null;   // entries from startDate to -30 days (the gap)
}

// src/utils/flex.ts
interface FlexWeek {
  weekLabel: string;           // e.g. "May 5 – 9"
  startDate: string;           // Monday YYYY-MM-DD
  workdays: number;            // Mon-Fri minus holidays (0-5)
  expectedMinutes: number;     // workdays × 480
  workedMinutes: number;       // sum of all entries Mon-Sun
  deltaMinutes: number;        // worked - expected
  holidays: { date: string; name: string }[];
  isPartial: boolean;          // true for current incomplete week
}

interface FlexResult {
  totalMinutes: number;        // initialHours*60 + sum of all weekly deltas
  weeks: FlexWeek[];           // weekly breakdown
}
```

## Tasks

- [x] 1. **Test: Holiday fetching and lookup**
  - Files: `src/api/__tests__/holidays.test.ts`
  - Details: Test fetching holidays from AgileDay Work Packages API (mocked fetch), caching behavior, `isHoliday(date)` and `getHolidayName(date)` lookups.

- [x] 2. **Implement: Holiday utility + ApiProvider extension**
  - Files: `src/utils/holidays.ts`, `src/api/provider.ts`, `src/api/agileday.ts`
  - Depends on: 1
  - Details: Add `getHolidays(countryCode, startDate, endDate)` to ApiProvider. Implement against `GET /v1/workpackages/{countryCode}/holidays`. Holiday utility caches results per year, exposes `isHoliday(date, holidays)` and `getHolidayName(date, holidays)`.

- [x] 3. **Test: Flex calculation logic**
  - Files: `src/api/__tests__/flex.test.ts`
  - Details: Test basic flex calc (5 workdays, 8h each = 0 flex). Test overtime, undertime, weekend work, holiday handling, empty days (= -8h each workday), initial balance offset.

- [x] 4. **Implement: Flex calculation utility**
  - Files: `src/utils/flex.ts`
  - Depends on: 2, 3
  - Details: Pure function `calculateFlex(entries, startDate, initialHours, referenceDate)` → `FlexResult`. Groups entries into weeks (Mon-Sun). For each week: count workdays (Mon-Fri minus holidays), expected = workdays × 8h, worked = sum of all entries in that week. Current week only counts through yesterday.

- [x] 5. **Implement: Flex config persistence**
  - Files: `src/store/flex-store.ts`
  - Details: `loadFlexConfig()`, `saveFlexConfig(config)`, `clearFlexConfig()`. Same Tauri store pattern as timer-store.ts.

- [x] 6. **Implement: Reducer + context changes**
  - Files: `src/store/reducer.ts`, `src/store/context.tsx`
  - Depends on: 5
  - Details: Add `flexConfig` and `flexEntries` to state. Load flex config on mount. When flex config exists and start date > 30 days ago, fetch additional entries for the gap period. Refetch flex entries on sync.

- [x] 7. **Implement: FlexBadge component**
  - Files: `src/components/FlexBadge.tsx`
  - Depends on: 4, 6
  - Details: Compact display showing "+2h 15m" or "-1h 30m" with green/red coloring. Shows "Setup" link if flex config is null. Uses `useMemo` to calculate flex from state.

- [x] 8. **Implement: FlexView component**
  - Files: `src/components/FlexView.tsx`
  - Depends on: 4, 6
  - Details: Two sections: (1) Settings form — date picker for start date, number input for initial hours, save button. (2) Weekly breakdown table — week label, expected hours, worked hours, delta, running total. Holiday days highlighted.

- [x] 9. **Implement: Wire into App**
  - Files: `src/App.tsx`, `src/components/TabSwitcher.tsx`
  - Depends on: 7, 8
  - Details: Add FlexBadge to title bar (left of finalize button). Add "Flex" as third tab option. Render FlexView when flex tab is active.

- [x] 10. **Test: Integration test for flex flow**
  - Files: `src/api/__tests__/flex.test.ts`
  - Depends on: 4
  - Details: End-to-end calculation test: set initial balance, provide mix of entries across workdays/weekends/holidays over multiple weeks, verify total and weekly breakdowns.

## Test Plan

| Scenario | Type | File | Task # |
|----------|------|------|--------|
| Holidays fetched from AgileDay and cached | unit | `holidays.test.ts` | 1 |
| Holiday lookup returns correct name/boolean | unit | `holidays.test.ts` | 1 |
| Basic flex: 40h week = 0 flex | unit | `flex.test.ts` | 3 |
| Overtime: 45h week = +5h flex | unit | `flex.test.ts` | 3 |
| Undertime: 30h week = -10h flex | unit | `flex.test.ts` | 3 |
| Weekend work only counts if week > expected | unit | `flex.test.ts` | 3 |
| Holiday week: 1 holiday = 32h expected | unit | `flex.test.ts` | 3 |
| Holiday week: 32h worked + 8h weekend = 0 flex (not +8) | unit | `flex.test.ts` | 3 |
| Initial balance carried forward | unit | `flex.test.ts` | 3 |
| Zero-entry week = -40h (or less if holidays) | unit | `flex.test.ts` | 3 |
| Partial (current) week counts through yesterday only | unit | `flex.test.ts` | 3 |
| Multi-week breakdown | unit | `flex.test.ts` | 10 |

## Risks & Edge Cases

- **Entry window gap**: If flex start date is > 30 days ago, we need a second API call. If it's months ago, the fetch could be slow. Mitigation: show a loading spinner; consider auto-updating the checkpoint periodically (future enhancement).
- **Holiday API availability**: Work Packages API only supports dates from 2026-01-01 onwards. Not a problem since users set initial balance at launch time.
- **Part-time employees**: Currently assumes 8h/day, 40h/week. Future enhancement could allow configurable expected hours.
- **Today's entries excluded**: By design, flex counts through yesterday only. Users may be confused if they log 10h today but flex doesn't update until tomorrow. FlexBadge tooltip should explain this.
- **Stale flex config**: If user changes start date or initial balance, flex must recalculate entirely. The view should update reactively.
- **Weekend work is not "free" flex**: If someone works 32h Mon-Fri and 8h Saturday in a 5-workday week, their flex is 0, not +8. The weekly model handles this correctly.

## Acceptance Verification

| # | Criterion | Task | Verification |
|---|-----------|------|-------------|
| AC-1 | Flex badge visible in title bar showing current flex balance | 7, 9 | Visual — badge shows ±Xh Ym |
| AC-2 | Flex settings allow setting start date and initial balance | 8 | FlexView settings form saves to Tauri store |
| AC-3 | Swedish holidays excluded from expected hours | 2, 4 | Unit tests for holiday + flex calc |
| AC-4 | Weekend work only counts as flex if week total exceeds expected | 4 | Unit test: 32h weekday + 8h weekend in 40h week = 0 flex |
| AC-5 | Flex calculated through yesterday only (not today) | 4 | Unit test: today's entries excluded |
| AC-6 | Weekly breakdown visible in Flex tab | 8 | FlexView shows table with per-week totals |
| AC-7 | Flex persists across app restarts | 5, 6 | Config loaded from Tauri store on mount |
| AC-8 | Entries older than 30 days fetched when needed | 6 | Context fetches extended range |
