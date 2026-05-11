# Implementation Plan: Remove Grouping Toggle — Grouped Mode Only

## Approach

The Qte time-logging policy (v1.0, 2026-05-07) mandates **"one entry per customer per day"** with a single comment listing activities on separate lines. This aligns exactly with our existing "grouped" mode. The "separate" mode (one AgileDay entry per description) directly contradicts the policy.

This change removes the grouping toggle from settings, makes grouped mode the hardcoded default, and strips all conditional branching (`if (groupMode) ... else ...`) throughout the codebase. The `UserSettings` type, `settings-store.ts`, and the settings-related state/context code are removed since the only setting was `groupDescriptions`. The SettingsView keeps its account/sign-out section but loses the mode selector.

Cross-referencing the policy against our integration surfaces two additional items worth noting but **out of scope** for this PR:
- **15-minute rounding**: The policy says "round each entry up to the nearest 15 minutes." Our app currently stores exact minutes. This is a separate feature.
- **Empty comment validation**: The policy says "a billable session with no comment is not acceptable." We could warn on empty descriptions, but that's a separate UX decision.

## File Changes

### Removed Files
| File | Reason |
|------|--------|
| `src/store/settings-store.ts` | Only setting was `groupDescriptions`; no longer needed |

### Modified Files
| File | Changes |
|------|---------|
| `src/api/types.ts` | Remove `UserSettings` interface and `DEFAULT_SETTINGS` constant |
| `src/api/provider.ts` | Remove `options?: { groupDescriptions?: boolean }` from `createTimeEntry` signature |
| `src/api/agileday.ts` | Remove `groupMode` conditional branches — always use grouped logic. Keep `mergeDescriptions` and `removeDescription` (still needed) |
| `src/api/mock-core.ts` | Remove `groupDescriptions` option handling — always group |
| `src/store/reducer.ts` | Remove `settings` field from `AppState`, `SET_SETTINGS` action, `DEFAULT_SETTINGS` import |
| `src/store/context.tsx` | Remove `updateSettings`, `loadSettings`/`saveSettings` imports, settings load effect, settings from context value |
| `src/hooks/useTimer.ts` | Remove `{ groupDescriptions: ... }` option from `createTimeEntry` call, remove `state.settings` from deps |
| `src/components/EntryEditModal.tsx` | Remove `groupMode` variable — always use grouped matching/merging logic |
| `src/components/SettingsView.tsx` | Remove mode selector cards and `IllustrationCard`. Keep account section |
| `src/App.tsx` | Remove `updateSettings` from context usage if it was destructured |
| `src-tauri/src/lib.rs` | No change needed — Settings tray menu item stays (still has account/sign-out) |
| `src/api/__tests__/agileday-provider.test.ts` | Remove "default mode" tests that assert description-matching. Update grouped tests to not pass `groupDescriptions` option |
| `src/api/__tests__/mock-provider.test.ts` | Same — remove separate-mode tests, update grouped tests |
| `specs/agileday-tracker/entry-sync.md` | Update Group definition: `projectId + taskId + date` (not description). Update all sections to reflect grouped-only behavior |
| `specs/feat-description-grouping-setting/spec.md` | Mark as superseded or update to reflect grouped-only |

## Data Model

The `UserSettings` type and `DEFAULT_SETTINGS` constant are deleted entirely:

```typescript
// REMOVED from src/api/types.ts:
// export interface UserSettings { groupDescriptions: boolean; }
// export const DEFAULT_SETTINGS: UserSettings = { groupDescriptions: false };
```

`AppState.settings` field removed from reducer. `createTimeEntry` no longer takes an `options` parameter.

## Tasks

- [x] 1. **Remove `UserSettings` type and defaults from `types.ts`**
  - Files: `src/api/types.ts`
  - Details: Delete `UserSettings` interface and `DEFAULT_SETTINGS` export

- [x] 2. **Remove `options` parameter from `ApiProvider.createTimeEntry`**
  - Files: `src/api/provider.ts`
  - Details: Signature becomes `createTimeEntry(employeeId, entry): Promise<TimeEntry>`

- [x] 3. **Simplify `agileday.ts` — always use grouped logic**
  - Files: `src/api/agileday.ts`
  - Details: Remove `groupMode` variable and all `if (groupMode)` / `else` branches. The grouped path becomes the only path. Keep `mergeDescriptions` and `removeDescription` unchanged.

- [x] 4. **Simplify `mock-core.ts` — always use grouped logic**
  - Files: `src/api/mock-core.ts`
  - Details: Remove `options?.groupDescriptions` handling, always match by `projectId + taskId + date`

