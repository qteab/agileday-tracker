import type { ThemeMode } from "../store/display-store";

export type ResolvedTheme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia(DARK_QUERY).matches;
}

/** Collapse the user's preference into the concrete theme to render. */
export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === "system") return systemPrefersDark() ? "dark" : "light";
  return mode;
}

/**
 * Apply the resolved theme to the document. The `dark` class on <html> is what
 * the `:root.dark` CSS variable overrides in index.css hook into; `colorScheme`
 * keeps native form controls and scrollbars in step.
 */
export function applyTheme(mode: ThemeMode): void {
  const resolved = resolveTheme(mode);
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

/** Notify when the OS appearance changes — only meaningful while mode is "system". */
export function watchSystemTheme(onChange: () => void): () => void {
  const mql = window.matchMedia(DARK_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}
