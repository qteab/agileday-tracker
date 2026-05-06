# Implementation Plan: Pass openingId When Creating Time Entries

## Approach

The root cause is that when creating time entries via `POST /v1/time_entry/employee/id/{id}`,
the app sends `projectId` but **not `openingId`**. The AgileDay API accepts an optional
`openingId` field on time entry creation. Without it, AgileDay cannot associate the entry
with the employee's allocation/opening, so the entry appears in an "UNPLANNED" row on the
timesheet — even though the correct project ID is used.

**The fix:** Thread the opening ID from the `/v2/opening` response through to time entry
creation. Also split ProjectPicker search into allocated vs other projects sections.

## File Changes

### Modified Files
| File | Changes |
|------|---------|
| `src/api/types.ts` | Add `openingId` to `TimeEntry` interface (optional) |
| `src/api/provider.ts` | Add `openingId` to `MyProjectInfo` |
| `src/api/agileday.ts` | Extract opening `id` from `/v2/opening`, include `openingId` in POST bodies |
| `src/api/mock-core.ts` | Return mock `openingId` from `getMyProjects` |
| `src/store/reducer.ts` | Add `projectOpeningMap` to `AppState` |
| `src/store/context.tsx` | Build and dispatch project→opening mapping |
| `src/hooks/useTimer.ts` | Look up opening ID and include in entry |
| `src/components/ProjectPicker.tsx` | Split search into allocated/other sections |

## Tasks

- [x] 1. Add `openingId` to types
- [x] 2. Update `getMyProjects` to return opening IDs
- [x] 3. Store project→opening mapping in state
- [x] 4. Include `openingId` when creating time entries
- [x] 5. Prioritize allocated projects in search results
- [x] 6. Update tests and verify
