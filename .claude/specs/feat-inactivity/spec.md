# Inactivity Detection

> While a timer is running, detect when the user has stepped away from the
> computer, surface it on the in-app banner and the menu-bar tray, and on return
> let the user discard or keep the away time.

## Status

- [x] Spec complete
- [x] Plan complete
- [ ] Implementation complete
- [ ] Reviewed

## User Stories

- As a time tracker, I want to be warned when I've left a timer running while
  away from my computer, so that I don't log time I didn't actually work.
- As a time tracker, I want to set how many idle minutes count as "away", so
  that brief pauses don't trigger false alarms.
- As a time tracker, when I come back I want to choose whether to discard or
  keep the away time, so that my logged entry reflects real work.
- As a time tracker, I want a glanceable signal in the menu bar (red dot +
  text) when I'm away, so that I notice even without opening the app.
- As a time tracker, I want the feature off by default, so that nothing changes
  unless I opt in.

## Acceptance Criteria

- [ ] An "Inactivity" card appears in Settings → Account, below the Appearance
  card, with an enable toggle and a minutes number input.
- [ ] The feature is **off by default**; minutes default to **10** and are
  clamped to **1–120**.
- [ ] The toggle and minutes persist across app restarts (in `display.json`).
- [ ] Detection runs **only while a timer is running** and the feature is
  enabled; otherwise no banner, no tray change.
- [ ] "Away" is system-wide idle (no mouse/keyboard input anywhere), read in
  Rust; it requires no macOS permission prompt.
- [ ] When idle reaches the threshold, an **amber** banner appears directly
  below the project/task dropdowns reading `Inactive for {h}h {m}m`, updating
  at minute granularity; it is not dismissable.
- [ ] At the same time, the tray title (always-visible menu bar) reads
  `You've been inactive for {h}h {m}m` and the bear icon's status dot turns red.
- [ ] The running timer keeps counting throughout (no auto-pause).
- [ ] Any input resets idle immediately: the tray reverts to the normal time +
  green dot at once.
- [ ] On return from an away period that reached the threshold, the banner
  becomes a **persistent** prompt: `You were away {h}h {m}m — [Discard] [Keep]`,
  showing the frozen away duration; it does not dismiss on its own.
- [ ] **Discard** rewinds the running timer by the away duration (shifts
  `startTime` forward) so those minutes are excluded from what's saved to
  AgileDay on stop. Precision is minute-granular.
- [ ] **Keep** dismisses the prompt and leaves the time counted.
- [ ] Only the **latest** away period is discardable; each away period gets its
  own prompt.
- [ ] **Stop is blocked** (no-op) while a return prompt is unresolved, until the
  user chooses Discard or Keep.
- [ ] Disabling the toggle (or the timer stopping) clears any banner / red dot
  immediately — including an unresolved return prompt, which is treated as Keep.

## Scope

### In Scope
- System-idle detection in Rust via `CGEventSourceSecondsSinceLastEventType`.
- In-app amber banner (away state + return Discard/Keep prompt).
- Tray title + red-dot icon (`tray-inactive.png` + `@2x`).
- Account-tab setting (toggle + minutes), persisted in `DisplayPrefs`.
- Discard rewinds the running timer's `startTime`; Keep is a no-op dismiss.
- Unit tests for pure helpers and the reducer transition.

### Out of Scope
- Discarding/aggregating multiple away periods at once (latest only).
- Auto-pause/auto-resume of the timer.
- A Discard/Keep action from the tray menu (in-app only for v1).
- Idle detection while no timer is running.
- Notifications/sounds; cross-platform (macOS only).
- Editing already-saved entries to remove idle time (use AgileDay web).

## Unknowns & Clarifications

- [DECIDED] What counts as activity? → System-wide OS idle (away from computer).
- [DECIDED] Configuration model? → Toggle (default off) + minutes (default 10,
  clamp 1–120), in Account tab below Appearance.
- [DECIDED] Does the timer pause? → No, keeps counting (informational + discard).
- [DECIDED] Tray text placement? → Full sentence in the always-visible menu bar.
- [DECIDED] Banner style/behavior? → Amber, auto-hide on activity, not dismissable.
- [DECIDED] Return flow? → Persistent Discard/Keep prompt; ignore is not allowed
  (Stop blocked until resolved).
- [DECIDED] Discard scope? → Latest away period only.
- [DECIDED] Early red dot before threshold? → No, only at threshold.
- [DECIDED] CoreGraphics framework link? → `#[link(name = "CoreGraphics",
  kind = "framework")]`, validated as the first step of task 6; fall back to the
  `core-graphics` crate only if the build rejects it.
- [DECIDED] Discard precision? → **Minute-granular**; reuse the value shown on
  the banner (`prev.idleSeconds`). Up to ~60s may remain counted — invisible
  given AgileDay logs in minutes and finalize rounds to 15-min.
- [DECIDED] Amber banner theming? → **Light amber**, matching the existing
  empty-description/submission warnings. Stays light in dark mode by design.
- [DECIDED] Disable while a return prompt is pending? → Clears the prompt, no
  decision required (treated as Keep).
- [DECIDED] Mac sleep/wake mid-session? → Wake requires an input, which resets
  system idle to 0; no special handling needed.

## Non-Functional Requirements

- **Performance:** Idle is read once per second on the existing Rust tick (one
  cheap syscall); the `inactivity` event fires only when `(is_away, idle_minute)`
  changes, not every tick.
- **Permissions:** No macOS accessibility/permission prompt.
- **Resilience:** Detection is independent of WebView timer throttling (driven
  by Rust). Survives the window being hidden.
- **Offline:** Fully local; no network involved. Discard only adjusts local
  timer state before the normal stop→save path.
- **Accessibility:** Banner uses text + icon (not color alone); copy is explicit.

## Dependencies

- **APIs / services:** None (no AgileDay changes; discard adjusts local
  `startTime` before the existing stop→`createTimeEntry` flow).
- **State / data:** New `DisplayPrefs` fields (`inactivityEnabled`,
  `inactivityMinutes`); new `InactivityState` reducer slice (`idleSeconds`,
  `isAway`, `pendingReturn`); new actions `SET_INACTIVITY`, `RESOLVE_RETURN`.
- **Native (Rust):** `system_idle_seconds()` FFI; extended `set_timer_status`
  signature; `TrayState` gains `icon_inactive` + inactivity prefs; tick emits
  `inactivity` event.
- **Routing / navigation:** None.
- **UI / presentation:** `InactivityBanner` component; Inactivity settings card;
  `tray-inactive.png` + `@2x` assets.

## Design References

- Screenshots (from the planning session):
  - In-app banner below dropdowns.
  - Menu-bar tray status with red dot + "You've been inactive…".
  - Settings → Account / Appearance placement.
- Plan: `.claude/specs/feat-inactivity/plan.md`
