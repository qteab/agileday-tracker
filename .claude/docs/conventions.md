# Conventions & Patterns

## TypeScript

- **Strict mode** plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noImplicitReturns`, `noImplicitOverride`, `noUnusedLocals`/`Parameters`, `verbatimModuleSyntax`, `erasableSyntaxOnly` (see `tsconfig.json`)
- **Target**: ES2021, **Module**: ESNext (bundler resolution)
- `type` imports required (`import type { Foo }`, enforced by `verbatimModuleSyntax`)
- No `any`, no `!` non-null assertions, no lint/ts suppression comments — narrow instead
- Optional fields that get cleared via spread-merge are typed `?: T | undefined`; otherwise omit the key rather than setting `undefined`
- Unused function params prefixed with `_`

## Formatting (oxfmt)

Config in `.oxfmtrc.json`: double quotes, semicolons, ES5 trailing commas, 100-char lines. Imports are sorted and Tailwind classes ordered (using `src/styles/index.css` as the theme) on format.

## Linting (oxlint)

Config in `.oxlintrc.json`. Type-aware (`oxlint-tsgolint`) with the typescript-eslint `strict-type-checked` rule set, plus the `correctness` category for eslint, typescript, unicorn, oxc, react (incl. hooks / React Compiler rules), import and vitest. Warnings fail the run.

## React Patterns

- **Function components only** (no class components)
- **Context + useReducer** for global state (no Redux, no Zustand)
- **useCallback** for all handler functions passed as props
- **useMemo** for expensive computations (e.g., provider creation)
- **useRef** for mutable values that shouldn't trigger re-renders (e.g., latest closure refs for event listeners)
- Custom hooks in `src/hooks/` — currently only `useTimer`
- Context access via custom hooks: `useApp()`, `useApi()`

## State Management

- Actions are `SCREAMING_SNAKE_CASE` strings (e.g., `SET_TIMER`, `RESET_TIMER`)
- State updates are always immutable (spread operator)
- Side effects happen in `useEffect` or async callbacks, never in the reducer
- Loading and error states are part of `AppState`

## File Organization

- One component per file, named export matching filename
- Tests in `__tests__/` directories adjacent to source
- API types in `src/api/types.ts` (single file, all domain types)
- No barrel files (no `index.ts` re-exports)

## Tauri Integration

- Tauri commands invoked via `invoke()` from `@tauri-apps/api/core`
- Tauri events via `listen()` from `@tauri-apps/api/event`
- Window API via `getCurrentWindow()` from `@tauri-apps/api/window`
- Store plugin for persistence (auth, timer, flex config)
- HTTP plugin with `unsafe-headers` feature for Origin header override

## Date Handling

- Dates as `YYYY-MM-DD` strings (not Date objects) for API/storage
- Timestamps as ISO strings for timer start/end
- Local dates used (not UTC) to avoid timezone issues
- Week utilities in `src/utils/week.ts` (Monday-start weeks)

## Error Handling

- API errors shown via error banner (`SET_ERROR` action)
- Failed saves marked `syncStatus: "unsaved"` on entries
- Auth failures trigger logout with "Session expired" message
- Background operations (flex, holidays, billable flags) fail silently with `.catch(() => {})`
- Cancellation pattern: `let cancelled = false` with cleanup in `useEffect` return

## Naming

- Components: PascalCase files and exports (e.g., `TimeEntryList.tsx`)
- Hooks: camelCase with `use` prefix (e.g., `useTimer.ts`)
- Utils: camelCase files and functions (e.g., `flex.ts`, `calculateFlex()`)
- Store files: kebab-case (e.g., `timer-store.ts`, `flex-store.ts`)
- API files: kebab-case (e.g., `auth-manager.ts`, `mock-core.ts`)
- Test files: `*.test.ts` in `__tests__/` directories
