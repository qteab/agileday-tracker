# Entry Sync Behavior

> How time entries are created, updated, and deleted between the app and AgileDay.

## Core Principle

**The app keeps individual sessions locally. AgileDay gets one consolidated entry per project+task+date.**

This follows the [Qte Time Logging Policy](Time%20logging%20policy.docx), which mandates one entry per customer per day with a single comment listing activities.

## Definitions

- **Session**: A single timer start→stop in the app. Has a local UUID.
- **AgileDay Entry**: A single row in AgileDay's timecard. Has an AgileDay UUID.
- **Group**: All local sessions with the same `projectId + taskId + date`.
- **Consolidated Total**: Sum of minutes across all sessions in a group.

## Create (Timer Stop)

When the user stops the timer:

1. **Local**: Add a new session to app state with `crypto.randomUUID()` as ID
2. **AgileDay**: Query `/updated` endpoint for existing entries matching `projectId + taskId + date + status=SAVED`
   - **0 matches**: POST a new entry with this session's minutes and description
   - **1 match**: PATCH that entry, setting minutes to `existing.minutes + session.minutes`. If the session has a description, merge it into the existing description using `mergeDescriptions` (dash-prefixed, deduped)
   - **2+ matches**: Create a new entry with `sum(all matches) + session.minutes`, merge all descriptions, then delete all old matches one by one

## Edit (Entry Edit Modal)

When the user edits a session that's part of a group:

1. **Local**: Update the session in app state with new values
2. **Calculate**: Sum ALL sessions in the group (including the edited one's new value)
3. **AgileDay**: Find the real entry (via `getTimeEntries`), PATCH it with:
   - `minutes`: the new group total
   - `description`: swap old description for new using `removeDescription` + `mergeDescriptions`
   - `projectId`: the edited project (if changed)
4. **Note**: Date changes are disabled — edit dates in AgileDay

**Example**: Group has Session A (3 min) + Session B (7 min) = 10 min.
Edit Session A to 5 min → AgileDay entry PATCHed to 12 min (5+7).

## Delete (Entry Edit Modal → Delete)

When the user deletes a session from a group:

1. **Local**: Remove the session from app state immediately
2. **Calculate**: Sum remaining sessions in the same group (same `projectId + taskId + date`)
3. **AgileDay**:
   - **Remaining > 0**: Find the AgileDay entry (via `getTimeEntries` for that date), PATCH it with `remainingMinutes` and remove the deleted session's description from the grouped description
   - **Remaining = 0**: Find the AgileDay entry, DELETE it entirely
   - **No AgileDay match found**: No API call needed (entry only existed locally)

## Read (App Startup / Sync)

When loading entries:

1. Fetch from `/updated` endpoint (has descriptions, IDs, all statuses)
2. Fetch from `/timesheets/summary` endpoint (catches entries `/updated` misses)
3. Merge: `/updated` entries are primary (have descriptions), summary fills gaps
4. Each AgileDay entry becomes ONE local entry (no session splitting on reload)
5. Cached descriptions are applied to entries that lack them

## Description Format

Descriptions in grouped entries use dash-prefixed lines:
```
- Code review on PRs #142 and #145
- Sprint planning
- Bug fix on payment webhook
```

The `mergeDescriptions` function handles:
- Prefixing new lines with `- `
- Deduplicating (same description not added twice)
- Preserving existing lines

The `removeDescription` function removes a specific line when editing or deleting a session.

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Delete only session in a group | AgileDay entry deleted |
| Delete one session from 3-session group | AgileDay entry PATCHed with reduced total, description line removed |
| Timer stop, same project+task+date exists in AgileDay | PATCH existing, merge descriptions |
| Timer stop, 3 duplicates exist in AgileDay | Consolidate: create 1 new, delete 3 old |
| Edit one session in a 2-session group | AgileDay PATCHed with new group total (both sessions summed) |
| Edit description in a group | Old description removed, new description merged into AgileDay entry |
| App restart, then delete a session | Session came from API (has real ID or summary ID) — handled the same way |
| Delete a submitted entry | Not possible — edit modal blocked for submitted entries |
| AgileDay entry not found during delete | No error — entry only existed locally |
| Different tasks on same project+date | Separate AgileDay entries (grouped by task, not just project) |
| Empty description on timer stop | Existing entry's description unchanged, only minutes added |
