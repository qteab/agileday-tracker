import { load } from "@tauri-apps/plugin-store";

export interface VacationConfig {
  startDate: string; // YYYY-MM-DD — vacation counting starts the day AFTER this
  initialDays: number; // vacation day balance as of startDate (from the payslip)
  projectId: string; // AgileDay project whose entries count as vacation
}

const VACATION_STORE_FILE = "vacation.json";
const VACATION_KEY = "vacationConfig";

let storeInstance: Awaited<ReturnType<typeof load>> | null = null;

async function getStore() {
  if (!storeInstance) {
    storeInstance = await load(VACATION_STORE_FILE, { autoSave: true, defaults: {} });
  }
  return storeInstance;
}

export async function loadVacationConfig(): Promise<VacationConfig | null> {
  const store = await getStore();
  return (await store.get<VacationConfig>(VACATION_KEY)) ?? null;
}

export async function saveVacationConfig(config: VacationConfig): Promise<void> {
  const store = await getStore();
  await store.set(VACATION_KEY, config);
  await store.save();
}

export async function clearVacationConfig(): Promise<void> {
  const store = await getStore();
  await store.delete(VACATION_KEY);
  await store.save();
}
