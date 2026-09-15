import { load } from "@tauri-apps/plugin-store";

/**
 * Which AgileDay surface the app talks to.
 *
 * - `rest` — the original REST client. Currently non-functional: AgileDay
 *   withdrew REST-audience token issuance from OAuth, so every endpoint
 *   answers 401. Kept as the default so the switch is a deliberate act and so
 *   the app returns to normal the moment REST access comes back.
 * - `mcp` — the beta client, speaking AgileDay's MCP interface, which is the
 *   only surface current OAuth tokens open.
 */
export type ApiBackend = "rest" | "mcp";

export interface BetaPrefs {
  apiBackend: ApiBackend;
}

export const DEFAULT_BETA_PREFS: BetaPrefs = {
  apiBackend: "rest",
};

const BETA_STORE_FILE = "beta.json";
const BETA_KEY = "betaPrefs";

let storeInstance: Awaited<ReturnType<typeof load>> | null = null;

async function getStore() {
  if (!storeInstance) {
    storeInstance = await load(BETA_STORE_FILE, { autoSave: true, defaults: {} });
  }
  return storeInstance;
}

function isApiBackend(value: unknown): value is ApiBackend {
  return value === "rest" || value === "mcp";
}

export async function loadBetaPrefs(): Promise<BetaPrefs> {
  const store = await getStore();
  const saved = await store.get<Partial<BetaPrefs>>(BETA_KEY);
  if (!saved) return { ...DEFAULT_BETA_PREFS };
  return {
    apiBackend: isApiBackend(saved.apiBackend) ? saved.apiBackend : DEFAULT_BETA_PREFS.apiBackend,
  };
}

export async function saveBetaPrefs(prefs: BetaPrefs): Promise<void> {
  const store = await getStore();
  await store.set(BETA_KEY, prefs);
  await store.save();
}
