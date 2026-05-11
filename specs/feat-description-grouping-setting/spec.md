# Description Grouping (Always On)

> All timer sessions for the same project+task+date merge into one AgileDay entry with descriptions concatenated as bullet lines. This is mandatory per the Qte Time Logging Policy.

## Status

- [x] Spec complete
- [x] Plan complete
- [x] Implementation complete
- [x] Reviewed

## Background

The initial implementation offered a user toggle between "separate" mode (one entry per description) and "grouped" mode (one entry per project+task+date). The Qte Time Logging Policy (v1.0, 2026-05-07) mandates "one entry per customer per day," making grouped mode the only correct behavior. The toggle has been removed.

## User Stories

1. As a user who tracks multiple sessions on one project per day, I want my descriptions grouped into a single AgileDay entry so my timesheet follows the company policy.
2. As a user, I want each session's description appended as a bullet line so the customer can see what I worked on.

## Acceptance Criteria

- [x] AC-1: Stopping a timer matches existing entries by project+task+date only (ignoring description) and appends the new description
- [x] AC-2: Grouped descriptions use the format `- description` per line (dash-prefixed, newline-separated)
- [x] AC-3: Duplicate descriptions within a grouped entry are not appended again (deduplicated)
- [x] AC-4: If the new description is empty, the existing entry's description is unchanged (only minutes are added)
- [x] AC-5: If the existing entry's description is empty and the new one is not, the entry's description becomes `- new description`
- [x] AC-6: There is no user-facing toggle or setting for grouping mode — it is always active
- [x] AC-7: All existing tests continue to pass (no regression)
- [x] AC-8: Editing a session swaps its old description for the new one in the grouped AgileDay entry
- [x] AC-9: Deleting a session removes its description line from the grouped AgileDay entry

## Scope

### In Scope
- Always-on grouped consolidation logic in AgileDay provider
- Description merge/remove utilities
- Simplified settings view (account only, no mode selector)
- Updated tests reflecting grouped-only behavior

### Out of Scope
- 15-minute rounding (policy requirement, separate feature)
- Empty comment validation/warning (separate UX decision)
- Retroactive merging of existing separate entries in AgileDay
- Per-project grouping preferences

## Decisions

- [DECIDED] Description format in grouped mode → dash-prefixed lines: `- task 1\n- task 2`
- [DECIDED] Duplicate descriptions → deduplicated (not appended twice)
- [DECIDED] Grouping matches on `projectId + taskId + date` — entries with different tasks stay separate
- [DECIDED] Toggle removed — grouped mode is the only mode, per company policy
