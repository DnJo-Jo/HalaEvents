// @vitest-environment node
import { describe, expect, it } from "vitest";
import { boundedJson } from "@/lib/integrations/provenance";
import { createMockPlaces, createUnavailablePlaces } from "@/lib/integrations/places/mock";
import {
  createMockSourceRetriever,
  createNoSourceRetriever,
} from "@/lib/integrations/sources/mock";
import { createMockWeather } from "@/lib/integrations/weather/mock";
import { createOpenMeteoWeather } from "@/lib/integrations/weather/open-meteo";

const now = () => new Date("2026-10-22T10:00:00Z");
const req = { latitude: 25.2, longitude: 55.27, startDate: "2026-11-01", endDate: "2026-11-03" };
const json = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("mock adapters", () => {
  it("weather is deterministic and flagged mock", async () => {
    const a = await createMockWeather(now).forecast(req);
    const b = await createMockWeather(now).forecast(req);
    expect(a).toEqual(b);
    expect(a.ok && a.data).toHaveLength(3);
    expect(a.provenance).toMatchObject({ isMock: true, provider: "mock" });
  });
  it("places are leads: availability is always unknown", async () => {
    const r = await createMockPlaces(now).search({ city: "Dubai", query: "hall" });
    expect(r.ok && r.data.every((p) => p.availability === "unknown")).toBe(true);
    expect(r.provenance.isMock).toBe(true);
  });
  it("unconfigured places/sources say so instead of faking results", async () => {
    for (const mode of ["none", "google"] as const) {
      const r = await createUnavailablePlaces(mode, now).search({ city: "x", query: "y" });
      expect(r.ok).toBe(false);
      expect(r.provenance.isMock).toBe(false);
    }
    const s = await createNoSourceRetriever(now).retrieve("det-guidance");
    expect(!s.ok && s.error.code).toBe("not_configured");
  });
  it("source mock rejects malformed ids and labels its snapshot", async () => {
    const m = createMockSourceRetriever(now);
    expect((await m.retrieve("../etc/passwd")).ok).toBe(false);
    const ok = await m.retrieve("det-guidance");
    expect(ok.ok && ok.data.excerpt).toContain("MOCK");
    expect(ok.provenance.isMock).toBe(true);
  });
});

describe("open-meteo adapter", () => {
  const body = {
    latitude: 25.2,
    longitude: 55.27,
    daily: {
      time: ["2026-11-01", "2026-11-02"],
      temperature_2m_min: [22, null],
      temperature_2m_max: [33, null],
      precipitation_probability_max: [5, null],
      wind_speed_10m_max: [14, null],
    },
  };
  it("validates the response, skips unforecast days, records provenance", async () => {
    const w = createOpenMeteoWeather({ fetchImpl: json(body), now });
    const r = await w.forecast(req);
    expect(r.ok && r.data).toHaveLength(1);
    expect(r.provenance).toMatchObject({
      provider: "open-meteo",
      isMock: false,
      retrievedAt: "2026-10-22T10:00:00.000Z",
    });
    expect(r.provenance.providerIds.grid).toBe("25.20,55.27");
  });
  it("rejects a malformed provider response", async () => {
    const r = await createOpenMeteoWeather({ fetchImpl: json({ daily: "nope" }), now }).forecast(
      req,
    );
    expect(!r.ok && r.error.code).toBe("invalid_response");
  });
  it("maps HTTP errors and never leaks the URL", async () => {
    const r = await createOpenMeteoWeather({ fetchImpl: json({}, 500), now }).forecast(req);
    expect(!r.ok && r.error.code).toBe("rejected");
    expect(JSON.stringify(r)).not.toContain("api.open-meteo.com");
    const limited = await createOpenMeteoWeather({ fetchImpl: json({}, 429), now }).forecast(req);
    expect(!limited.ok && limited.error.code).toBe("rate_limited");
  });
  it("does not call out for invalid coordinates or reversed dates", async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      return new Response("{}");
    }) as unknown as typeof fetch;
    const w = createOpenMeteoWeather({ fetchImpl: f, now });
    expect((await w.forecast({ ...req, latitude: 999 })).ok).toBe(false);
    expect((await w.forecast({ ...req, startDate: "2026-12-01" })).ok).toBe(false);
    expect(calls).toBe(0);
  });
  it("turns network failure into a safe error", async () => {
    const f = (async () => {
      throw new Error("ECONNREFUSED secret-host");
    }) as unknown as typeof fetch;
    const r = await createOpenMeteoWeather({ fetchImpl: f, now }).forecast(req);
    expect(!r.ok && r.error.code).toBe("unreachable");
    expect(JSON.stringify(r)).not.toContain("secret-host");
  });
});

describe("boundedJson", () => {
  it("refuses oversized bodies", async () => {
    const big = (async () => new Response("x".repeat(300 * 1024))) as unknown as typeof fetch;
    const r = await boundedJson(big, "https://example.test/");
    expect(!r.ok && r.error.code).toBe("invalid_response");
  });
});
