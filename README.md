# QTE Time Tracker

A lightweight macOS menu bar app for tracking time against AgileDay projects. Built for QTE employees.

## Install

1. Download the latest `.dmg` file from [Releases](https://github.com/Kaijonsson/agileday-tracker/releases)
2. Open the `.dmg` and drag **QTE Time Tracker** into your **Applications** folder
3. **Before opening for the first time**, you need to allow the app since it's not signed with an Apple certificate. Choose one:
   - **Option A (easiest):** Open **Terminal** and paste:
     ```
     xattr -cr /Applications/QTE\ Time\ Tracker.app
     ```
   - **Option B:** Try opening the app. If macOS blocks it, go to **System Settings → Privacy & Security**, scroll down, and click **"Open Anyway"** next to the QTE Time Tracker message.
4. Open the app from Applications

The app appears as a purple teddy bear icon in your menu bar (top-right of your screen).

## Getting started

1. Click the teddy bear icon in the menu bar → select **Show**
2. Click **Sign in with AgileDay** and log in with your AgileDay account
3. You're ready to track time

## How to use

### Tracking time

1. Type what you're working on in the **"What are you working on?"** field
2. Select a **project** from the dropdown (required)
3. Select a **task** within the project (required)
4. Click the **purple play button** to start the timer
5. Click the **red stop button** when you're done — the entry is saved automatically

You can start and stop as many times as you want during the day. Each session is saved separately.

### How time entries sync to AgileDay

The app keeps things clean on your AgileDay timecard:

- **Same description + same project + same day = one entry.** If you track "code review" on Fokus three times today, AgileDay shows one "code review" entry with the combined total — not three separate rows.
- **Different descriptions = separate entries.** "code review" and "bug fix" on the same project create two entries, even on the same day.
- **New day = new entry.** Tracking the same task tomorrow creates a fresh entry for that day.
- **Submitted entries are locked.** Once you submit your timecard in AgileDay, those entries can't be edited from the app. You can still use the play button to start a new session for today.

Behind the scenes: when you stop the timer, the app checks if an entry with the same description, project, and date already exists in AgileDay. If it does, the minutes are added to it. If multiple duplicates somehow exist, they're automatically consolidated into one.

### Viewing your entries

Your time entries are shown below the timer, grouped by day. Each day shows the total time tracked.

- Entries with the same description and project are grouped together with a **count badge** on the left
- Click the **count badge** to expand and see individual sessions
- **Hover** over an entry to see a play button — click it to start a new session with the same description and project
- **Click** an entry to edit its details (description, project, duration, date)

### Allocation tab

Switch between **List** and **Allocation** using the tabs below the timer.

The Allocation tab shows how your tracked time compares to your allocated time per project. You can toggle between **Week** and **Month** views.

### Menu bar controls

Click the teddy bear icon in the menu bar to access:

- **New** — open the app and start tracking
- **Show** — bring the app window to the front
- **Quit** — close the app completely

### Signing out

Click the **sign-out icon** (top-right corner of the app window) to disconnect from AgileDay. You'll need to sign in again to continue tracking.

## Updates

The app checks for updates automatically when you open it. If a new version is available, you'll see a banner at the top with an **Update** button. Click it to install — the app restarts with the new version.

## Troubleshooting

**The app doesn't appear in the menu bar**
Make sure you don't have two instances running. Check Activity Monitor for "QTE Time Tracker" and quit any duplicates.

**"Port 19847 is already in use" when signing in**
Another application is using the port needed for sign-in. Close the other application and try again.

**Can't find the app after closing the window**
The app stays in your menu bar even when the window is closed. Click the teddy bear icon → **Show** to bring it back. To fully quit, use the menu → **Quit**.

## Contributing

### Getting started

Prerequisites: [Node.js](https://nodejs.org/) 22+, [Rust](https://rustup.rs/), Xcode CLI tools.

```bash
git clone https://github.com/Kaijonsson/agileday-tracker.git
cd agileday-tracker
npm install
npm run tauri dev    # Run the app in dev mode
```

Local builds require a signing key for the updater:
```bash
TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/agileday-tracker-v2.key) \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
npx tauri build --bundles app
```

### Code quality

Before pushing, run the full check suite:
```bash
npm run check    # typecheck → lint → format → test
```

This is the same check CI runs on every push. PRs that fail checks won't be merged.

### Key commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Vite dev server (port 1420) |
| `npm run tauri dev` | Full app in dev mode |
| `npm run test` | Run all tests (68 tests) |
| `npm run lint` | ESLint |
| `npm run format` | Prettier (auto-fix) |
| `npm run check` | All of the above |

### Documentation for AI assistance

This project is set up to work well with AI coding assistants (Claude Code, Cursor, etc.):

- **`CLAUDE.md`** — Project context, architecture, commands, and key decisions. Loaded automatically by Claude Code.
- **`specs/agileday-tracker/plan.md`** — Implementation plan with task status.
- **`specs/agileday-tracker/spec.md`** — Acceptance criteria (48 ACs).
- **`specs/agileday-tracker/entry-sync.md`** — How time entries sync between the app and AgileDay. Read this before touching the create/edit/delete flow.
- **`specs/agileday-tracker/openapi.yaml`** — AgileDay's REST API spec.

If you're using an AI assistant, point it to these files first. They contain the decisions and constraints that aren't obvious from the code alone.

### Architecture overview

The app has three layers:

1. **Tauri shell** (Rust, `src-tauri/`) — system tray, window management, OAuth callback server
2. **React frontend** (`src/`) — UI components, state management, timer logic
3. **API abstraction** (`src/api/`) — `ApiProvider` interface with AgileDay implementation

The most complex part is the entry sync logic (`src/api/agileday.ts` → `createTimeEntry`). It handles finding existing entries, patching, and consolidating duplicates. The behavior is documented in `entry-sync.md` and tested in `entry-sync.test.ts`.

### Releasing

Releases are dispatched manually from GitHub Actions:

1. Go to **Actions → Release → Run workflow**
2. Pick bump type: `patch` / `minor` / `major`
3. CI bumps version, builds, signs, and publishes to GitHub Releases
4. Users get an update prompt in the app

---

Built with [Tauri](https://tauri.app), React, and TypeScript.
