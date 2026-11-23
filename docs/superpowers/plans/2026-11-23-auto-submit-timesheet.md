# Auto-submit Timesheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An opt-in setting that marks the affected week's AgileDay timecard as SUBMITTED after every write the app makes, without changing any other behaviour.

**Architecture:** Orchestration lives inside `createAgileDayProvider`, which wraps its four write methods in `withAutoSubmit`: unsubmit the affected week(s) if needed, run the untouched write path, resubmit. The setting is read through a callback so toggling it needs no provider rebuild. A shared `isEntryLocked` helper relaxes the app's own SUBMITTED locks while the setting is on.

**Tech Stack:** TypeScript (strict), React 19, Vitest, Tauri v2 plugin-store.

**Spec:** `docs/superpowers/specs/2026-11-23-auto-submit-timesheet-design.md`

## Global Constraints

- Setting default is `false` (opt-in).
- APPROVED entries stay locked in every case, setting on or off.
- A timecard status call must never fail a time entry write: log and swallow.
- One consolidated entry per project+task+date. Duplicate entries are a failed feature.
- `npm run check` (typecheck → lint → format:check → test) must pass before the final commit.
- No Claude attribution in commit messages.

## Review Focus

1. **A week with no timecard yet** (first entry of a brand-new week): `submitTimesheet` throws "No AgileDay timesheet found" — the save must still succeed. Test in Task 3.
2. **A timecard the API refuses to move** (frozen, or APPROVED upstream): the set-status POST fails — the save must still succeed. Test in Task 3.
3. **A batch spanning two weeks**: each distinct week must be submitted exactly once. Test in Task 3.
4. **A write whose date cannot be resolved** (delete called without dates): the write proceeds with no auto-submit and no crash. Test in Task 3.
5. **Stored prefs written before this feature existed**: loading them must yield `autoSubmit: false`, not `undefined`. Test in Task 1.

---

### Task 1: `autoSubmit` preference

**Files:**
- Modify: `src/store/display-store.ts`
- Test: `src/store/__tests__/display-prefs.test.ts` (create)

**Interfaces:**
- Produces: `DisplayPrefs.autoSubmit: boolean`; `normalizeDisplayPrefs(saved: LegacyDisplayPrefs | null): DisplayPrefs`

- [ ] **Step 1: Write the failing test**

```ts
describe("normalizeDisplayPrefs", () => {
  it("defaults autoSubmit to false when nothing is stored", () => {
    expect(normalizeDisplayPrefs(null).autoSubmit).toBe(false);
  });
  it("defaults autoSubmit to false for prefs saved before the setting existed", () => {
    expect(normalizeDisplayPrefs({ menuBarMode: "full" }).autoSubmit).toBe(false);
  });
  it("keeps a stored autoSubmit of true", () => {
    expect(normalizeDisplayPrefs({ autoSubmit: true }).autoSubmit).toBe(true);
  });
  it("still maps the legacy showTimerInMenuBar flag", () => {
    expect(normalizeDisplayPrefs({ showTimerInMenuBar: false }).menuBarMode).toBe("off");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/__tests__/display-prefs.test.ts`
Expected: FAIL — `normalizeDisplayPrefs` is not exported.

- [ ] **Step 3: Add the field and extract the pure normaliser**

