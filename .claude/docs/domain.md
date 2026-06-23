# Domain Glossary

## AgileDay Concepts

| Term | Definition |
|---|---|
| **Employee** | A user in AgileDay, identified by ID. Has name and email. |
| **Project** | A billable or internal project. Has name, customer, color, type (INTERNAL/EXTERNAL/ABSENCE/IDLE). |
| **Task** | A line item within a project. Has billable flag and active status. Required for time entries. |
| **Time Entry** | A logged block of time: project + task + date + minutes + description. Has status lifecycle. |
| **Opening** | An allocation of an employee to a project. Contains percentage, hours, and date range. |
| **Allocation** | The percentage of time an employee is expected to spend on a project, with periods of varying percentages. |
| **Timesheet** | Weekly grouping of time entries for submission/approval. |

## Entry Status Lifecycle

```
NEW → SAVED → SUBMITTED → APPROVED
                ↓
         CHANGE_REQUESTED → SAVED (re-edit)
```

- **NEW**: Just created, not yet saved
- **SAVED**: Persisted to AgileDay, editable
- **SUBMITTED**: Sent for approval, locked in app
- **APPROVED**: Manager approved, locked in app
- **CHANGE_REQUESTED**: Manager requested edits, back to editable

## App-Specific Concepts

| Term | Definition |
|---|---|
| **Session** | One timer start→stop cycle. Shown individually in the UI but consolidated into a single AgileDay entry per project+task+date+description. |
| **Sync Status** | Local tracking of whether a session has been saved to AgileDay: `pending` (saving), `synced` (saved), `unsaved` (save failed). |
| **Flex** | Overtime/undertime balance calculated from a configurable start date. Compares actual hours logged vs expected (7.5h/day, excluding holidays). |
| **Rounding** | 15-minute increment rounding applied during finalization. Uses ceil for totals, with per-project-day manual overrides. |
| **Finalize** | The process of reviewing, rounding, and submitting a week's entries. |
| **My Projects** | Projects the user is allocated to (via openings). Shown first in project picker. |
| **Continue** | Starting a new timer with the same project/task/description as an existing entry. Always starts as today. |

## Project Types

| Type | Meaning |
|---|---|
| **EXTERNAL** | Client-facing billable work |
| **INTERNAL** | Internal company work (non-billable) |
| **ABSENCE** | Leave, vacation, sick days |
| **IDLE** | Unallocated/bench time |

These types come from AgileDay allocations and are used for visual grouping in the allocation view.

**Absence projects are a separate entity.** They are not returned by `/v1/project` — they come from the dedicated `/v1/absence` endpoint (`getAbsenceProjects()`) and are tagged `projectType: "ABSENCE"`. In the project picker they appear in their own always-visible "Absence" group, independent of allocation (vacation/sick leave aren't allocated the way projects are). Time is logged against them the same way as a project (`projectId` + `taskId`). AgileDay's umbrella term **projectlike** (used by `/v2/opening`) covers regular projects, opportunities, and absence projects; its type enum also includes `OPPORTUNITY`, which this app does not surface.
