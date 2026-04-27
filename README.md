# QTE Time Tracker

A lightweight macOS menu bar app for tracking time against AgileDay projects. Built for QTE employees.

## Install

1. Download the latest `.dmg` file from [Releases](https://github.com/Kaijonsson/agileday-tracker/releases)
2. Open the `.dmg` and drag **QTE Time Tracker** into your **Applications** folder
3. Open the app from Applications
4. **First time only:** macOS will warn about an unidentified developer. Right-click the app → **Open** → click **Open** in the dialog. You only need to do this once.

The app appears as a purple teddy bear icon in your menu bar (top-right of your screen).

## Getting started

1. Click the teddy bear icon in the menu bar → select **Show**
2. Click **Sign in with AgileDay** and log in with your AgileDay account
3. You're ready to track time

## How to use

### Tracking time

1. Type what you're working on in the **"What are you working on?"** field
2. Select a **project** from the dropdown (required)
3. Optionally select a **task** within the project
4. Click the **purple play button** to start the timer
5. Click the **red stop button** when you're done — the entry is saved automatically

You can start and stop as many times as you want during the day. Each session is saved separately.

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

---

Built with [Tauri](https://tauri.app), React, and TypeScript.
