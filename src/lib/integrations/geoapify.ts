import "server-only";
import { z } from "zod";
import type { VendorCategory } from "./vendor-categories";

/**
 * Geoapify (geocoding + places) over fetch; the key is sent only in the x-api-key header, on the
 * server, and never logged. One request per call, no retries. Responses are validated before use:
 * a place without a usable id, name and coordinates is dropped, optional fields stay null.
 * Results are candidate businesses from OpenStreetMap-based data, not confirmed event vendors.
 */

const BASE = "https://api.geoapify.com";
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 512 * 1024;

/** Geoapify place categories searched for each service (verified against the live API). */
export const GEOAPIFY_CATEGORIES: Record<VendorCategory, string> = {
  venue: "activity.events_venue",
  catering: "catering.restaurant",
  transport: "rental.car",
};

export type GeoErrorCode = "not_configured" | "auth_failed" | "rate_limited" | "timeout" | "failed";
export class GeoapifyError extends Error {
  constructor(readonly code: GeoErrorCode) {
    super(code);
  }
}

export interface VendorCandidate {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  latitude: number;
  longitude: number;
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
  label: string;
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .transform((s) => (s.length > max ? s.slice(0, max) : s))
    .nullish()
    .catch(null)
    .transform((v) => v ?? null);

const Properties = z.object({
  place_id: z.string().trim().min(1).max(400),
  name: text(200),
  address_line1: text(200),
  formatted: text(400),
  phone: text(60),
  website: text(500),
  contact: z
    .object({ phone: text(60), website: text(500) })
    .nullish()
    .catch(null),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
const PlacesResponse = z.object({ features: z.array(z.object({ properties: z.unknown() })) });
const GeocodeResponse = z.object({
  results: z.array(
    z.object({
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
      formatted: z.string().optional(),
    }),
  ),
});

const httpUrl = (v: string | null) => (v && /^https?:\/\//i.test(v) ? v : null);

/** Pure: GeoJSON features → vendor candidates (invalid features are skipped, duplicates removed). */
export function normalizePlaces(json: unknown, limit = 3): VendorCandidate[] {
  const parsed = PlacesResponse.safeParse(json);
  if (!parsed.success) throw new GeoapifyError("failed");
  const out: VendorCandidate[] = [];
  const seen = new Set<string>();
  for (const f of parsed.data.features) {
    const p = Properties.safeParse(f.properties);
    if (!p.success || seen.has(p.data.place_id)) continue;
    const name = p.data.name ?? p.data.address_line1;
    if (!name) continue;
    seen.add(p.data.place_id);
    out.push({
      id: p.data.place_id,
      name,
      address: p.data.formatted,
      phone: p.data.contact?.phone ?? p.data.phone,
      website: httpUrl(p.data.website ?? p.data.contact?.website ?? null),
      latitude: p.data.lat,
      longitude: p.data.lon,
    });
    if (out.length === limit) break;
  }
  return out;
}

async function get(
  url: URL,
  apiKey: string | undefined,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  if (!apiKey) throw new GeoapifyError("not_configured");
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { "x-api-key": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    throw new GeoapifyError(
      (e as { name?: string } | null)?.name === "TimeoutError" ? "timeout" : "failed",
    );
  }
  if (res.status === 401 || res.status === 403) throw new GeoapifyError("auth_failed");
  if (res.status === 429) throw new GeoapifyError("rate_limited");
  if (!res.ok) throw new GeoapifyError("failed");
  try {
    const body = await res.text();
    if (body.length > MAX_BYTES) throw new Error("too large");
    return JSON.parse(body);
  } catch {
    throw new GeoapifyError("failed");
  }
}

/** The first match for a free-text location, or null when nothing was found. */
export async function geocode(
  query: string,
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<GeoPoint | null> {
  const url = new URL("/v1/geocode/search", BASE);
  url.searchParams.set("text", query);
  url.searchParams.set("limit", "1");
  url.searchParams.set("format", "json");
  const parsed = GeocodeResponse.safeParse(await get(url, apiKey, fetchImpl));
  if (!parsed.success) throw new GeoapifyError("failed");
  const hit = parsed.data.results[0];
  return hit ? { latitude: hit.lat, longitude: hit.lon, label: hit.formatted ?? query } : null;
}

export async function searchPlaces(
  category: VendorCategory,
  at: { latitude: number; longitude: number },
  radiusMeters: number,
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<VendorCandidate[]> {
  const url = new URL("/v2/places", BASE);
  url.searchParams.set("categories", GEOAPIFY_CATEGORIES[category]);
  url.searchParams.set("filter", `circle:${at.longitude},${at.latitude},${radiusMeters}`);
  url.searchParams.set("bias", `proximity:${at.longitude},${at.latitude}`);
  url.searchParams.set("limit", "3");
  return normalizePlaces(await get(url, apiKey, fetchImpl));
}
