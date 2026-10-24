// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  geocode,
  GeoapifyError,
  GEOAPIFY_CATEGORIES,
  normalizePlaces,
  searchPlaces,
} from "@/lib/integrations/geoapify";

// Geoapify is only ever called through an injected fake fetch here: no test makes a real request.

const feature = (p: Record<string, unknown>) => ({ type: "Feature", properties: p });
const place = (n: number, extra: Record<string, unknown> = {}) =>
  feature({
    place_id: `p${n}`,
    name: `Place ${n}`,
    formatted: `Place ${n}, Dubai`,
    lat: 25.2,
    lon: 55.27,
    ...extra,
  });
const reply = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));
const AT = { latitude: 25.2048, longitude: 55.2708 };
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: GeoapifyError) => e.code,
  );

describe("normalizePlaces", () => {
  it("maps GeoJSON properties to candidates and never invents optional fields", () => {
    const out = normalizePlaces({
      features: [
        place(1, { contact: { phone: "+971 4 123 4567" }, website: "https://one.example" }),
        place(2, { phone: "+971 4 000 0000", contact: { website: "https://two.example" } }),
        place(3),
      ],
    });
    expect(out[0]).toEqual({
      id: "p1",
      name: "Place 1",
      address: "Place 1, Dubai",
      phone: "+971 4 123 4567",
      website: "https://one.example",
      latitude: 25.2,
      longitude: 55.27,
    });
    expect(out[1]).toMatchObject({ phone: "+971 4 000 0000", website: "https://two.example" });
    expect(out[2]).toMatchObject({ phone: null, website: null });
  });

  it("skips unusable features, de-duplicates and caps at three", () => {
    const out = normalizePlaces({
      features: [
        feature({ name: "No id", lat: 1, lon: 1 }),
        feature({ place_id: "x", lat: 1, lon: 1 }), // no name or address line
        feature({ place_id: "y", name: "Bad coords", lat: 200, lon: 1 }),
        place(1),
        place(1),
        place(2, { website: "javascript:alert(1)" }),
        place(3),
        place(4),
      ],
    });
    expect(out.map((v) => v.id)).toEqual(["p1", "p2", "p3"]);
    expect(out[1].website).toBeNull(); // only http(s) links are kept
  });

  it("falls back to the address line when there is no name; empty results are fine", () => {
    expect(
      normalizePlaces({
        features: [feature({ place_id: "z", address_line1: "Hall A", lat: 1, lon: 2 })],
      })[0].name,
    ).toBe("Hall A");
    expect(normalizePlaces({ features: [] })).toEqual([]);
  });

  it("rejects a response that isn't a feature collection", () => {
    expect(() => normalizePlaces({ nope: true })).toThrow(GeoapifyError);
    expect(() => normalizePlaces(null)).toThrow(GeoapifyError);
  });
});

describe("searchPlaces / geocode", () => {
  it("sends the verified request: category, circle filter, bias, limit 3, key in a header", async () => {
    const f = reply({ features: [place(1)] });
    const out = await searchPlaces(
      "catering",
      AT,
      15000,
      "secret-key",
      f as unknown as typeof fetch,
    );
    expect(out).toHaveLength(1);
    const [url, init] = f.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.origin + url.pathname).toBe("https://api.geoapify.com/v2/places");
    expect(url.searchParams.get("categories")).toBe("catering.restaurant");
    expect(url.searchParams.get("filter")).toBe("circle:55.2708,25.2048,15000");
    expect(url.searchParams.get("bias")).toBe("proximity:55.2708,25.2048");
    expect(url.searchParams.get("limit")).toBe("3");
    expect(url.toString()).not.toContain("secret-key");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("secret-key");
  });

  it("maps each service to its category", () => {
    expect(GEOAPIFY_CATEGORIES).toEqual({
      venue: "activity.events_venue",
      catering: "catering.restaurant",
      transport: "rental.car",
    });
  });

  it("geocodes the first match, or null when nothing matches", async () => {
    const hit = reply({ results: [{ lat: 25.2, lon: 55.3, formatted: "Dubai, UAE" }] });
    expect(await geocode("Dubai", "k", hit as unknown as typeof fetch)).toEqual({
      latitude: 25.2,
      longitude: 55.3,
      label: "Dubai, UAE",
    });
    expect(
      await geocode("zzzz", "k", reply({ results: [] }) as unknown as typeof fetch),
    ).toBeNull();
  });

  it("a missing key fails before any request", async () => {
    const f = reply({});
    expect(
      await code(searchPlaces("venue", AT, 5000, undefined, f as unknown as typeof fetch)),
    ).toBe("not_configured");
    expect(await code(geocode("Dubai", undefined, f as unknown as typeof fetch))).toBe(
      "not_configured",
    );
    expect(f).not.toHaveBeenCalled();
  });

  it("maps provider failures to codes without leaking the response", async () => {
    const at = (status: number) =>
      code(
        searchPlaces(
          "venue",
          AT,
          5000,
          "k",
          reply({ message: "secret" }, status) as unknown as typeof fetch,
        ),
      );
    expect(await at(401)).toBe("auth_failed");
    expect(await at(429)).toBe("rate_limited");
    expect(await at(500)).toBe("failed");
    const garbage = vi.fn(async () => new Response("<html>", { status: 200 }));
    expect(
      await code(searchPlaces("venue", AT, 5000, "k", garbage as unknown as typeof fetch)),
    ).toBe("failed");
  });

  it("maps a timeout and a network error", async () => {
    const timeout = vi.fn(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await code(geocode("Dubai", "k", timeout as unknown as typeof fetch))).toBe("timeout");
    expect(await code(geocode("Dubai", "k", down as unknown as typeof fetch))).toBe("failed");
  });
});
