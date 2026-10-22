import "server-only";
import { parseServerEnv } from "@/lib/env.server";
import { createMockPlaces, createUnavailablePlaces } from "./mock";
import type { PlacesProvider } from "./types";

export function getPlacesProvider(): PlacesProvider {
  const mode = parseServerEnv().PLACES_PROVIDER;
  return mode === "mock" ? createMockPlaces() : createUnavailablePlaces(mode);
}
