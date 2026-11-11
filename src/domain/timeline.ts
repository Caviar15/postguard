/** Calendar day (YYYY-MM-DD) of an instant in an IANA timezone. */
export function calendarDay(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

export function addCalendarDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

/**
 * One axis for the week. When every post's channel reported the same timezone,
 * that zone is the axis. Otherwise the axis is UTC and the label says so.
 */
export function timelineZone(timeZones: Array<string | null | undefined>): { zone: string; label: string } {
  if (timeZones.length === 0) return { zone: "UTC", label: "UTC" };
  const first = timeZones[0];
  if (first && timeZones.every((zone) => zone === first)) return { zone: first, label: first };
  return { zone: "UTC", label: "UTC" };
}
