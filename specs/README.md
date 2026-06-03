# Handoff: Time Tracker — "Connected stack" card layout (Variant A)

## Overview
A redesign of the QTE Time Tracker (a macOS menu-bar style panel, ~432px wide). The list
view is reorganised so that **each card represents one project for one day**. A card carries
a **single card-level timer** (elapsed time + play/stop), a **billable `$` toggle**, and a
**vertical stack of editable description lines** with an **"add description"** affordance at the
bottom. Days are grouped (Today / Yesterday …) with a per-day total. A **floating + button**
adds a new project card to Today.

This is **Variant A — "Connected stack"**: clean white cards, descriptions hanging off a thin
vertical connector rail under the header.

## About the Design Files
The files in this bundle are **design references created in HTML** — a prototype showing the
intended look and behaviour, **not** production code to ship directly. The task is to
**recreate this design in the target codebase's existing environment** (React/Vue/SwiftUI/etc.)
using its established components, patterns, and state libraries. If no environment exists yet,
choose the most appropriate framework for the project and implement it there.

`variant-a-connected-stack.html` is plain HTML/CSS (no framework, no build) so it reads as a
spec. `qte-tokens.css` holds the QTE design-system custom properties referenced throughout.

## Fidelity
**High-fidelity.** Final colours, typography, spacing, radii, and interaction affordances are
intended to be matched. Recreate pixel-accurately using the codebase's libraries, but pull the
literal values from the QTE design tokens (see Design Tokens) rather than hard-coding hexes.

## Screens / Views

### View: Time Tracker list panel
- **Purpose:** the user reviews time logged per project per day, starts/stops a project timer,
  toggles billability, and edits/adds work descriptions.
- **Frame:** fixed-width panel, **432px** wide, white window with **14px** radius,
  `box-shadow: 0 24px 60px rgba(11,4,21,0.22)`, `1px solid rgba(11,4,21,0.06)` border.
  Vertical flex; the body scrolls.

