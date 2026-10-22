import { z } from "zod";
import type { IntegrationResult } from "../provenance";

/**
 * Venue discovery (event.md §25). A discovered place is a LEAD. It says nothing about whether the
 * venue is available, accepts events, or has agreed to anything: availability only comes from a
 * venue provider's own answer to a booking request in HalaEvents.
 */
export const PlaceCandidateSchema = z.object({
  placeId: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  address: z.string().max(300).nullable(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  /** Always "unknown": discovery cannot establish availability. */
  availability: z.literal("unknown"),
});
export type PlaceCandidate = z.infer<typeof PlaceCandidateSchema>;

export interface PlaceSearchRequest {
  city: string;
  /** Free text such as "conference hall"; length-bounded before it reaches a provider. */
  query: string;
  limit?: number;
}

export interface PlacesProvider {
  readonly name: "mock" | "none" | "google";
  readonly isMock: boolean;
  search(req: PlaceSearchRequest): Promise<IntegrationResult<PlaceCandidate[]>>;
}

export const PLACES_DISCLAIMER =
  "Discovery result — availability and suitability are not confirmed. Ask the venue.";
