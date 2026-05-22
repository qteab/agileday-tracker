# Testing

## Setup

- **Runner**: Vitest 4.x (single run by default, watch mode available)
- **Environment**: Node (not jsdom — no DOM tests)
- **Config**: Inline in `vite.config.ts` (no separate vitest config)

## Test Structure

Tests live in `__tests__/` directories adjacent to source:

```
src/api/__tests__/
  mock-provider.test.ts       — 32 tests (ApiProvider contract via mock)
  agileday-provider.test.ts   — 25 tests (AgileDay client with mocked fetch)
src/utils/__tests__/
  flex.test.ts                — Flex calculation
  rounding.test.ts            — 15-minute rounding
  holidays.test.ts            — Holiday set lookup
  week.test.ts                — Week utilities
src/api/__tests__/
  entry-sync.test.ts          — Entry consolidation
```

Total: 57 tests.

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

- React components (no DOM/component tests)
- Tauri commands (Rust side)
- OAuth flow end-to-end
- Timer hook behavior

The testing strategy focuses on business logic (API provider contract, utility functions) rather than UI rendering.
