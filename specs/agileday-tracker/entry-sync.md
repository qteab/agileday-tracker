# Entry Sync Behavior

> How time entries are created, updated, and deleted between the app and AgileDay.

## Core Principle

**The app keeps individual sessions locally. AgileDay gets one consolidated entry per description+project+date.**

## Definitions

- **Session**: A single timer start→stop in the app. Has a local UUID.
- **AgileDay Entry**: A single row in AgileDay's timecard. Has an AgileDay UUID.
- **Group**: All local sessions with the same `description + projectId + date`.
- **Consolidated Total**: Sum of minutes across all sessions in a group.

## Create (Timer Stop)

When the user stops the timer:

1. **Local**: Add a new session to app state with `crypto.randomUUID()` as ID
2. **AgileDay**: Query `/updated` endpoint for existing entries matching `projectId + date + description + status=SAVED`
   - **0 matches**: POST a new entry with this session's minutes
   - **1 match**: PATCH that entry, setting minutes to `existing.minutes + session.minutes`
   - **2+ matches**: Create a new entry with `sum(all matches) + session.minutes`, then delete all old matches one by one

## Edit (Entry Edit Modal)

When the user edits a session:

1. **Local**: Update the session in app state
2. **AgileDay**: PATCH the AgileDay entry with the new field values
3. **Note**: Date changes are disabled — edit dates in AgileDay

## Delete (Entry Edit Modal → Delete)

When the user deletes a session from a group:

1. **Local**: Remove the session from app state immediately
2. **Calculate**: Sum remaining sessions in the same group (same `description + projectId + date`)
3. **AgileDay**:
   - **Remaining > 0**: Find the AgileDay entry (via `getTimeEntries` for that date), PATCH it with `remainingMinutes`
   - **Remaining = 0**: Find the AgileDay entry, DELETE it entirely
   - **No AgileDay match found**: No API call needed (entry only existed locally)

## Read (App Startup / Sync)

When loading entries:

1. Fetch from `/updated` endpoint (has descriptions, IDs, all statuses)
2. Fetch from `/timesheets/summary` endpoint (catches entries `/updated` misses)
3. Merge: `/updated` entries are primary (have descriptions), summary fills gaps
4. Each AgileDay entry becomes ONE local entry (no session splitting on reload)
5. Cached descriptions are applied to entries that lack them

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Delete only session in a group | AgileDay entry deleted |
| Delete one session from 3-session group | AgileDay entry PATCHed with reduced total |
| Timer stop, same desc+project+date exists in AgileDay | PATCH existing, don't create new |
| Timer stop, 3 duplicates exist in AgileDay | Consolidate: create 1 new, delete 3 old |
| App restart, then delete a session | Session came from API (has real ID or summary ID) — handled the same way |
| Delete a submitted entry | Not possible — edit modal blocked for submitted entries |
| AgileDay entry not found during delete | No error — entry only existed locally |
