import { createHash } from "node:crypto";

/** JSON with object keys sorted, so equal inputs always produce the same string. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** sha256 of the canonical input: identical requests are recognised and not sent to the model again. */
export function inputHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}
