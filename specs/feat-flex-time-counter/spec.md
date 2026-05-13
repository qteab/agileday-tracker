# Flex Time Counter

> Track accumulated overtime/undertime (flexsaldo) based on a 40-hour workweek, using AgileDay entries and company-configured holidays as source of truth.

## Status

- [x] Spec complete
- [x] Plan complete
- [ ] Implementation complete
- [ ] Reviewed

## User Stories

1. As an employee, I want to see my current flex balance at a glance so I know if I'm ahead or behind on hours.
2. As an employee, I want to set my starting flex balance so the counter starts from the correct value when I first use the app.
3. As an employee, I want to see a weekly breakdown of my flex so I can understand which weeks I over- or under-worked.
4. As an employee, I want holidays to be automatically excluded from expected hours so I don't appear to be short on holiday weeks.
5. As an employee working weekends, I want my weekend hours to count toward the weekly total so I get flex credit when I exceed the week's expected hours.

## Acceptance Criteria

- [ ] **AC-1**: Flex badge is visible in the title bar showing the current balance formatted as `±Xh Ym` (green for positive, red for negative).
- [ ] **AC-2**: If flex is not yet configured, the badge shows a "Setup" prompt that navigates to the Flex tab.
- [ ] **AC-3**: Flex tab contains a settings form with: start date picker, initial balance input (hours, supports negative), and a save button.
- [ ] **AC-4**: Flex config (start date + initial balance) persists across app restarts via Tauri store.
- [ ] **AC-5**: Flex is calculated on a **weekly** basis: `delta = hours_worked(Mon-Sun) - expected_hours(workdays × 8h)`.
- [ ] **AC-6**: Expected hours per week = (weekdays Mon–Fri that are not company holidays) × 8h. A week with 1 holiday expects 32h, 2 holidays expects 24h, etc.
- [ ] **AC-7**: Holidays are fetched from AgileDay Work Packages API (`GET /v1/workpackages/SE/holidays`) and cached locally per year.
- [ ] **AC-8**: Weekend/holiday work only generates flex if the week's total hours exceed the week's expected hours (no per-day flex increment).
- [ ] **AC-9**: Flex is calculated from the day after `startDate` through **yesterday** (today excluded to avoid starting at -8h each morning).
- [ ] **AC-10**: Current (incomplete) week: expected hours count workdays from Monday through yesterday only; worked hours sum Mon through yesterday.
- [ ] **AC-11**: Total flex = `initialBalance + Σ(weekly deltas)`.
- [ ] **AC-12**: Flex tab shows a weekly breakdown table with columns: week label, expected hours, worked hours, delta, and running total.
- [ ] **AC-13**: Holiday weeks are annotated in the breakdown (holiday names visible).
- [ ] **AC-14**: When start date is > 30 days ago, the app fetches additional entries from AgileDay for the gap period (start date to 30-days-ago).
- [ ] **AC-15**: Flex recalculates when entries change (sync, timer stop, entry edit) or when flex config is updated.

## Scope

### In Scope
- Flex badge in title bar (always visible when logged in)
- Flex tab with settings form and weekly breakdown
- Holiday fetching from AgileDay Work Packages API (country code `SE`)
- Local persistence of flex config via Tauri store
- Extended entry fetching for periods > 30 days
- Weekly flex calculation with holiday awareness

### Out of Scope
- Configurable daily hours (part-time support) — assumes 8h/day for all users
- Country code selection (hardcoded to `SE` for now — all users are Sweden-based)
- Historical flex snapshots or audit trail
- Flex targets or alerts ("you're approaching 50h")
- AgileDay's own flex balance (known to be buggy with quarterly resets)
- Editing entries from the flex view

## Unknowns & Clarifications

- [DECIDED] Holiday source → AgileDay Work Packages API (confirmed working, returns `{date, name}` pairs)
- [DECIDED] Flex model → weekly, not daily. Weekend work only counts if week total > expected.
- [DECIDED] No pre-2026 data needed → users set initial balance at launch time.
- [DECIDED] Half-day eves → trust AgileDay API as-is. Midsommarafton and Julafton are returned as full holidays. Nyårsafton is not — HR has been notified to update AgileDay's holiday config. No special-casing in the app.

## Non-Functional Requirements

- **Performance:** Flex calculation should complete in <100ms for a 6-month range. Holiday API fetched once per year, cached.
- **Offline:** If holiday fetch fails (offline), use cached holidays. If no cache exists, show a warning and calculate without holidays (all weekdays = 8h).
- **Reactivity:** Flex badge updates immediately when entries change or config is saved (no manual refresh needed).

## Dependencies

- **APIs:** `GET /v1/workpackages/SE/holidays?startDate=...&endDate=...` (new), existing `getTimeEntries` (extended range)
- **State:** New `flexConfig` and `flexEntries` fields in AppState
- **Persistence:** New Tauri store file for flex config (same pattern as `timer.json`)
- **UI:** FlexBadge component in title bar, FlexView as new tab, TabSwitcher extended to 3 tabs
