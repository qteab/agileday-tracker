# Fix Time Entries Landing in UNPLANNED Row

> Time entries created by the app appear as UNPLANNED on the AgileDay timesheet because the `openingId` is not included in the POST request.

## Status

- [x] Spec complete
- [x] Plan complete
- [x] Implementation complete
- [ ] Reviewed

## Acceptance Criteria

- [x] When creating a time entry for an allocated project, `openingId` is included in the API POST body
- [ ] Time entries created via the app appear in the allocated row (not UNPLANNED) on AgileDay's timesheet
- [x] Creating entries for non-allocated projects still works — `openingId` is simply omitted
- [x] Searching in the ProjectPicker shows allocated projects first, then non-allocated in a separate section
- [x] `npm run check` passes with no regressions
