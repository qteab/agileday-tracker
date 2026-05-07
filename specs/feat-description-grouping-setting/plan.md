# Implementation Plan: Description Grouping Setting

## Approach

Users interact with AgileDay time entries in two ways: (A) one entry per unique description on a project+date, and (B) all descriptions for a project+date merged into a single entry with concatenated comments. The app currently only supports mode A — entries with the same description consolidate, but different descriptions stay separate.

This feature adds a user preference toggle to switch between these modes. When "Group descriptions" is enabled, stopping a timer will match existing entries by project+task+date only (ignoring description), and append the new description to the existing entry's comment field as a bullet point (e.g., `- task 1\n- task 2`). When disabled (default), the current behavior is preserved.

The setting is stored via Tauri's plugin-store (same mechanism as timer persistence) and exposed through a new Settings view accessible from a gear icon in the title bar. The settings page includes a visual toggle with inline illustrations showing the difference between the two modes.

## File Changes

### New Files
| File | Purpose |
|------|---------|
| `src/store/settings-store.ts` | Persistence layer for user settings via Tauri store |
| `src/components/SettingsView.tsx` | Settings page UI with grouping toggle and visual explanation |

### Modified Files
| File | Changes |
|------|---------|
| `src/api/agileday.ts` | `createTimeEntry` gains `groupDescriptions` parameter; when true, matches by project+date only and concatenates descriptions |
| `src/api/provider.ts` | `ApiProvider.createTimeEntry` signature adds optional `options?: { groupDescriptions?: boolean }` |
| `src/api/mock-core.ts` | Update mock to support `groupDescriptions` option |
| `src/api/types.ts` | Add `UserSettings` interface |
| `src/hooks/useTimer.ts` | Pass `groupDescriptions` setting to `createTimeEntry` |
| `src/store/context.tsx` | Load/expose settings state, add settings to context |
| `src/store/reducer.ts` | Add `settings` to `AppState`, add `SET_SETTINGS` action |
| `src/App.tsx` | Add settings view state, render SettingsView when active, listen for tray event |
| `src-tauri/src/lib.rs` | Add "Settings" menu item between Sync and Quit |

## Data Model

```typescript
// In types.ts
export interface UserSettings {
  groupDescriptions: boolean; // false = separate entries (default), true = merge into one
}

// Default
export const DEFAULT_SETTINGS: UserSettings = {
  groupDescriptions: false,
};
```

## Description Grouping Logic

When `groupDescriptions: true` and timer stops:

1. Query existing entries for same `projectId + date + status=SAVED` (ignore description)
2. If match found:
   - If existing description is empty: set it to new description
   - If new description is empty: keep existing
   - If both non-empty: append new description as new line (`existing + "\n" + new`)
   - PATCH with updated minutes + updated description
3. If no match: create new entry as normal

When `groupDescriptions: false` (default): current behavior unchanged.

## Tasks

- [x] 1. Add `UserSettings` type and defaults to types.ts
  - Files: `src/api/types.ts`
  - Details: Add interface and default constant

- [x]2. Create settings persistence store
  - Files: `src/store/settings-store.ts`
  - Details: `loadSettings()` and `saveSettings()` using Tauri plugin-store, mirroring timer-store.ts pattern

- [x]3. Add settings to app state and reducer
  - Files: `src/store/reducer.ts`
  - Details: Add `settings: UserSettings` to `AppState`, `SET_SETTINGS` action, `UPDATE_SETTINGS` action

- [x]4. Wire settings into context provider
  - Files: `src/store/context.tsx`
  - Details: Load settings on mount, expose `updateSettings` function, persist on change

- [x]5. Update ApiProvider interface
  - Files: `src/api/provider.ts`
  - Details: Add optional `options` parameter to `createTimeEntry`

- [x]6. Implement grouped description logic in AgileDay provider
  - Files: `src/api/agileday.ts`
  - Details: When `groupDescriptions` is true, match by project+date only, concatenate descriptions on PATCH

- [x]7. Update mock provider for compatibility
  - Files: `src/api/mock-core.ts`
  - Details: Support `groupDescriptions` option in mock createTimeEntry

- [x]8. Pass setting from useTimer to API
  - Files: `src/hooks/useTimer.ts`
  - Details: Read `groupDescriptions` from state, pass to `api.createTimeEntry`

- [x]9. Build Settings view component
  - Files: `src/components/SettingsView.tsx`
  - Details: Toggle switch with label, inline SVG/CSS illustrations showing the two modes, description text

- [x]10. Add "Settings" tray menu item and event handler
  - Files: `src-tauri/src/lib.rs`, `src/App.tsx`
  - Details: Add "Settings" menu item (Cmd+,) between Sync and Quit in tray menu. Emit `tray-open-settings` event. In App.tsx, listen for event and show SettingsView. Add back button to return to normal view.

- [x]11. Write tests for grouped description consolidation
  - Files: `src/api/__tests__/agileday-provider.test.ts`
  - Details: Test cases for grouping mode: new entry, append to existing, empty descriptions, multiple matches

- [x]12. Write tests for settings persistence
  - Files: `src/api/__tests__/mock-provider.test.ts`
  - Details: Test mock provider respects groupDescriptions option

- [x]13. Update spec docs
  - Files: `specs/feat-description-grouping-setting/spec.md`
  - Details: Document the feature acceptance criteria

## Test Plan

| Scenario | Type | File | Task # |
|----------|------|------|--------|
| Grouped mode: new entry (no existing) | unit | `agileday-provider.test.ts` | 11 |
| Grouped mode: append description to existing entry | unit | `agileday-provider.test.ts` | 11 |
| Grouped mode: empty new description | unit | `agileday-provider.test.ts` | 11 |
| Grouped mode: empty existing description | unit | `agileday-provider.test.ts` | 11 |
| Grouped mode: multiple existing matches | unit | `agileday-provider.test.ts` | 11 |
| Default mode: behavior unchanged | unit | `agileday-provider.test.ts` | 11 |
| Settings load/save persistence | unit | settings test | 12 |
| Mock provider groupDescriptions | unit | `mock-provider.test.ts` | 12 |

## Risks & Edge Cases

- **Existing grouped entries on AgileDay**: If user switches from grouped→separate mode, old grouped entries with multiline descriptions won't split. This is acceptable — the setting only affects future saves.
- **Description deduplication**: If user tracks "code review" twice in grouped mode, we should avoid appending the same description again. Mitigation: check if description already exists in the concatenated string.
- **Entry edit with grouped descriptions**: The EntryEditModal currently calculates group totals by matching description. In grouped mode, all entries for the project+date are in one AgileDay entry, so editing works naturally.
- **Line separator**: Use `\n` for description concatenation. AgileDay's text field supports multiline.

## Acceptance Verification

| # | Criterion | Task | Verification |
|---|-----------|------|-------------|
| AC-1 | Default behavior unchanged (separate entries per description) | 6 | Existing tests pass, new default-mode test |
| AC-2 | Grouped mode consolidates all descriptions into one entry | 6, 11 | Unit test: stop timer twice with different descriptions → one entry with both |
| AC-3 | Settings accessible from tray menu | 10 | Manual: tray "Settings" item opens settings view |
| AC-4 | Toggle persists across app restarts | 2, 4 | Unit test: save + load settings |
| AC-5 | Visual explanation on settings page | 9 | Manual: illustrations visible |
