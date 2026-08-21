# Testing

## Setup

- **Runner**: Vitest 4.x (single run by default, watch mode available)
- **Environment**: Node (not jsdom — no DOM tests)
- **Config**: Inline in `vite.config.ts` (no separate vitest config)

## Test Structure

Tests live in `__tests__/` directories adjacent to source:

```
src/api/__tests__/
  mock-provider.test.ts           — ApiProvider contract via mock
  agileday-provider.test.ts       — AgileDay client with mocked fetch
  entry-sync.test.ts              — Entry sync behavior (create, update, delete, read)
  description-helpers.test.ts     — splitDescriptions/joinDescriptions helpers
  entry-edit.test.ts              — inline card-edit helpers (duration parse/format, running-time edit, local-only check, used-task filter)
  flex.test.ts                    — Flex calculation
  rounding.test.ts                — 15-minute rounding
  holidays.test.ts                — Holiday set lookup
  global-tasks.test.ts            — Tenant global-default discovery via /v2/task
  billable.test.ts                — Billable resolution for unresolved tasks
src/utils/__tests__/
  date-range.test.ts              — monthsInRange/addDays API window helpers
  entry-list.test.ts              — Entry list grouping and display
  week.test.ts                    — Week utilities
  inactivity.test.ts              — Idle detection
  task-picker.test.ts             — Task picker display states (pure, no DOM)
src/store/__tests__/
  inactivity-reducer.test.ts      — Idle state transitions
```

Total: 300 tests.

## Test Patterns

### Mock Provider Tests (`mock-provider.test.ts`)

Tests the `ApiProvider` contract using the in-memory mock. Covers:
- CRUD operations (create, read, update, delete entries)
- Entry consolidation (same project+date+description)
- Batch updates
- Project/task filtering
- Employee/allocation data

The mock uses an injectable `EntryStore` for controlled test state.

### AgileDay Provider Tests (`agileday-provider.test.ts`)

Tests the real `AgileDayProvider` with mocked `fetch`. Covers:
- Request formatting (headers, URL construction, body)
- Token injection and refresh flow
- Error handling (401, 403, 500, network errors)
- Entry consolidation logic
- Response parsing

Uses `vi.fn()` to mock global `fetch` and JWT decode.

### Utility Tests

Pure function tests — no mocking needed. Test edge cases for:
- Flex hour calculations across weeks with holidays
- 15-minute rounding (ceil/floor) with override support
- Holiday set construction and lookup
- Week boundary calculations

## Running Tests

```bash
npm run test              # All tests, single run
npm run test:watch        # Watch mode
npx vitest run <file>     # Single file
```

## What's NOT Tested

- React components (no DOM/component tests) — component *decisions* are extracted
  into pure helpers instead, e.g. `describeTaskPickerState` in
  `src/utils/task-picker.ts` covers the task picker's hidden/notice/ready states
  without a renderer
- Tauri commands (Rust side)
- OAuth flow end-to-end
- Timer hook behavior

The testing strategy focuses on business logic (API provider contract, utility functions) rather than UI rendering.
