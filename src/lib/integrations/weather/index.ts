import "server-only";
import { parseServerEnv } from "@/lib/env.server";
import { createMockWeather } from "./mock";
import { createOpenMeteoWeather } from "./open-meteo";
import type { WeatherProvider } from "./types";

export function getWeatherProvider(): WeatherProvider {
  return parseServerEnv().WEATHER_PROVIDER === "open-meteo"
    ? createOpenMeteoWeather()
    : createMockWeather();
}
