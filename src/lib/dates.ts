/** Formats an ISO timestamp in an IANA timezone, e.g. "Tue 1 Dec 2026, 09:00 (Asia/Dubai)". */
export function formatInZone(
  iso: string,
  timeZone: string,
  opts: { zoneLabel?: boolean } = {},
): string {
  const text = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
  return opts.zoneLabel === false ? text : `${text} (${timeZone})`;
}

export function formatDate(iso: string, timeZone = "Asia/Dubai"): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

/** ISO timestamp → value for <input type="datetime-local"> in the given timezone. */
export function toLocalInput(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
