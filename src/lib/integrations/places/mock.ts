import type { PlaceCandidate, PlacesProvider } from "./types";

const FIXTURES: PlaceCandidate[] = [
  ["mock-place-001", "Mock Convention Hall", "1 Fixture Road"],
  ["mock-place-002", "Mock Campus Auditorium", "2 Fixture Road"],
  ["mock-place-003", "Mock Rooftop Space", "3 Fixture Road"],
].map(([placeId, name, address], i) => ({
  placeId,
  name,
  address,
  latitude: 25.2 + i * 0.01,
  longitude: 55.27 + i * 0.01,
  availability: "unknown" as const,
}));

/** Deterministic fixtures, not real places. The city and query are ignored on purpose. */
export function createMockPlaces(now: () => Date = () => new Date()): PlacesProvider {
  return {
    name: "mock",
    isMock: true,
    async search(req) {
      return {
        ok: true,
        data: FIXTURES.slice(0, Math.min(req.limit ?? 5, FIXTURES.length)),
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

/** PLACES_PROVIDER=none, or "google" until a Google adapter is built: honest "no discovery". */
export function createUnavailablePlaces(
  name: "none" | "google",
  now: () => Date = () => new Date(),
): PlacesProvider {
  return {
    name,
    isMock: false,
    async search() {
      return {
        ok: false,
        error: {
          code: "not_configured",
          message:
            name === "google"
              ? "Live venue discovery is not implemented yet. Use the provider marketplace."
              : "Venue discovery is turned off. Use the provider marketplace.",
        },
        provenance: {
          provider: name,
          isMock: false,
          retrievedAt: now().toISOString(),
          providerIds: {},
        },
      };
    },
  };
}
