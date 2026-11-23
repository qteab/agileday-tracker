# Auto-submit timesheet on every AgileDay write

## Intent and why

Submitting a timesheet is a manual step the user never wants to think about. The
app already writes every timer session to AgileDay immediately; the submission
state should just follow along. The user's words: the submit feature is more or
less useless to them and they want it done automatically.

## Goals

- A setting that, when on, marks the timecard for the affected week as SUBMITTED
  after every write the app makes to AgileDay.
- Everything else behaves exactly as it does today. Specifically: one
  consolidated entry per project+task+date, never one entry per timer session.
- Entries stay editable, continuable, deletable and roundable inside the app
  while the setting is on.

## Non-goals

- Submitting weeks the app did not touch (no sweep of historical weeks).
- Any change to behaviour when the setting is off.
- Approving timesheets, or anything on the manager side of the workflow.
- ClickUp-side writes. Only AgileDay has a timesheet to submit.

## Anti-goals

- Duplicate entries. If auto-submit produces one entry per timer stop instead of
  one per day, the feature is a failure even if submission works.
- A failed submit losing or blocking a time entry write. The entry write is the
  important part; submission is best-effort on top.
- An entry the user can no longer fix from inside the app.

## What already exists on main

Re-grounded against `origin/main`, which is well ahead of the branch this was
first sketched on:

- `ApiProvider.submitTimesheet(employeeId, weekStart, month)` already exists
  (`src/api/provider.ts:30`), implemented in `src/api/agileday.ts:592` and
  `src/api/mock-core.ts:194`, with tests in
  `src/api/__tests__/agileday-provider.test.ts:782`. It looks up the week's
  timecard via `POST /v1/timesheets/by-employee/month/{month}`, returns early if
  already SUBMITTED, then `POST .../time_card/id/{id}` with `{status:"SUBMITTED"}`.
- It is called from one place: the manual submit button in
  `src/components/FinalizeView.tsx:378`. That is the flow the user finds useless.
- `getTimesheetPeriod(date)` in `src/utils/week.ts:54` turns a date into
  `{weekStart, month}` — exactly the two arguments `submitTimesheet` takes.

So the submit call itself is done. What is missing is the setting, the
after-every-write trigger, and the unlocking.

## Constraints

- `createTimeEntry` merges a new session into an existing entry only when that
  entry's status is editable; SUBMITTED is excluded (confirmed by
  `src/api/__tests__/entry-sync.test.ts:256`). A SUBMITTED week therefore falls
  through to "no match" and POSTs a second entry — the anti-goal above.
- The app treats SUBMITTED as locked in several places: `ProjectCard.tsx:154`,
  `ClickUp.tsx:263` and `:721`, `FinalizeView.tsx:58` and `:655`, `rounding.ts`
  (excluded from rounding), `week.ts:107-119` (drives `SubmissionAlert`).
- The OpenAPI spec states only *frozen* timesheets are locked from editing.
  SUBMITTED is a workflow state. Whether the API rejects a PATCH on a SUBMITTED
  entry is not stated, so the design must not depend on it either way.
- `updateTimeEntry` and `deleteTimeEntry` receive only entry ids, not dates, so
  the affected week cannot be derived inside the provider without plumbing.

## Approaches

**A. Relax the status filters.** Treat SUBMITTED as mergeable when the setting is
on, and submit after each write. One extra API call per save. Rejected as the
primary mechanism: it bets on AgileDay accepting a PATCH against a SUBMITTED
entry, which the spec never promises. If that bet is wrong, every save after the
first one in a week fails.

**B. Unsubmit, write, resubmit.** (chosen) Before a write, if the affected week's
timecard is SUBMITTED, set it back to SAVED. Run the existing write path
completely unchanged. Then set the timecard to SUBMITTED. Chosen because
"otherwise behaves exactly like today" becomes true by construction — the merge
and consolidation logic runs against SAVED entries exactly as it does now — and
it does not depend on unverified API behaviour.

**C. Submit on a schedule or only for past days.** Rejected: the user explicitly
wants submission to happen as part of every write, not later.

Approach B still needs one piece of A: the in-app locks must be relaxed, because
between writes the entries genuinely are SUBMITTED and the user must still be
able to edit, delete, continue and round them.

## The design

**Setting.** `autoSubmit: boolean` added to the existing `DisplayPrefs` in
`src/store/display-store.ts`, default `false`. A deviation from the first sketch,
which proposed a new store: `DisplayPrefs` is already the general preferences
object (it holds the inactivity thresholds, which are not display either), so
this reuses the whole load/save/dispatch path instead of duplicating it. Opt-in,
because this is the company-wide build and turning it on changes what lands in
AgileDay.

**Status helper.** Generalise the existing `submitTimesheet` into
`setTimesheetStatus(employeeId, weekStart, month, status: "SUBMITTED" | "SAVED")`
on `ApiProvider`. `submitTimesheet` stays as it is for FinalizeView's manual
button; the new method shares the timecard lookup. Both skip the write when the
card is already in the requested status.

**Write wrapper.** Orchestration lives inside `createAgileDayProvider`, not at the
call sites: there are six AgileDay write call sites across four files
(`useTimer.ts:271`, `ProjectCard.tsx:84/449/523/584`, `ClickUp.tsx:332`,
`FinalizeView.tsx:501`), and wrapping each one is repetitive and easy to miss.
An internal `withAutoSubmit(employeeId, dates, fn)`:

1. If the setting is off, call `fn` and return. No extra requests.
2. Resolve the distinct weeks from `dates` via `getTimesheetPeriod`. For each
   week whose timecard is SUBMITTED, set it to SAVED.
3. Run `fn` — the existing, unmodified write path.
4. Set each affected week's timecard to SUBMITTED.

Steps 2 and 4 are best-effort: a failure is logged and swallowed, never
propagated, so the caller sees the entry write's own result. A failure in step 3
propagates exactly as today, and step 4 is skipped.

The provider reads the setting through a callback passed to
`createAgileDayProvider({ autoSubmit: () => boolean })`, so toggling it takes
effect without rebuilding the provider. The mock provider ignores it.

**Date plumbing.** `createTimeEntry` already carries `entry.date`.
`batchUpdateEntries` updates carry `date` where the caller sets it. For the two
that do not, callers pass what they already have in hand:
`updateTimeEntry` gains `date` in its `updates` (it is already
`Partial<TimeEntry>`, and sending the unchanged date in the PATCH is a no-op),
and `deleteTimeEntry(ids, dates?)` gains an optional second argument. A write
whose week cannot be resolved is written without auto-submit rather than guessed
at; the next write to that week, or the manual button, picks it up.

**Unlocking the UI.** When the setting is on, SUBMITTED stops meaning "locked":
- `ProjectCard.tsx` — edit, delete, continue and the timer button stay available.
- `ClickUp.tsx` — same, for the ClickUp-linked card paths.
- `rounding.ts` — SUBMITTED entries are rounded like SAVED ones.
- `FinalizeView.tsx` — a submitted week can still be rounded.
- `week.ts` — `hasUnsubmittedEntries` is unaffected; with auto-submit on, weeks
  are submitted, so `SubmissionAlert` simply stops firing. No change needed.

APPROVED continues to lock in every case, setting on or off: that is a manager
decision, not this app's.

## What is left to the builder

- Exact copy for the toggle and its explanatory line.
- Whether the timecard lookup inside the provider caches per week. Builder's
  call; correctness must not depend on it.
- Which icon the new settings page uses in `SettingsMenu`.
