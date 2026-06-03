# Connected Stack Card Layout

> Redesign the time entry list from individual entry rows to project-card-per-day layout, matching AgileDay's data model 1:1 and applying QTE design system tokens.

## Status

- [x] Spec complete
- [x] Plan complete
- [x] Implementation complete
- [ ] Reviewed

## User Stories

1. As a consultant, I want to see my time entries grouped as one card per project per day so that the layout matches how AgileDay stores my data and I can understand my day at a glance.

2. As a consultant, I want to start/stop a timer directly on a project card so that I don't need a separate timer widget — I just click play on the project I'm working on.

3. As a consultant, I want to add and edit description lines inline on a card so that I can document what I worked on without opening a modal.

4. As a consultant, I want to add a new project card to Today via a floating + button so that I can quickly start tracking a new project.

5. As a consultant, I want to see a billable indicator ($) on each card so that I know which work is billable without checking AgileDay.

6. As a consultant, I want the app to use QTE brand styling (Source Sans 3, purple accent, sandbox background) so that it feels like a QTE product.

## Acceptance Criteria

### Layout & Cards
- [ ] Each day group shows a header with day name (19px bold) and day total (18px bold, tabular-nums)
- [ ] Entries are displayed as white cards (12px radius, 1px border, shadow-xs), one card per unique (projectId, taskId, date)
- [ ] Cards stack vertically with 12px gap
- [ ] Card header shows: project name (17px bold, truncated), sub-row with status dot + task name, and right side with billable indicator + elapsed time + play/stop button
- [ ] Status dot colors: green (#18a058) for active, purple (#5519D5) for primary, intense (#896CFC) for secondary
- [ ] The top-level Timer component is removed; timer controls live on each card

### Description Stack
- [ ] Descriptions display as a vertical stack under the card header with a 2px left border connector rail
- [ ] Each description line has a 5px accent bullet and is inline-editable (contentEditable or controlled input)
- [ ] Focus styling: light purple background (#faf6ff) + 2px accent ring
- [ ] Empty description shows placeholder "Describe what you worked on..."
- [ ] "Add description" ghost button at bottom of stack appends a new empty focused line
- [ ] On blur, edited descriptions sync to AgileDay via `api.updateTimeEntry()`
- [ ] Description format preserves AgileDay's `- ` bullet prefix convention

### Timer Behavior
- [ ] Play/stop button only appears on Today's cards
- [ ] Starting a card's timer stops any other running card (single-timer invariant)
- [ ] When a running timer is stopped, elapsed minutes are added to the card's entry and synced to AgileDay
- [ ] Running card shows: red stop button (38px circle, #f0454b), accent-colored elapsed time
- [ ] Idle card shows: purple play button (38px circle, #5519D5)
- [ ] Timer state no longer includes `description` — description lives on the entry/card
- [ ] Tray menu Continue Last / Stop still work

### Past-Day Cards
- [ ] Past-day cards do NOT show play/stop buttons
- [ ] Unsubmitted past-day cards allow inline description editing and duration editing (via modal)
- [ ] Submitted/approved past-day cards are fully read-only (no edit, lock indicator)

### Billable Indicator
- [ ] `$` indicator (22px square, 4px radius, bold 14px) on each card header
- [ ] Accent color when task is billable, #c9bfbf when not
- [ ] Display-only — not interactive (billable is determined by the task)

### FAB (Floating Action Button)
- [ ] 52px purple circle, bottom-right (16px offset), white + icon, accent shadow
- [ ] On click: opens project + task selection (reuses existing pickers)
- [ ] Once project + task selected: creates a new Today entry (minutes=0) and optionally auto-starts timer
- [ ] Hover: darker purple (#4512b0); press: scale 0.95

### Title Bar
- [ ] Center: "QTE TIME TRACKER" wordmark (uppercase, 700 weight, 14px, tracking 0.12em, accent color)
- [ ] Right: running total time (green #1f8a5b, bold), finalize icon, settings icon
- [ ] Left: space for macOS traffic lights (existing behavior)

### Tab Switcher
- [ ] Sandbox background, #e6dada track, pill radius, 15px bold text
- [ ] Active tab: white background, dark text, shadow-sm
- [ ] Inactive tab: transparent, muted text

### Design Tokens
- [ ] Primary/accent: #5519D5 (was #7A59FC)
- [ ] Background: #F3E8E8 sandbox (was #F0EDEB)
- [ ] Text: #0B0415 black-orchid (was #241143)
- [ ] Text muted: #4A4353 (was #5F5273)
- [ ] Border: #E5DCDC (was #E5E0DE)
- [ ] Font: Source Sans 3 (was system sans-serif)
- [ ] Dark mode overrides updated to match new token structure

### Tests
- [ ] All existing 57 tests pass (`npm run test`)
- [ ] Description split/join roundtrips correctly
- [ ] Timer single-card invariant is enforced

## Scope

### In Scope
- List view card layout redesign
- Timer refactor (top-level → card-level)
- QTE design token adoption
- Description inline editing
- FAB for new cards
- Title bar update
- Tab switcher restyle

### Out of Scope
- Allocation view changes
- Settings view changes
- Finalize view changes
- Dark mode visual polish (token mapping yes, but no design review of dark appearance)
- Entry edit modal redesign (keep existing for duration/date overrides)
- Mobile/responsive layout (app is fixed 432px)

## Unknowns & Clarifications

- [DECIDED] Billable `$` is display-only, not a toggle -> determined by task on the project
- [DECIDED] No play/stop on past-day cards -> timer only on Today's cards, past cards allow edit only
- [DECIDED] No continue from past days -> new cards must be created each day

## Non-Functional Requirements

- **Performance:** Card list renders smoothly with 30 days of entries (current data window). Day grouping is memoized.
- **Accessibility:** Play/stop buttons have aria-labels. Description inputs are focusable via keyboard. Tab order is logical within each card.
- **Offline:** Failed saves still marked `syncStatus: "unsaved"` with retry capability (unchanged).

## Dependencies

- **APIs / services:** No API changes. Existing `ApiProvider` interface handles 1:1 entry model.
- **State / data:** `TimerState` simplified (remove `description` field). No new state fields.
- **UI / presentation:** New components `ProjectCard`, `ProjectCardList`, `Fab`, `NewCardDialog`. Deleted components: `Timer`, `TimeEntry`, `TimeEntryList`.
- **External:** Source Sans 3 font from Google Fonts (or self-hosted).

## Design References

- HTML prototype: `specs/variant-a-connected-stack.html` (open in browser for visual reference)
- Design tokens: `specs/qte-tokens.css`
- Handoff doc: `specs/README.md`
