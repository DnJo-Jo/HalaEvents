import { z } from "zod";
import { boundedJson } from "../provenance";
import { DailyForecastSchema, type WeatherProvider } from "./types";

const API = "https://api.open-meteo.com/v1/forecast";

const ResponseSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  daily: z.object({
    time: z.array(z.iso.date()).max(16),
    temperature_2m_min: z.array(z.number().nullable()),
    temperature_2m_max: z.array(z.number().nullable()),
    precipitation_probability_max: z.array(z.number().nullable()),
    wind_speed_10m_max: z.array(z.number().nullable()),
  }),
});

/**
 * Open-Meteo (WEATHER_PROVIDER=open-meteo): no API key, plain fetch. The one narrow live
 * integration of phase 9. Coordinates and dates are validated before they enter the URL.
 */
export function createOpenMeteoWeather(
  opts: { fetchImpl?: typeof fetch; now?: () => Date } = {},
): WeatherProvider {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => new Date());
  return {
    name: "open-meteo",
    isMock: false,
    async forecast(req) {
      const prov = (extra: object = {}) => ({
        provider: "open-meteo",
        isMock: false,
        retrievedAt: now().toISOString(),
        sourceUrl: "https://open-meteo.com/",
        providerIds: {},
        ...extra,
      });
      const input = z
        .object({
          latitude: z.number().min(-90).max(90),
          longitude: z.number().min(-180).max(180),
          startDate: z.iso.date(),
          endDate: z.iso.date(),
        })
        .safeParse(req);
      if (!input.success || input.data.startDate > input.data.endDate)
        return {
          ok: false,
          error: { code: "rejected", message: "Invalid forecast request." },
          provenance: prov(),
        };
      const q = new URLSearchParams({
        latitude: String(input.data.latitude),
        longitude: String(input.data.longitude),
        start_date: input.data.startDate,
        end_date: input.data.endDate,
        daily:
          "temperature_2m_min,temperature_2m_max,precipitation_probability_max,wind_speed_10m_max",
        timezone: "auto",
      });
      const res = await boundedJson(fetchImpl, `${API}?${q}`);
      if (!res.ok) return { ok: false, error: res.error, provenance: prov() };
      const parsed = ResponseSchema.safeParse(res.json);
      if (!parsed.success)
        return {
          ok: false,
          error: { code: "invalid_response", message: "The provider's answer was not usable." },
          provenance: prov(),
        };
      const d = parsed.data.daily;
      const days = [];
      for (let i = 0; i < d.time.length; i++) {
        const min = d.temperature_2m_min[i];
        const max = d.temperature_2m_max[i];
        if (min == null || max == null) continue; // skip days the provider could not forecast
        const day = DailyForecastSchema.safeParse({
          date: d.time[i],
          tempMinC: min,
          tempMaxC: max,
          precipitationProbabilityPct: d.precipitation_probability_max[i] ?? null,
          windMaxKmh: d.wind_speed_10m_max[i] ?? null,
        });
        if (day.success) days.push(day.data);
      }
      return {
        ok: true,
        data: days,
        provenance: prov({
          providerIds: {
            grid: `${parsed.data.latitude.toFixed(2)},${parsed.data.longitude.toFixed(2)}`,
          },
        }),
      };
    },
  };
}
