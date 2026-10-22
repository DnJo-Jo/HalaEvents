import { z } from "zod";
import type { IntegrationResult } from "../provenance";

/**
 * Weather (event.md §25). A FORECAST is planning context only. It is not an official weather
 * warning or emergency alert, and nothing in HalaEvents presents it as one.
 */
export const DailyForecastSchema = z.object({
  date: z.iso.date(),
  tempMinC: z.number().min(-90).max(70),
  tempMaxC: z.number().min(-90).max(70),
  precipitationProbabilityPct: z.number().min(0).max(100).nullable(),
  windMaxKmh: z.number().min(0).max(500).nullable(),
});
export type DailyForecast = z.infer<typeof DailyForecastSchema>;

export interface ForecastRequest {
  latitude: number;
  longitude: number;
  /** Inclusive range, YYYY-MM-DD, at most 16 days (provider horizon). */
  startDate: string;
  endDate: string;
}

export interface WeatherProvider {
  readonly name: "mock" | "open-meteo";
  readonly isMock: boolean;
  forecast(req: ForecastRequest): Promise<IntegrationResult<DailyForecast[]>>;
}

export const FORECAST_DISCLAIMER =
  "Forecast for planning only — not an official weather warning. Check the national meteorological service for alerts.";
