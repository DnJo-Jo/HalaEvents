import { z } from "zod";

export const Uuid = z.uuid();

export const Email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: "Enter a valid email address." }).max(254));

export const IanaTimezone = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return tz.length <= 64;
    } catch {
      return false;
    }
  },
  { message: "Unknown timezone." },
);

/** Optional free-text field from a form: empty string → undefined. */
export const optionalText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(max).optional(),
  );

export const Phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 ()-]{5,19}$/, {
    message: "Enter a valid phone number, e.g. +971 50 123 4567.",
  });

export const CurrencyCode = z
  .string()
  .regex(/^[A-Z]{3}$/, { message: "Use a 3-letter currency code." });

const blankToUndefined = (v: unknown) =>
  v === null || (typeof v === "string" && v.trim() === "") ? undefined : v;

/** Optional number from a form field ("" → undefined, "12" → 12). */
export const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess(blankToUndefined, z.coerce.number().pipe(schema).optional());

/** Optional integer from a form field. */
export const optionalInt = (min: number, max: number) =>
  optionalNumber(z.number().int().min(min).max(max));

/** Comma/newline-separated list from a textarea → trimmed, de-duplicated, bounded array. */
export const textList = (maxItems: number, maxLength = 80) =>
  z.preprocess(
    (v) =>
      Array.isArray(v)
        ? v
        : typeof v === "string"
          ? v
              .split(/[,\n]/)
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
    z
      .array(z.string().max(maxLength))
      .max(maxItems)
      .transform((a) => [...new Set(a)]),
  );

/**
 * A datetime-local form value ("2026-12-01T09:00") interpreted in an IANA timezone, or an ISO
 * string with offset. Returns an ISO UTC string.
 */
export function zonedDateTime(timeZone = "Asia/Dubai") {
  return z.string().transform((value, ctx) => {
    const iso = toUtcIso(value, timeZone);
    if (!iso) {
      ctx.addIssue({ code: "custom", message: "Enter a valid date and time." });
      return z.NEVER;
    }
    return iso;
  });
}

export function toUtcIso(value: string, timeZone: string): string | null {
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  // Interpret the wall-clock time in `timeZone`: guess UTC, then correct by the zone offset.
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offset = zoneOffsetMs(guess, timeZone);
  const result = new Date(guess - offset);
  return Number.isNaN(result.getTime()) ? null : result.toISOString();
}

function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - utcMs;
}

/** HTML checkbox: present ("on") → true, absent → false. */
export const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());