In `src/store/display-store.ts`: add `autoSubmit: boolean` to `DisplayPrefs` and `autoSubmit?: boolean` to `LegacyDisplayPrefs`; add `autoSubmit: false` to `DEFAULT_DISPLAY_PREFS`. Move the whole body of `loadDisplayPrefs` after the `store.get` call into an exported `normalizeDisplayPrefs(saved)`, returning `{ ...DEFAULT_DISPLAY_PREFS }` for a null `saved`. `loadDisplayPrefs` becomes a `getStore` + `store.get` + `normalizeDisplayPrefs` call.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store/__tests__/display-prefs.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/store/display-store.ts src/store/__tests__/display-prefs.test.ts
git commit -m "Add autoSubmit display preference"
```

---

### Task 2: `setTimesheetStatus` on the provider

**Files:**
- Modify: `src/api/provider.ts`, `src/api/agileday.ts`, `src/api/mock-core.ts`
- Test: `src/api/__tests__/agileday-provider.test.ts` (extend the existing `submitTimesheet` describe block at :782)

**Interfaces:**
- Produces: `ApiProvider.setTimesheetStatus(employeeId: string, weekStart: string, month: string, status: "SUBMITTED" | "SAVED"): Promise<void>`
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Write the failing test**

```ts
describe("setTimesheetStatus", () => {
  it("sets a SUBMITTED card back to SAVED", async () => {
    // timecards lookup returns one card for the week with status SUBMITTED
    await provider.setTimesheetStatus("emp-1", "2026-09-28", "2026-10-01", "SAVED");
    expect(JSON.parse(opts.body)).toEqual({ status: "SAVED" });
  });
  it("does nothing when the card is already in the target status", async () => {
    // card already SAVED
    await provider.setTimesheetStatus("emp-1", "2026-09-28", "2026-10-01", "SAVED");
    expect(statusCalls).toHaveLength(0);
  });
  it("throws when no timecard matches the week", async () => {
    await expect(
      provider.setTimesheetStatus("emp-1", "2026-10-05", "2026-10-01", "SUBMITTED")
    ).rejects.toThrow(/No AgileDay timesheet/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api/__tests__/agileday-provider.test.ts -t setTimesheetStatus`
Expected: FAIL — `provider.setTimesheetStatus is not a function`.

- [ ] **Step 3: Implement it**

In `src/api/agileday.ts`, extract the timecard lookup from `submitTimesheet` (:592) into a local `async function findTimecard(employeeId, weekStart, month): Promise<{ id: string; status: string }>` that throws the existing "No AgileDay timesheet found for week of …" error. Implement `setTimesheetStatus` on top of it, returning early when `card.status === status`. Rewrite `submitTimesheet` as a call to `setTimesheetStatus(employeeId, weekStart, month, "SUBMITTED")` so the manual FinalizeView button is unchanged. Add the signature to `ApiProvider`, and to `mock-core.ts` set every entry in that week+month to `status`, generalising the existing `submitTimesheet` (:194) the same way.

- [ ] **Step 4: Run the full API suite to verify nothing regressed**

Run: `npx vitest run src/api/__tests__/agileday-provider.test.ts src/api/__tests__/mock-provider.test.ts`
Expected: PASS, including the pre-existing `submitTimesheet` tests.

- [ ] **Step 5: Commit**

```bash
git add src/api/provider.ts src/api/agileday.ts src/api/mock-core.ts src/api/__tests__/agileday-provider.test.ts
git commit -m "Generalize submitTimesheet into setTimesheetStatus"
```

---

### Task 3: The auto-submit write wrapper

**Files:**
- Modify: `src/api/agileday.ts`, `src/api/provider.ts`, `src/api/mock-core.ts`
- Test: `src/api/__tests__/auto-submit.test.ts` (create)

**Interfaces:**
- Consumes: `setTimesheetStatus` (Task 2); `getTimesheetPeriod(date)` from `src/utils/week.ts:54`.
- Produces: `createAgileDayProvider(opts?: { autoSubmit?: () => boolean })`; `ApiProvider.deleteTimeEntry(ids: string[], dates?: string[])`.

- [ ] **Step 1: Write the failing test**

Mock `@tauri-apps/plugin-http` as in `src/api/__tests__/entry-sync.test.ts:18`, recording every request. Build the provider with `createAgileDayProvider({ autoSubmit: () => enabled })`.

```ts
it("makes no timecard requests when the setting is off", async () => {
  enabled = false;
  await provider.createTimeEntry("emp-1", entry({ date: "2026-05-05" }));
  expect(requests.filter((r) => r.url.includes("time_card"))).toHaveLength(0);
});

it("unsubmits, writes, then resubmits when the setting is on", async () => {
  enabled = true; // week's card starts SUBMITTED
  await provider.createTimeEntry("emp-1", entry({ date: "2026-05-05" }));
  expect(statusBodies).toEqual([{ status: "SAVED" }, { status: "SUBMITTED" }]);
  expect(order.indexOf("write")).toBeGreaterThan(order.indexOf("SAVED"));
  expect(order.indexOf("write")).toBeLessThan(order.indexOf("SUBMITTED"));
});

it("merges into the existing entry instead of creating a duplicate", async () => {
  enabled = true; // card SUBMITTED, one existing SAVED-after-unsubmit entry same project+task+date
  await provider.createTimeEntry("emp-1", entry({ date: "2026-05-05", minutes: 30 }));
  expect(writeMethods).toEqual(["PATCH"]);
});

it("still saves the entry when the week has no timecard", async () => {
  enabled = true; // lookup returns no matching card
  await expect(provider.createTimeEntry("emp-1", entry())).resolves.toBeDefined();
});

it("still saves the entry when the status call fails", async () => {
  enabled = true; // time_card POST returns 403
  await expect(provider.createTimeEntry("emp-1", entry())).resolves.toBeDefined();
});

it("submits each distinct week once for a batch spanning two weeks", async () => {
  enabled = true;
  await provider.batchUpdateEntries("emp-1", [
    { id: "a", date: "2026-05-05", minutes: 60 },
    { id: "b", date: "2026-05-12", minutes: 60 },
  ]);
  expect(submittedWeeks).toEqual(["2026-05-04", "2026-05-11"]);
});

it("writes without auto-submitting when no date is available", async () => {
  enabled = true;
  await provider.deleteTimeEntry(["e1"]);
  expect(requests.filter((r) => r.url.includes("time_card"))).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api/__tests__/auto-submit.test.ts`
Expected: FAIL — `createAgileDayProvider` takes no options; no timecard requests are made.

- [ ] **Step 3: Implement the wrapper**

In `src/api/agileday.ts` add `async function withAutoSubmit<T>(employeeId: string, dates: Array<string | undefined>, fn: () => Promise<T>): Promise<T>`: return `fn()` directly when `opts?.autoSubmit?.()` is falsy; otherwise map the defined dates through `getTimesheetPeriod` into distinct `weekStart|month` pairs, `setTimesheetStatus(..., "SAVED")` each (each wrapped in its own try/catch that logs via `console.warn` and continues), `await fn()`, then `setTimesheetStatus(..., "SUBMITTED")` each under the same guard, and return `fn`'s result. With no resolvable dates, skip straight to `fn()`.

Wrap the four write methods: `createTimeEntry` (`[entry.date]`), `updateTimeEntry` (`[updates.date]`), `batchUpdateEntries` (`updates.map(u => u.date)`), `deleteTimeEntry` (`dates ?? []`). Add the optional `dates` argument to `deleteTimeEntry` in `provider.ts` and `mock-core.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/api/__tests__/`
Expected: PASS, including the pre-existing entry-sync and provider suites.

- [ ] **Step 5: Commit**

```bash
git add src/api/agileday.ts src/api/provider.ts src/api/mock-core.ts src/api/__tests__/auto-submit.test.ts
git commit -m "Submit the affected week after each AgileDay write"
```

---

### Task 4: Shared entry-lock helper and UI unlocking

**Files:**
- Create: `src/utils/entry-lock.ts`
- Test: `src/utils/__tests__/entry-lock.test.ts` (create)
- Modify: `src/api/rounding.ts`, `src/api/__tests__/rounding.test.ts`, `src/components/ProjectCard.tsx:154`, `src/components/ClickUp.tsx:263` and `:721`, `src/components/FinalizeView.tsx:58` and `:655`

**Interfaces:**
- Produces: `isEntryLocked(entry: Pick<TimeEntry, "status">, autoSubmit: boolean): boolean`
- Consumes: `DisplayPrefs.autoSubmit` (Task 1), read via `useApp().state.displayPrefs`.

- [ ] **Step 1: Write the failing test**

```ts
describe("isEntryLocked", () => {
  it("locks APPROVED whether or not auto-submit is on", () => {
    expect(isEntryLocked({ status: "APPROVED" }, false)).toBe(true);
    expect(isEntryLocked({ status: "APPROVED" }, true)).toBe(true);
  });
  it("locks SUBMITTED only when auto-submit is off", () => {
    expect(isEntryLocked({ status: "SUBMITTED" }, false)).toBe(true);
    expect(isEntryLocked({ status: "SUBMITTED" }, true)).toBe(false);
  });
  it("never locks an editable status", () => {
    for (const status of ["NEW", "SAVED", "CHANGE_REQUESTED"] as const) {
      expect(isEntryLocked({ status }, false)).toBe(false);
    }
  });
});
```

Add to `src/api/__tests__/rounding.test.ts`, beside the existing exclusion tests at :185:

```ts
it("adjusts SUBMITTED entries when includeSubmitted is set", () => {
  const plan = buildRoundingPlan([makeEntry({ minutes: 22, status: "SUBMITTED" })], {
    includeSubmitted: true,
  });
  expect(plan[0].adjustable).toHaveLength(1);
});
it("never adjusts APPROVED entries even when includeSubmitted is set", () => {
  const plan = buildRoundingPlan([makeEntry({ minutes: 22, status: "APPROVED" })], {
    includeSubmitted: true,
  });
  expect(plan[0].adjustable).toHaveLength(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/__tests__/entry-lock.test.ts src/api/__tests__/rounding.test.ts`
Expected: FAIL — module not found; `buildRoundingPlan` takes one argument.

- [ ] **Step 3: Implement**

Create `isEntryLocked` in `src/utils/entry-lock.ts`. Give `buildRoundingPlan(entries, opts?: { includeSubmitted?: boolean })` the option, replacing its two `status !== "SUBMITTED" && status !== "APPROVED"` filters (:60, :146) with `!isEntryLocked(e, opts?.includeSubmitted ?? false)` while leaving the display partition at :63 alone. In the three components, replace each `entry.status === "SUBMITTED" || entry.status === "APPROVED"` with `isEntryLocked(entry, displayPrefs.autoSubmit)`, and pass `{ includeSubmitted: displayPrefs.autoSubmit }` where `FinalizeView` builds its rounding plan.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/__tests__/entry-lock.test.ts src/api/__tests__/rounding.test.ts && npx tsc --noEmit`
Expected: PASS, and typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/utils/entry-lock.ts src/utils/__tests__/entry-lock.test.ts src/api/rounding.ts src/api/__tests__/rounding.test.ts src/components/ProjectCard.tsx src/components/ClickUp.tsx src/components/FinalizeView.tsx
git commit -m "Keep submitted entries editable while auto-submit is on"
```

---

### Task 5: Wire the provider to the setting

**Files:**
- Modify: `src/store/context.tsx`

**Interfaces:**
- Consumes: `createAgileDayProvider({ autoSubmit })` (Task 3), `state.displayPrefs.autoSubmit` (Task 1).

- [ ] **Step 1: Pass the setting through**

Hold the latest prefs in a ref that an effect keeps in sync with `state.displayPrefs`, and pass `{ autoSubmit: () => prefsRef.current.autoSubmit }` to `createAgileDayProvider`. A ref, not the value, so toggling the setting does not rebuild the provider or re-trigger the data reload keyed on it.

- [ ] **Step 2: Verify the app compiles and the suite is green**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/store/context.tsx
git commit -m "Feed the autoSubmit preference to the AgileDay provider"
```

---

### Task 6: Settings page

**Files:**
- Modify: `src/components/SettingsView.tsx`

**Interfaces:**
- Consumes: `DisplayPrefs.autoSubmit` (Task 1).

- [ ] **Step 1: Add the page**

Add `"timesheet"` to the `SettingsPage` union (:25) and `PAGE_TITLES` (:39) as `"Timesheet"`, add a `MENU_ITEMS` entry, and write `TimesheetSettings()` following `TimerSettings`' inactivity block: a `role="switch"` button with `aria-checked={displayPrefs.autoSubmit}` that dispatches `SET_DISPLAY_PREFS` and calls `saveDisplayPrefs`. Copy: label "Submit automatically", hint "Mark the whole week as submitted in AgileDay every time the app saves an entry." Add a line noting entries stay editable in the app and that submitting again is harmless.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/SettingsView.tsx
git commit -m "Add a Timesheet settings page with the auto-submit toggle"
```

---

### Task 7: Full check and docs

**Files:**
- Modify: `CLAUDE.md` (Key decisions)

- [ ] **Step 1: Note the decision**

Add one bullet under "Key decisions": auto-submit is opt-in, unsubmits and resubmits around each write so entry consolidation is unchanged, and keeps submitted entries editable in the app.

- [ ] **Step 2: Run the full check**

Run: `npm run check`
Expected: PASS — typecheck, lint, format, and the whole suite.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "Document the auto-submit decision"
```
