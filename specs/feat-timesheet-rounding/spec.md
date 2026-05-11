# Timesheet Finalization with 15-Minute Rounding

> Let users review past weeks and round all time entries up to the nearest 15 minutes before submitting in AgileDay, per the Qte Time Logging Policy.

## Status

- [x] Spec complete
- [x] Plan complete
- [ ] Implementation complete
- [ ] Reviewed

## User Stories

1. As a QTE employee, I want to see a summary of my past weeks so I can quickly tell which ones still need rounding.
2. As a QTE employee, I want to drill into a week and see each entry's current and rounded minutes so I can review before applying.
3. As a QTE employee, I want to round all entries in a week with one action so I don't have to edit each entry individually.
4. As a QTE employee, I want to see daily totals highlighted when they differ from 8h so I can spot allocation issues before submitting.
5. As a QTE employee, I want the rounding action to require confirmation so I don't accidentally modify my timesheet.

## Acceptance Criteria

### Finalize View — Access
- [ ] AC-1: A finalize button (calendar/check icon) is visible in the title bar, between the app title and the settings gear
- [ ] AC-2: Clicking the finalize button replaces the main content with the Finalize view (same pattern as Settings)
- [ ] AC-3: A "Finalize Timesheet" item in the system tray menu opens the Finalize view
- [ ] AC-4: The Finalize view has a back button that returns to the main view

### Week List (Main Level)
- [ ] AC-5: The week list shows one card per week, covering the same date range as the entry list (~30 days back)
- [ ] AC-6: Each week card shows: week label (e.g. "May 5 – 9"), total hours, entry count
- [ ] AC-7: Each week card shows a status badge — one of: **Active** (has unrounded SAVED entries), **Rounded** (all SAVED entries are multiples of 15 min), **Submitted** (all entries are SUBMITTED or APPROVED)
- [ ] AC-8: Week cards are ordered newest-first
- [ ] AC-9: Clicking a week card navigates to the week detail view

### Week Detail (Drill-Down Level)
- [ ] AC-10: The detail view has a back arrow that returns to the week list
- [ ] AC-11: The header shows the week label and the same status badge as the card
- [ ] AC-12: Entries are grouped by day, with a day header showing the date and day total
- [ ] AC-13: Day total is highlighted amber when it does not equal 480 minutes (8h)
- [ ] AC-14: Each entry row shows: project color dot, project name, description (truncated), and minutes in "current → rounded" format (e.g. "47 → 60") or "60 (no change)" if already rounded
- [ ] AC-15: SUBMITTED/APPROVED entries are visually distinct (muted/locked appearance)

### Rounding Logic
- [ ] AC-16: `roundUpTo15(minutes)` rounds up to the nearest multiple of 15 (e.g. 1→15, 14→15, 15→15, 16→30)
- [ ] AC-17: `roundUpTo15(0)` returns 0 (zero-minute entries are not rounded to 15)
- [ ] AC-18: Rounding applies only to SAVED entries — SUBMITTED/APPROVED entries are never modified

### Round All Action
- [ ] AC-19: A "Round All" button is visible at the bottom of the week detail view
- [ ] AC-20: Above the button, a warning text explains: "This will round all entries up to the nearest 15 minutes in AgileDay. Review the changes above first." An info tooltip (?) next to the warning quotes the rounding policy and gives examples (e.g. "47 min → 60 min, 60 min → 60 min, 1 min → 15 min")
- [ ] AC-21: The button is disabled when the week status is "Rounded" or "Submitted"
- [ ] AC-22: Clicking "Round All" shows an inline "Are you sure?" confirmation (two-click process)
- [ ] AC-23: Confirming triggers a single batch PATCH to AgileDay with rounded minutes for all entries that need rounding
- [ ] AC-24: After successful rounding, entries reload from AgileDay (sync) and the view updates to reflect new values
- [ ] AC-25: If the batch PATCH fails, an error message is shown and no entries are modified
- [ ] AC-26: Unsaved entries (syncStatus: "unsaved") are skipped with a visible note

### Batch Update API
- [ ] AC-27: `batchUpdateEntries` sends a single PATCH request with an array body containing all updates
- [ ] AC-28: `batchUpdateEntries` is available on both AgileDay and mock providers

## Scope

### In Scope
- Finalize view with two-level navigation (week list → week detail)
- 15-minute rounding utility with tests
- Batch update API method
- Title bar button and tray menu item
- Daily total display with 8h deviation highlight
- Tri-state status badges (Active / Rounded / Submitted)
- Two-click confirmation for rounding action

### Out of Scope
- Submitting entries (status change to SUBMITTED) — done in AgileDay
- Automatic rounding on timer stop
- Per-entry rounding (only "Round All" for the week)
- Undo/revert rounding
- Custom rounding increments (always 15 minutes)
- Notifications or reminders about the Monday deadline

## Unknowns & Clarifications

- [DECIDED] Week definition → Mon–Sun, reusing `getWeekRange()` from AllocationView
- [DECIDED] How many weeks → same range as entry list (~30 days back)
- [DECIDED] Rounding scope → AgileDay entries only, not local sessions
- [DECIDED] No submission → rounding only, user submits in AgileDay
- [DECIDED] Status tri-state → Active (needs rounding) / Rounded (all ≡ 0 mod 15) / Submitted (all SUBMITTED/APPROVED)
- [DECIDED] Confirmation → inline "Are you sure?" same pattern as logout confirm

## Non-Functional Requirements

- **Performance:** Batch PATCH should complete in a single API call, not one per entry
- **Accessibility:** Buttons and status badges must be keyboard-accessible; color is not the only indicator (text labels on badges)
- **Offline:** Finalize view requires connection — entries must be synced to AgileDay before rounding

## Dependencies

- **APIs:** New `batchUpdateEntries` method on `ApiProvider` (PATCH with array body — same endpoint as `updateTimeEntry`, just multiple items)
- **State:** Reads from `state.entries` (already loaded), no new state needed
- **UI:** Reuses `getWeekRange()` from AllocationView for week calculations
- **Existing behavior:** SUBMITTED entries are already read-only in the app (lock icon + disabled edit)
