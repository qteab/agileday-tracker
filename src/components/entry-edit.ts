import type { TimeEntry } from "../api/types";

/**
 * Parse a duration input into total minutes.
 * Accepts "H:MM", "H:MM:SS" (seconds ignored), or a plain minute count "90".
 * Returns null for invalid or negative input.
 */
export function parseDurationInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.includes(":")) {
    const parts = trimmed.split(":");
    if (parts.length < 2 || parts.length > 3) return null;
    const nums = parts.map((p) => (p.trim() === "" ? NaN : Number(p)));
    if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
    const [h, m] = nums;
    if (!Number.isInteger(h) || !Number.isInteger(m) || m > 59) return null;
    return h * 60 + m;
  }

  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n;
}

/** Format minutes as "H:MM" for an inline duration input. */
export function formatDurationInput(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/**
 * Compute the result of editing the time on a card whose timer is running.
 * The entered value becomes the new banked total and the timer start is reset
 * to "now", so the clock snaps to the entered value and keeps counting up.
 */
export function computeRunningTimeEdit(enteredMinutes: number): {
  bankedMinutes: number;
  resetStart: boolean;
} {
  return { bankedMinutes: Math.max(0, enteredMinutes), resetStart: true };
}

/** True if the entry exists only locally and was never persisted to AgileDay. */
export function isLocalOnlyEntry(entry: Pick<TimeEntry, "id">): boolean {
  return entry.id.startsWith("local-");
}

/**
 * Task ids already in use for a given (projectId, date), excluding the card
 * being edited (selfId). Used to filter the inline task picker so a colliding
 * (project, task, date) combination can never be selected.
 */
export function usedTaskIds(
  entries: TimeEntry[],
  selfId: string,
  projectId: string,
  date: string
): Set<string> {
  const used = new Set<string>();
  for (const e of entries) {
    if (e.id === selfId) continue;
    if (e.projectId !== projectId || e.date !== date) continue;
    if (e.taskId) used.add(e.taskId);
  }
  return used;
}
