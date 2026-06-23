# UI Components

## Layout & Navigation

The app has a fixed-width (432px) panel layout: draggable title bar at top, then content area. Navigation is managed by state in `AuthenticatedApp` (`App.tsx`):

- **Default view**: TabSwitcher + (ProjectCardList | AllocationView) + FAB overlay
- **Settings**: SettingsView (replaces content, has back button)
- **Finalize**: FinalizeView (replaces content, has back button)

Settings and Finalize are triggered by tray menu events or header buttons.

### Title bar

3-column grid: left (traffic lights space), center ("QTE TIME TRACKER" wordmark), right (today's running total in green + finalize icon + settings icon + flex badge).

## Component Inventory

### Core (`src/components/`)

| Component | File | Purpose |
|---|---|---|
| **ProjectCard** | `ProjectCard.tsx` | Card per project-per-day. Everything is edited **inline** on non-submitted cards: descriptions (contentEditable, save on blur), **time** (click the counter → `H:MM` input; works while running too), **project** + **task** (click the name/tag → inline `chip` pickers), and **delete** (trash icon → in-card Cancel/Delete confirm). No modal. |
| **ProjectCardList** | `ProjectCardList.tsx` | Scrollable list of entries grouped by day. Each day has a header (day name + total) then a column of `ProjectCard` components. |
| **Fab** | `Fab.tsx` | Floating + button (bottom-right). Opens a dialog with ProjectPicker + TaskPicker to create a new Today entry and auto-start the timer. Locally-created entries get a `local-` id prefix until first synced. |
| **entry-edit** (helpers) | `entry-edit.ts` | Pure helpers for card editing: `parseDurationInput`/`formatDurationInput` (duration ⇄ minutes), `computeRunningTimeEdit` (running-time edit math), `isLocalOnlyEntry` (`local-` id prefix check), `usedTaskIds` (task ids already used for a project+date, used to filter the picker). Unit-tested in `entry-edit.test.ts`. |
| **ProjectPicker** | `ProjectPicker.tsx` | Dropdown for selecting a project. Three groups: "My projects" (allocated, non-absence), "Other projects" (shown when searching), and "Absence" (always visible, all `projectType: "ABSENCE"` projects regardless of allocation). Search bar searches all active projects; absence matches stay in the Absence group. |
| **TaskPicker** | `TaskPicker.tsx` | Dropdown filtered by selected project. Shows billable indicator. Optional `excludeIds` set hides tasks (used inline to hide tasks already logged for the same project+date, preventing duplicate entries). |
| **BillableIndicator** | `BillableIndicator.tsx` | 22px square display-only indicator showing if a task is billable (accent $ when billable, grey when not). |

### Views

| Component | File | Purpose |
|---|---|---|
| **AllocationView** | `AllocationView.tsx` | Week/month allocation vs actual hours comparison. Shows per-project breakdowns. |
| **FinalizeView** | `FinalizeView.tsx` | Timesheet submission UI: week summaries, per-day detail, rounding confirmation (15-min increments). |
| **FlexView** | `FlexView.tsx` | Flex time balance display: hourly delta per week from configured start date. |
| **SettingsView** | `SettingsView.tsx` | Tabbed settings: Flex (start date, initial hours), Display (menu-bar mode), Account (appearance/theme, inactivity toggle + minutes, name, email, logout). |
| **LoginScreen** | `LoginScreen.tsx` | OAuth "Sign in with AgileDay" button. Shown when not authenticated. |

### Alerts & Indicators

| Component | File | Purpose |
|---|---|---|
| **SubmissionAlert** | `SubmissionAlert.tsx` | Banner showing submission deadline for the current week. Dismissable per-week. |
| **FlexSetupAlert** | `FlexSetupAlert.tsx` | Banner prompting flex configuration if not set up. |
| **FlexBadge** | `FlexBadge.tsx` | Small badge in header showing current flex balance. Clickable → opens flex settings. |
| **UpdateChecker** | `UpdateChecker.tsx` | App update notification banner (Tauri updater plugin). |
| **TabSwitcher** | `TabSwitcher.tsx` | List/Allocation segmented control. Styled with sandbox background, pill-shaped track, bold tabs. |
| **InactivityBanner** | `InactivityBanner.tsx` | Rendered on the List tab, above `ProjectCardList`. Amber "Inactive for Hh Mm" while away; on return a persistent "You were away … — Discard/Keep" prompt. Discard rewinds the timer's `startTime`; Keep dismisses. Reads the `inactivity` reducer slice; light-amber (matches the empty-description warning, stays light in dark mode). |

## Hooks

### `useTimer` (`src/hooks/useTimer.ts`)

Card-level timer hook. Returns:

```typescript
{
  isRunning, projectId, taskId, elapsed,  // state
  startForCard, stop  // actions
}
```

Key behaviors:
- Timer state is `(projectId, taskId, startTime, isRunning)` — no description (descriptions live on entries)
- `startForCard(projectId, taskId)` stops any running timer first (single-timer invariant)
- Elapsed calculated as `now() - startTime` (timestamp-based, no drift)
- Stop: resets timer immediately, adds minutes to matching entry, then async saves to API
- Listens for tray events: `tray-stop-timer`, `tray-continue-last`

### ProjectCard description helpers

- `splitDescriptions(desc)` — splits AgileDay bullet format (`- line1\n- line2`) into string array
- `joinDescriptions(lines)` — joins string array back into AgileDay bullet format
- Inline editing: contentEditable spans, commit on blur, sync via `api.updateTimeEntry()`

## Styling

- **Tailwind CSS 4** via `@tailwindcss/vite` plugin
- **QTE Design System tokens** in `src/styles/index.css` using `@theme` directive:
  - `--color-primary: #5519d5` (QTE accent purple)
  - `--color-primary-dark: #4512b0` (hover)
  - `--color-primary-light: #896cfc` (intense purple)
  - `--color-bg: #f3e8e8` (sandbox)
  - `--color-bg-card: #ffffff`
  - `--color-text: #0b0415` (black orchid)
  - `--color-text-muted: #4a4353`
  - `--color-text-subtle: #7c7585`
  - `--color-border: #e5dcdc`
  - `--color-danger: #f0454b` (stop button red)
  - `--color-accent-green: #1f8a5b` (running total)
  - `--color-billable-off: #c9bfbf`
  - `--color-tab-track: #e6dada`
  - `--color-bg-edit: #faf6ff` (inline description editor focus background; dark: `#322a44`)
- **Font**: Source Sans 3 (Google Fonts), weights 400/600/700
- Custom scrollbar styling (thin, primary-light color)
- `user-select: none` on body (text selection only in inputs)

### Dark mode

Theme is a user preference (`DisplayPrefs.theme`: `"system" | "light" | "dark"`, default `"system"`), persisted in `display.json`. The control lives in **Settings → Account → Appearance**.

How it works:
- `src/utils/theme.ts` resolves the preference (`"system"` → `prefers-color-scheme`) and toggles a `dark` class on `<html>` plus `style.colorScheme`.
- `index.css` defines `:root.dark { … }` overriding the same `@theme` variable *values*. Because components reference semantic vars (`bg-bg`, `text-text`, `bg-bg-card`, `border-border`, …), the whole UI flips with no `dark:` utilities.
- `useThemeSync` (in `context.tsx`) applies the theme on pref change and, while `"system"`, listens for live OS appearance changes. `main.tsx` calls `applyTheme("system")` before first paint to avoid a flash.

## Patterns

- Components use Tailwind utility classes exclusively (no CSS modules, no styled-components)
- SVG icons are inline (Lucide-style, no icon library)
- Modals are rendered in-place (no portal)
- Forms use controlled components with React state
- All components are function components with hooks
- Card layout maps 1:1 to AgileDay entries (one card per project+task+date)
- Timer controls only appear on Today's cards; past-day cards are view/edit only
- All editing is inline on unsubmitted cards (description, time, project, task, delete); submitted cards are fully read-only
- Time edits persist via `createTimeEntry` (POST-or-PATCH); project/task edits persist via `updateTimeEntry` (PATCH by id, including `openingId`). Local-only entries (`local-` id) skip the API and persist on the next save
- Project/task pickers are disabled while that card's timer runs (timer state references the current projectId/taskId)
- Confirmations are rendered in-DOM (inline row), never native `confirm()`/`alert()` — those freeze the Tauri WebView
