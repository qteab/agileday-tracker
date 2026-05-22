# Conventions & Patterns

## TypeScript

- **Strict mode** with `noUnusedLocals`, `noUnusedParameters` enabled
- **Target**: ES2021, **Module**: ESNext (bundler resolution)
- `type` imports used consistently (`import type { Foo }`)
- No `any` — explicit types everywhere
- Unused function params prefixed with `_` (ESLint rule)

## Code Style (Prettier)

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "es5",
  "printWidth": 100,
  "tabWidth": 2
}
```

- Double quotes for strings
- Semicolons required
- Trailing commas in ES5-valid positions
- 100-char line width

## ESLint

- Uses `typescript-eslint` recommended config
- Ignores: `dist/`, `src-tauri/`, `node_modules/`
- `@typescript-eslint/no-unused-vars` with `argsIgnorePattern: "^_"` and `varsIgnorePattern: "^_"`

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
