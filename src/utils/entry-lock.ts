import type { TimeEntryStatus } from "../api/types";

/**
 * Whether an entry is beyond editing from inside the app.
 *
 * APPROVED is always locked — a manager signed it off. SUBMITTED is only a
 * workflow state, so while auto-submit is on (which submits every week the app
 * writes to) it must stay editable, or the app would lock the user out of
 * everything it just saved.
 */
export function isEntryLocked(
  entry: { status: TimeEntryStatus },
  autoSubmit: boolean
): boolean {
  if (entry.status === "APPROVED") return true;
  if (entry.status === "SUBMITTED") return !autoSubmit;
  return false;
}
