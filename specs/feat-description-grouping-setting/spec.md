# Description Grouping Setting

> Let users choose whether each timer session creates a separate AgileDay entry or merges into one entry per project+task+date with concatenated descriptions.

## Status

- [x] Spec complete
- [x] Plan complete
- [x] Implementation complete
- [x] Reviewed

## User Stories

1. As a user who tracks many short sessions on one project per day, I want my descriptions grouped into a single AgileDay entry so my timesheet stays clean.
2. As a user who prefers separate line items per session, I want each timer stop to create its own entry so I can see individual time breakdowns in AgileDay.
3. As a user, I want to toggle between these modes in a settings page so I can choose the style that matches my workflow.
4. As a user, I want my preference to persist across app restarts so I don't have to set it every time.

## Acceptance Criteria

- [ ] AC-1: By default (fresh install), each unique description creates a separate AgileDay entry (current behavior preserved)
- [ ] AC-2: When "Group descriptions" is enabled, stopping a timer matches existing entries by project+task+date only (ignoring description) and appends the new description to the existing entry's description field
- [ ] AC-3: Grouped descriptions use the format `- description` per line (dash-prefixed, newline-separated), matching AgileDay convention from Image #4
- [ ] AC-4: Duplicate descriptions within a grouped entry are not appended again (deduplicated)
- [ ] AC-5: If the new description is empty, the existing entry's description is unchanged (only minutes are added)
- [ ] AC-6: If the existing entry's description is empty and the new one is not, the entry's description becomes `- new description`
- [ ] AC-7: A "Settings" item in the system tray menu (between Sync and Quit) opens the settings view in the app window
- [ ] AC-8: The Settings view contains a mode selector for "Group descriptions" with a text explanation of each mode
- [ ] AC-9: The Settings view includes simple visual illustrations showing the difference between the two modes
- [ ] AC-10: The setting persists across app restarts via Tauri store
- [ ] AC-11: Changing the setting takes effect immediately for the next timer stop (no restart required)
- [ ] AC-12: All existing tests continue to pass (no regression)

## Scope

### In Scope
- Settings persistence (Tauri store)
- Settings UI (gear icon → settings view with toggle)
- Modified consolidation logic in AgileDay provider
- Updated mock provider for test compatibility
- Visual illustrations on settings page (CSS/styled, not images)
- Tests for new consolidation paths

### Out of Scope
- Retroactive splitting/merging of existing AgileDay entries when toggling the setting
- Editing grouped entries differently in the app (existing edit flow is sufficient)
- Per-project grouping preferences (single global toggle)
- Migrating description format on existing entries

## Unknowns & Clarifications

- [DECIDED] Description format in grouped mode → dash-prefixed lines: `- task 1\n- task 2\n- task 3`
- [DECIDED] Duplicate descriptions → deduplicated (not appended twice)
- [DECIDED] Illustrations → simple CSS-styled mock-ups showing the two modes, no external images needed
- [DECIDED] Grouping matches on `projectId + taskId + date` — entries with different tasks stay separate even in grouped mode

## Non-Functional Requirements

- **Performance:** Setting load must not delay app startup (async, non-blocking)
- **Accessibility:** Toggle must be keyboard-accessible, illustrations must have alt text or aria labels
- **Offline:** Setting is local-only, no network dependency

## Dependencies

- **State/data:** New `UserSettings` type, `settings` field in `AppState`, `settings.json` Tauri store file
- **API:** `createTimeEntry` gains optional `groupDescriptions` parameter
- **UI:** New `SettingsView` component, gear icon in App title bar
- **Store:** New `settings-store.ts` using `@tauri-apps/plugin-store`

## Design References

- Image #3 (separate entries): Three distinct rows in AgileDay for same project+date, different descriptions, different hours
- Image #4 (grouped): One row with comment popup showing `-task 1 / -task 2 / -task 3`, combined hours
- Settings page: Tray menu "Settings" item opens the app window and shows a settings view (replaces main content, with a back button to return to the normal view)
