/**
 * Format an idle/away duration (in seconds) as "Hh Mm", flooring to the minute.
 * Used by the inactivity banner and the tray "You've been inactive for …" text.
 */
export function formatAway(seconds: number): string {
  const totalMinutes = Math.floor(Math.max(0, seconds) / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
}

/**
 * "Discard idle time": shift a running timer's startTime forward by the away
 * duration so the idle stretch is excluded from the elapsed total (and from
 * what gets saved to AgileDay on stop).
 */
export function computeDiscardStartTime(startTimeIso: string, awaySeconds: number): string {
  const shifted = new Date(startTimeIso).getTime() + Math.max(0, awaySeconds) * 1000;
  return new Date(shifted).toISOString();
}