#### Region 1 — Title bar
- 3-column grid (`1fr auto 1fr`), padding `13px 16px 12px`, bottom border `1px solid var(--border)`.
- **Left:** macOS traffic lights — three 12px circles, 8px gap (`#ff5f57`, `#febc2e`, `#28c840`).
- **Center:** wordmark "QTE TIME TRACKER" — uppercase, weight 700, 14px, letter-spacing 0.12em,
  colour `var(--accent)` (#5519D5).
- **Right:** running total "+6h 23m" (weight 700, 14px, colour `#1f8a5b` green), then a tasks
  icon and a settings icon (Lucide `clipboard-check` and `settings`, 18px, `var(--fg-muted)`,
  1.75 stroke; hover opacity 0.6).

#### Region 2 — Tabs
- Wrapper padding `16px 16px 6px` on a `var(--qte-sandbox)` (#F3E8E8) background.
- Segmented control: 2-col grid, track `#e6dada`, pill radius (`var(--radius-pill)`), 4px padding.
- Each tab: weight 700, 15px, padding `9px 0`, colour `var(--fg-muted)`.
- **Active tab** (`List`): white background, colour `var(--fg)`, `var(--shadow-sm)`.

#### Region 3 — Scroll body
- Background `var(--qte-sandbox)`, padding `8px 16px 88px` (extra bottom padding clears the FAB).

##### Day group header (repeated per day)
- Flex row, space-between, baseline aligned, padding `18px 4px 10px`.
- Day name: weight 700, 19px, colour `var(--qte-black-orchid)` (#0B0415).
- Day total: weight 700, 18px, same colour, **tabular-nums**.

##### Project card (the core component — repeated)
Cards stack with **12px** gap (`.tt-cards` is a column flex).

- **Container:** white, `1px solid var(--border)` (#E5DCDC), radius **12px**, `var(--shadow-xs)`,
  `overflow:hidden`.
- **Header row** (`padding: 16px 16px 12px`, flex, `align-items:flex-start`, gap 12px):
  - **Left column** (flex 1, min-width 0):
    - **Title** = project name: weight 700, **17px**, colour `var(--qte-black-orchid)`,
      line-height 1.25, single-line truncate (ellipsis).
    - **Sub row** (margin-top 7px, font 13.5px, colour `var(--fg-muted)`, 8px gap):
      a status **dot** (9px circle), optional **status label** (e.g. "OnGoing", weight 600) +
      a `·` separator at opacity 0.4, then a `tag` icon (Lucide `tag`, 14px, `var(--fg-subtle)`)
      and the allocation text (e.g. "Development", "Retainer", "Discovery").
    - Dot colours: `green` #18a058 (active status), `purple` `var(--accent)`, `intense`
      `var(--qte-intense)` #896CFC. Use the dot colour to encode project/allocation identity.
  - **Right column** (flex, center, 12px gap, no shrink):
    - **Billable `$`** — 22px square, radius `var(--radius-xs)` (4px), weight 700, 14px.
      `on` → colour `var(--accent)`; `off` → colour `#c9bfbf`. Click toggles.
    - **Elapsed time** — 17px, weight 600, **tabular-nums**. Colour `var(--qte-black-orchid)`,
      or `var(--accent)` when the card is **running**.
    - **Play / Stop button** — 38px circle, white glyph.
      `play` → background `var(--accent)` (hover `#4512b0`), Lucide play (filled triangle).
      `stop` → background `#f0454b` (hover `#d8363c`), filled rounded square.
      `:active { transform: scale(0.94) }`.
- **Descriptions** (`padding: 0 16px 12px`):
  - A **connector rail**: `border-left: 2px solid var(--border)`, `margin-left:4px`,
    `padding-left:14px`, column flex, 9px gap.
  - **Each description row:** flex, gap 9px; a 5px accent bullet (`var(--accent)`,
    margin-top 7px to align with first text line) + the editable text (14px, line-height 1.4,
    colour `var(--fg)`). Wraps to multiple lines.
  - **Editable affordance:** focus shows `background:#faf6ff` + `box-shadow:0 0 0 2px rgba(85,25,213,0.25)`.
    Empty line shows placeholder "Describe what you worked on…" in `var(--fg-subtle)`.
  - **"add description" button:** ghost, flex with 6px gap, 13px, weight 600,
    colour `var(--fg-subtle)`, hover `var(--accent)`; leading Lucide plus icon (14px).

#### Region 4 — Floating action button (FAB)
- Absolutely positioned `right:16px; bottom:16px`, 52px circle, background `var(--accent)`,
  white plus icon (24px), shadow `0 8px 22px rgba(85,25,213,0.42)`.
- Hover `#4512b0`; `:active { transform: scale(0.95) }`.

## Interactions & Behavior
- **Play/Stop (card-level):** one timer per card. Starting a card's timer **stops any other
  running card** (single active timer across the whole list). Running card shows the red stop
  button + accent-coloured elapsed time.
- **Billable toggle:** clicking `$` flips billable on/off (accent ↔ grey).
- **Edit description:** description lines are inline-editable text; commit on blur.
- **Add description:** appends a new empty, focused description line to that card.
- **Floating +:** inserts a new project card at the **top of Today** with empty fields
  (name placeholder "New project", allocation "Select allocation", 0:00:00, billable on,
  no descriptions).
- **Tabs:** List / Allocation switch the body view (only List is designed here).
- **Transitions:** buttons use `var(--dur-fast)`/`var(--dur-base)` with `var(--ease-out)`
  (`cubic-bezier(0.2,0.7,0.2,1)`); press = scale 0.94–0.95. Keep motion subtle (QTE house style).

## State Management
Suggested model (adapt to the codebase):
- `tab`: `'list' | 'alloc'`.
- `days`: ordered list of `{ label, total, projects[] }`.
- `project`: `{ id, name, allocation, dotColor: 'green'|'purple'|'intense', status?, time,
  running: boolean, billable: boolean, descriptions: string[] }`.
- Invariant: **at most one** project has `running === true` across all days.
- Day `total` and the header running total are derived/aggregated (in the prototype they are
  static strings; wire them to the real timer in the app).
- Timer state should persist and tick in real time in the real app (the prototype shows static
  values).

## Design Tokens
All from `qte-tokens.css` (QTE design system). Key values used here:
- **Colours:** accent `--accent` #5519D5; accent-on-dark `--qte-intense` #896CFC;
  ink `--qte-black-orchid` #0B0415; body `--fg` #000; muted `--fg-muted` #4A4353;
  subtle `--fg-subtle` #7C7585; surface `--qte-sandbox` #F3E8E8; white #FFFFFF;
  border `--border` #E5DCDC. Status/util (not tokens): green #18a058 / total green #1F8A5B;
  stop red #f0454b (hover #d8363c); billable-off grey #c9bfbf; tabs track #e6dada.
- **Type:** family `--font-sans` = "Source Sans 3" (Google Fonts). Weights 400/600/700.
  Sizes used: 19 (day), 18 (day total), 17 (title/time), 15 (tab), 14 (sub/desc/$),
  13.5 (sub), 13 (add-desc), 14 (wordmark, tracked 0.12em).
- **Spacing:** 4px grid — gaps/paddings used: 6, 7, 8, 9, 12, 14, 16, 88(bottom).
- **Radii:** `--radius-xs` 4, card 12, window 14, pill `--radius-pill` 999, FAB/ctl 50%.
- **Shadows:** `--shadow-xs`, `--shadow-sm`; window `0 24px 60px rgba(11,4,21,0.22)`;
  FAB `0 8px 22px rgba(85,25,213,0.42)`.
- **Motion:** `--dur-fast` 120ms, `--dur-base` 200ms; `--ease-out` cubic-bezier(0.2,0.7,0.2,1).

## Assets
- **Icons:** Lucide (`play`, `square`→stop, `dollar-sign`→`$` text, `plus`, `settings`,
  `clipboard-check`, `tag`). 1.75px stroke, sizes 14/15/18/24. The QTE system has no proprietary
  icon set — swap for the codebase's existing icon library if one exists.
- **Font:** Source Sans 3 (Google Fonts) — import already in `qte-tokens.css`. Self-host if the
  app self-hosts fonts.
- No raster images. macOS traffic lights are plain CSS circles.

## Files
- `variant-a-connected-stack.html` — the isolated, full-panel reference for Variant A (open in a browser).
- `qte-tokens.css` — QTE design-system custom properties (colours, type, spacing, radii, motion).

> Source prototype (all three variants on a canvas, for context): `Time Tracker.html` +
> `tt-app.jsx` in the parent project. Variant A corresponds to the `CardConnected` component.
