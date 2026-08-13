# Implementation Plan: Fix Missing Time Entries Corrupting Flex Balance

## Problem

The flex balance showed `-34h 23m` when AgileDay's own figure was `+9:19 h`. The
entire deficit came from one week (`Aug 3-7 2026`) that the app reported as
`Worked: 0:00` against `Expected: 40:00`. AgileDay has 40 hours on that week
(confirmed: `W32 3.8-9.8 = 40:00 h` with month total reconciling as
`40:00 + 25:18 = 65:18`). Nothing in `calculateFlex` reduces *expected* hours for
vacation — it relies entirely on absence entries being fetched as worked minutes
(`src/utils/flex.ts:102`), so a week whose entries fail to load reads as five
no-show days.

Two independent defects in `getTimeEntries` (`src/api/agileday.ts:239-341`)
combine so that the week has no data source at all:

1. **`/updated` filters by last-update timestamp, not work date.**
   `src/api/agileday.ts:267-270` passes `updatedAfter = startDate` (today − 30
   days). Per `specs/agileday-tracker/openapi.yaml:16574` and the
   `updatedAfterParam` definition (`openapi.yaml:30190-30197`), that parameter
   filters on `updatedAt` — it is not a date-range query. Any entry last written
   before the cutoff is never returned, even when its work date sits mid-window.
   Pre-booked vacation is exactly that shape. This is also why the bug *appeared*
   suddenly: the cutoff rolls forward daily, so entries silently drop out once
   the cutoff passes the date they were booked.

2. **The summary fallback skips the middle month.**
   `src/api/agileday.ts:273-283` builds `new Set([startMonth, endMonth])`. The
   window is ±30 days (`src/store/context.tsx:553-562`), so today it spans
   July → September and only July and September are fetched — **August is never
   requested**. With a ±30-day window this drops the current month on nearly
   every day of the month, disabling the very fallback that exists to catch what
   `/updated` misses.

The same `updatedAfter`-as-date-range mistake appears a second time in
`createTimeEntry` (`src/api/agileday.ts:363-366`), where it is used to find an
existing entry to PATCH. When the existing entry was last touched before its own
work date — or when saving to a future date, where the cutoff is in the future
and the query returns nothing — the lookup misses and the app POSTs a duplicate
instead of PATCHing. Same root cause, direct data-integrity impact, so it is in
scope.

## Approach

Replace the entry read's primary source with a real date-range query. The
OpenAPI spec documents `GET /v1/time_entry/employee/id/{id}` with required
`startDate` / `endDate` params (`openapi.yaml:16462-16492`) returning the full
`timeEntryResponse[]` — ids, descriptions and statuses, filtered by **work
date**. That is precisely the query the app has been approximating. The app
already POSTs and PATCHes to this exact path, so token permissions on it are
proven. Note `endDate` is **exclusive** (`openapi.yaml:30052-30056`), so the
call must pass `endDate + 1 day`.

`getTimeEntries` becomes three layers, keeping the existing merge semantics:

- **Primary** — the date-range GET. Fixes defect 1 at the root.
- **Fallback** — the current `/updated` call, issued *only* if the primary
  throws, and with a wide 400-day `updatedAfter` lookback so pre-logged entries
  still land. This keeps today's behavior as a safety net if the date-range
  endpoint turns out to be restricted for our token.
- **Top-up** — the per-month summary, now iterating **every** month from
  `startMonth` to `endMonth` inclusive. Fixes defect 2. The existing
  "top up the deficit per `projectId::date`" merge (`agileday.ts:311-338`) is
  unchanged, so this also covers any status the primary source might omit.

Keeping all three layers is deliberate: the primary GET's default status filter
is undocumented (`timeEntryStatusParam` is optional with no stated default), so
the summary top-up remains the guarantee that no minutes go missing rather than
dead code.

Rejected alternative: keep `/updated` as primary and simply widen
`updatedAfter` to an epoch date. It fixes the symptom in one line, but that
endpoint has no pagination (`openapi.yaml:16569-16598`), so every sync would
pull the employee's entire history and grow unbounded. It survives as the
bounded-lookback fallback instead.

The two date helpers (`monthsInRange`, `addDays`) are pure and go in a new
`src/utils/date-range.ts` so they can be tested directly — month iteration
across a year boundary is exactly the kind of off-by-one worth locking down in
isolation rather than through a mocked provider.

## File Changes

### New Files
| File | Purpose |
|------|---------|
| `src/utils/date-range.ts` | `monthsInRange(startDate, endDate)` → every `YYYY-MM-01` in the span, inclusive; `addDays(dateStr, n)` → `YYYY-MM-DD` shifted by n days |
| `src/api/__tests__/date-range.test.ts` | Unit tests for both helpers |

