# UI Components

## Layout & Navigation

The app has a fixed layout: draggable title bar at top, then content area. Navigation is managed by state in `AuthenticatedApp` (`App.tsx`):

- **Default view**: Timer + TabSwitcher + (TimeEntryList | AllocationView)
- **Settings**: SettingsView (replaces content, has back button)
- **Finalize**: FinalizeView (replaces content, has back button)

Settings and Finalize are triggered by tray menu events or header buttons.

## Component Inventory

### Core (`src/components/`)

| Component | File | Purpose |
|---|---|---|
| **Timer** | `Timer.tsx` | Stopwatch display, start/stop buttons, project/task/description inputs. Uses `useTimer` hook. Requires project + task before start. |
| **TimeEntryList** | `TimeEntryList.tsx` | Scrollable list of entries grouped by day. Each day is a `DayGroup`. |
| **DayGroup** | `DayGroup.tsx` | Day header (date + total hours) + list of `TimeEntry` cards. |
| **TimeEntry** | `TimeEntry.tsx` | Single entry card: project color dot, description, duration, play/edit buttons. Submitted entries show lock icon. |
| **EntryEditModal** | `EntryEditModal.tsx` | Modal form for editing entry: description, project, task, date, minutes. |
| **ProjectPicker** | `ProjectPicker.tsx` | Dropdown for selecting a project. Allocated projects listed first, search bar searches all active projects. |
| **TaskPicker** | `TaskPicker.tsx` | Dropdown filtered by selected project. Shows billable indicator. |
| **BillableIndicator** | `BillableIndicator.tsx` | Small icon/label showing if a task is billable. |

### Views

| Component | File | Purpose |
|---|---|---|
| **AllocationView** | `AllocationView.tsx` | Week/month allocation vs actual hours comparison. Shows per-project breakdowns. |
| **FinalizeView** | `FinalizeView.tsx` | Timesheet submission UI: week summaries, per-day detail, rounding confirmation (15-min increments). |
| **FlexView** | `FlexView.tsx` | Flex time balance display: hourly delta per week from configured start date. |
| **SettingsView** | `SettingsView.tsx` | Tabbed settings: Account (name, email, logout), Flex (start date, initial hours), Holidays, About (version). |
| **LoginScreen** | `LoginScreen.tsx` | OAuth "Sign in with AgileDay" button. Shown when not authenticated. |

### Alerts & Indicators

| Component | File | Purpose |
|---|---|---|
| **SubmissionAlert** | `SubmissionAlert.tsx` | Banner showing submission deadline for the current week. Dismissable per-week. |
| **FlexSetupAlert** | `FlexSetupAlert.tsx` | Banner prompting flex configuration if not set up. |
| **FlexBadge** | `FlexBadge.tsx` | Small badge in header showing current flex balance. Clickable → opens flex settings. |
| **UpdateChecker** | `UpdateChecker.tsx` | App update notification banner (Tauri updater plugin). |
| **TabSwitcher** | `TabSwitcher.tsx` | List/Allocation tab toggle buttons. |

## Hooks

### `useTimer` (`src/hooks/useTimer.ts`)

Central timer hook used by `Timer.tsx`. Returns:

```typescript
{
  isRunning, description, projectId, taskId, elapsed,  // state
  start, stop, setDescription, setProject, setTask, setElapsedSeconds  // actions
}
```

Key behaviors:
- Elapsed calculated as `now() - startTime` (timestamp-based, no drift)
- Updates tray menu via `invoke("set_timer_status")` every second
- Stop: resets timer immediately, adds local entry, then async saves to API
- Listens for tray events: `tray-stop-timer`, `tray-continue-last`

## Styling

- **Tailwind CSS 4** via `@tailwindcss/vite` plugin
- Custom theme in `src/styles/index.css` using `@theme` directive:
  - `--color-primary: #7a59fc` (purple)
  - `--color-bg: #f0edeb` (warm gray)
  - `--color-bg-card: #ffffff`
  - `--color-text: #241143` (dark purple)
  - `--color-text-muted: #5f5273`
  - `--color-danger: #e5484d`
- System font stack: `-apple-system, BlinkMacSystemFont, ...`
- Custom scrollbar styling (thin, primary-light color)
- `user-select: none` on body (text selection only in inputs)
- No dark mode currently

## Patterns

- Components use Tailwind utility classes exclusively (no CSS modules, no styled-components)
- SVG icons are inline (no icon library)
- Modals are rendered in-place (no portal)
- Forms use controlled components with React state
- All components are function components with hooks
