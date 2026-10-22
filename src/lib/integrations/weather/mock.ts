import { DailyForecastSchema } from "./types";
import type { WeatherProvider } from "./types";

/** Deterministic fixture: the same dates always give the same "forecast". Not real weather. */
export function createMockWeather(now: () => Date = () => new Date()): WeatherProvider {
  return {
    name: "mock",
    isMock: true,
    async forecast(req) {
      const out = [];
      const start = Date.parse(`${req.startDate}T00:00:00Z`);
      const end = Date.parse(`${req.endDate}T00:00:00Z`);
      for (let t = start, i = 0; t <= end && i < 16; t += 86_400_000, i++) {
        out.push(
          DailyForecastSchema.parse({
            date: new Date(t).toISOString().slice(0, 10),
            tempMinC: 20 + (i % 3),
            tempMaxC: 31 + (i % 4),
            precipitationProbabilityPct: (i * 10) % 40,
            windMaxKmh: 12 + (i % 5),
          }),
        );
      }
      return {
        ok: true,
        data: out,
        provenance: {
          provider: "mock",
          isMock: true,
          retrievedAt: now().toISOString(),
          providerIds: {},
        },
      };
    },
  };
}