### Modified Files
| File | Changes |
|------|---------|
| `src/api/agileday.ts` | `getTimeEntries`: date-range GET as primary, `/updated` demoted to error-fallback with 400-day lookback, summary loop over all months in window. `createTimeEntry`: replace the `/updated` existence lookup with a single-day date-range GET |
| `src/api/__tests__/entry-sync.test.ts` | New regression tests in the `Read (getTimeEntries)` describe block + a `createTimeEntry` duplicate-prevention test |
| `src/api/__tests__/flex.test.ts` | Regression test for the reported scenario: a fully-logged vacation week yields delta 0, not −40h |
| `.claude/docs/api-and-auth.md` | Endpoint table (add the date-range GET, restate what `/updated` and the summary are for), `createTimeEntry` flow step 1 |
| `.claude/docs/domain.md` | Line 35: flex expects 7.5h/day → 8h/day (`WORKDAY_MINUTES = 480`) |
| `CLAUDE.md` | "Reading entries" endpoint list; stale "57 tests" → current count |

## Data Model

No state or type changes. `TimeEntry` and the `ApiProvider` signature are
untouched — this is entirely inside the provider's fetch/merge logic.

Two new pure helpers:

```ts
/** Every month in [startDate, endDate] as YYYY-MM-01, inclusive, ascending. */
export function monthsInRange(startDate: string, endDate: string): string[];

/** Shift a YYYY-MM-DD date string by n days (n may be negative). */
export function addDays(dateStr: string, n: number): string;
```

The raw response shape of the date-range GET is the same `RawEntry` the
`/updated` call already yields (`agileday.ts:244-253`), so the mapping code at
`agileday.ts:295-309` needs no changes.

## Tasks

- [x] 1. **Test** — `monthsInRange` and `addDays`
  - Files: `src/api/__tests__/date-range.test.ts`
  - Details: `monthsInRange("2026-07-14", "2026-09-12")` → `["2026-07-01", "2026-08-01", "2026-09-01"]` (the reported bug); same month → single element; year boundary `"2025-12-20"`–`"2026-01-10"` → `["2025-12-01", "2026-01-01"]`. `addDays("2026-08-31", 1)` → `"2026-09-01"`; `addDays("2026-12-31", 1)` → `"2027-01-01"`; negative shift.
- [x] 2. **Implement** — `src/utils/date-range.ts`
  - Files: `src/utils/date-range.ts`
  - Depends on: 1
- [x] 3. **Test** — summary is fetched for every month in the window
  - Files: `src/api/__tests__/entry-sync.test.ts`
  - Details: window `2026-07-14`→`2026-09-12`; assert the fetched URLs include a `/v1/timesheets/emp-1/summary` call for `2026-07-01`, `2026-08-01` **and** `2026-09-01`. Uses a URL-routing `mockFetch.mockImplementation` rather than an ordered `mockResolvedValueOnce` chain, so the assertion does not depend on call order.
- [x] 4. **Test** — [P] an entry whose work date is in range but whose last update predates the window is returned
  - Files: `src/api/__tests__/entry-sync.test.ts`
  - Details: the defect-1 regression. Only the date-range GET returns the Aug 3-7 entries; `/updated` returns `[]` and the summary returns `{entries: []}`. Expect 5 × 480 min present.
- [x] 5. **Test** — [P] the primary call passes `startDate` inclusive and `endDate` exclusive
  - Files: `src/api/__tests__/entry-sync.test.ts`
  - Details: for `2026-08-01`→`2026-08-31`, assert the URL carries `startDate=2026-08-01&endDate=2026-09-01`, and that an entry dated `2026-08-31` survives the post-filter at `agileday.ts:296`.
- [x] 6. **Test** — [P] falls back to `/updated` when the primary GET errors
  - Files: `src/api/__tests__/entry-sync.test.ts`
  - Details: primary responds 500; `/updated` returns an entry; expect it in the result and expect the `updatedAfter` param to be ≥ 400 days before `startDate`.
- [x] 7. **Implement** — rework `getTimeEntries`
  - Files: `src/api/agileday.ts`
  - Depends on: 2, 3, 4, 5, 6
  - Details: primary date-range GET; `/updated` fallback on throw only (not on empty — zero entries is legitimate); `for (const month of monthsInRange(startDate, endDate))` for the summary. Merge/mapping logic unchanged.
- [x] 8. **Test** — `createTimeEntry` finds and PATCHes an existing entry last updated before its work date
  - Files: `src/api/__tests__/entry-sync.test.ts`
  - Details: existing SAVED entry for (project, task, date) reachable only via the date-range GET. Expect exactly one PATCH carrying that entry's id and **no** POST.
- [x] 9. **Implement** — swap `createTimeEntry`'s existence lookup to the single-day date-range GET
  - Files: `src/api/agileday.ts`
  - Depends on: 8
  - Details: `startDate=entry.date`, `endDate=addDays(entry.date, 1)`. `EDITABLE_STATUSES` filtering and the PATCH/POST branches stay as they are.
