/** Split an AgileDay description string into individual lines. */
export function splitDescriptions(description: string): string[] {
  if (!description.trim()) return [];
  return description
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (l.startsWith("- ") ? l.slice(2) : l));
}

/** Join description lines back into AgileDay's bullet format. */
export function joinDescriptions(lines: string[]): string {
  const nonEmpty = lines.filter((l) => l.trim());
  if (nonEmpty.length === 0) return "";
  if (nonEmpty.length === 1) return `- ${nonEmpty[0]}`;
  return nonEmpty.map((l) => `- ${l}`).join("\n");
}