- [x] 5. **Remove settings from state layer**
  - Files: `src/store/reducer.ts`, `src/store/settings-store.ts`
  - Details: Remove `settings` from `AppState`, `SET_SETTINGS` action, `DEFAULT_SETTINGS` import. Delete `settings-store.ts`

- [x] 6. **Remove settings from context**
  - Files: `src/store/context.tsx`
  - Details: Remove `updateSettings`, settings load effect, `loadSettings`/`saveSettings` imports, `UserSettings` import, `updateSettings` from context value and provider

- [x] 7. **Simplify `useTimer.ts` — remove settings dependency**
  - Files: `src/hooks/useTimer.ts`
  - Details: Remove `{ groupDescriptions: state.settings.groupDescriptions }` from `createTimeEntry` call. Remove `state.settings.groupDescriptions` from `useCallback` deps

- [x] 8. **Simplify `EntryEditModal.tsx` — always use grouped logic**
  - Files: `src/components/EntryEditModal.tsx`
  - Details: Remove `groupMode` variable. The grouped matching/merging code becomes the only code path in both `handleSave` and `handleDelete`

- [x] 9. **Simplify `SettingsView.tsx` — remove mode selector**
  - Files: `src/components/SettingsView.tsx`
  - Details: Remove `IllustrationCard` component, mode selector grid, and "Description mode" section. Keep header, account section, sign-out

- [x] 10. **Clean up `App.tsx`**
  - Files: `src/App.tsx`
  - Details: Remove `updateSettings` if destructured from context

- [x] 11. **Update tests — remove separate-mode tests, simplify grouped tests**
  - Files: `src/api/__tests__/agileday-provider.test.ts`, `src/api/__tests__/mock-provider.test.ts`
  - Details: Remove tests asserting "default mode matches by description". Update grouped-mode tests to not pass `groupDescriptions` option. Verify all remaining tests pass

- [x] 12. **Update `entry-sync.md` to reflect grouped-only behavior**
  - Files: `specs/agileday-tracker/entry-sync.md`
  - Details: Change Group definition from `description + projectId + date` to `projectId + taskId + date`. Update Create/Edit/Delete sections. Add reference to time-logging policy

- [x] 13. **Update feature spec to reflect grouped-only**
  - Files: `specs/feat-description-grouping-setting/spec.md`
  - Details: Mark toggle-related ACs as removed/superseded. Update user stories

- [x] 14. **Run full check suite**
  - Command: `npm run check`
  - Details: Verify typecheck, lint, format, and all tests pass

## Test Plan

| Scenario | Type | File | Task # |
|----------|------|------|--------|
| Timer stop matches by project+task+date (always) | unit | `agileday-provider.test.ts` | 11 |
| Timer stop merges descriptions | unit | `agileday-provider.test.ts` | 11 |
| Timer stop creates new entry when no match | unit | `agileday-provider.test.ts` | 11 |
| Empty description doesn't append | unit | `agileday-provider.test.ts` | 11 |
| Different tasks stay separate | unit | `agileday-provider.test.ts` | 11 |
| Mock provider groups by project+task+date | unit | `mock-provider.test.ts` | 11 |
| `mergeDescriptions` / `removeDescription` unchanged | unit | `agileday-provider.test.ts` | 11 |
| Full suite passes | all | `npm run check` | 14 |

## Risks & Edge Cases

- **Existing users with `settings.json` containing `groupDescriptions: false`**: The setting file becomes orphaned but harmless — the app no longer reads it. No migration needed.
- **Entries created in separate mode**: Already in AgileDay as individual entries. Future timer stops on the same project+task+date will merge into one of them (correct behavior).
- **Policy gap — 15-minute rounding**: Not implemented here. Could cause policy non-compliance if users log e.g. 3-minute sessions. Flagged as follow-up.

## Acceptance Verification

| # | Criterion | Task | Verification |
|---|-----------|------|-------------|
| 1 | Grouped mode is always active (no toggle) | 1-8 | Timer stop → verify one AgileDay entry per project+task+date |
| 2 | Settings page has no mode selector | 9 | Open settings → only account section visible |
| 3 | Descriptions merge with `- ` prefix | 3 | Stop timer twice with different descriptions → verify `- desc1\n- desc2` format |
| 4 | Edit swaps description in grouped entry | 8 | Edit a session's description → verify old removed, new added |
| 5 | Delete removes description from grouped entry | 8 | Delete a session → verify its description removed from AgileDay entry |
| 6 | All tests pass | 14 | `npm run check` exits 0 |
| 7 | entry-sync.md reflects grouped-only | 12 | Read spec — Group defined as `projectId + taskId + date` |