- [x] 10. **Test** — flex regression for the reported scenario
  - Files: `src/api/__tests__/flex.test.ts`
  - Details: `startDate: "2026-07-31"`, `initialHours: 4.31`, `referenceDate: 2026-08-13`, entries = 480 min/day for Aug 3-7 plus Aug 10-12 totalling 25:18. Assert the `Aug 3-7` week has `deltaMinutes: 0` (not −2400) and the total is positive. Locks in the user-visible outcome.
- [x] 11. Verify the full suite is green and run the real app against AgileDay
  - Files: —
  - Depends on: 7, 9, 10
  - Details: `npm run check`, then `npm run tauri dev` and confirm Settings → Flex shows `Aug 3 - 7` as `Worked: 40:00` with a non-negative balance.
- [x] 12. Update docs in the same commit
  - Files: `.claude/docs/api-and-auth.md`, `.claude/docs/domain.md`, `CLAUDE.md`
  - Depends on: 7, 9

## Test Plan

| Scenario | Type | File | Task # |
|----------|------|------|--------|
| `monthsInRange` covers a 3-month window | unit | `src/api/__tests__/date-range.test.ts` | 1 |
| `monthsInRange` single month / year boundary | unit | `src/api/__tests__/date-range.test.ts` | 1 |
| `addDays` across month and year end | unit | `src/api/__tests__/date-range.test.ts` | 1 |
| Summary fetched for all 3 months of a ±30d window | integration | `src/api/__tests__/entry-sync.test.ts` | 3 |
| Entry updated before window start is still returned | integration | `src/api/__tests__/entry-sync.test.ts` | 4 |
| `endDate` sent exclusive; last day retained | integration | `src/api/__tests__/entry-sync.test.ts` | 5 |
| `/updated` fallback when primary errors | integration | `src/api/__tests__/entry-sync.test.ts` | 6 |
| No duplicate POST for a stale existing entry | integration | `src/api/__tests__/entry-sync.test.ts` | 8 |
| Fully-logged vacation week → delta 0 | unit | `src/api/__tests__/flex.test.ts` | 10 |
| Existing 203 tests stay green | regression | all | 11 |

## Risks & Edge Cases

- **The primary endpoint's default status filter is undocumented.**
  `timeEntryStatusParam` is optional with no documented default, so the
  date-range GET might omit some statuses. Mitigation: the per-month summary
  top-up (all statuses) and the `/updated` fallback both stay in place, so
  coverage can only improve. Task 11's real-API check is what actually confirms
  it — the mocked tests cannot.
- **`endDate` is exclusive.** Getting this wrong silently drops the window's
  last day. Locked by task 5.
- **Existing ordered mocks.** The `Read (getTimeEntries)` tests use
  `mockResolvedValueOnce` chains. The new primary call returns the same shape as
  the old `/updated` call, so they should keep passing; if any break, migrate
  them to URL-routing mocks rather than bending the implementation to fit.
- **Request count per sync** rises from 2 to ~4 (1 primary + 3 monthly
  summaries) for a ±30-day window. Neither endpoint paginates and sync is
  user-triggered, so this is acceptable.
- **Silent `catch(() => [])` on every source** means a partial API outage still
  produces a confidently wrong flex number rather than a warning. [DECIDED]
  Accepted as-is — the authoritative flex value is on the Fortnox paycheck, so a
  drifting number gets noticed there. No warning UI, out of scope.
- **The fix will not make the app match AgileDay exactly.** With the entries
  restored the app computes roughly `+5h 37m`, while AgileDay reports `+9:19 h`.
  [DECIDED] AgileDay's own total is not trusted and is explicitly **not** an
  acceptance target; correctness is judged against the entries themselves
  (Aug 3-7 = 40:00 logged → delta 0).

## Acceptance Verification

| # | Criterion | Task | Verification |
|---|-----------|------|-------------|
| AC-1 | Entries are fetched by work date, not last-update timestamp | 7 | Task 4 test |
| AC-2 | A time entry inside the window is returned regardless of when it was last modified | 7 | Task 4 test |
| AC-3 | Every calendar month overlapping the window gets a summary fetch | 7 | Task 3 test |
| AC-4 | The window's last day is included (exclusive `endDate` handled) | 7 | Task 5 test |
| AC-5 | A failing primary read degrades to `/updated` instead of returning nothing | 7 | Task 6 test |
| AC-6 | `createTimeEntry` PATCHes a stale existing entry instead of POSTing a duplicate | 9 | Task 8 test |
| AC-7 | A fully-logged vacation week contributes 0 to flex, not −40h | 7, 10 | Task 10 test |
| AC-8 | Aug 3-7 2026 shows `Worked: 40:00` in the running app and the balance is non-negative | 7, 11 | Manual run, task 11 |
| AC-9 | All pre-existing tests still pass; docs updated in the same commit | 11, 12 | `npm run check` |
