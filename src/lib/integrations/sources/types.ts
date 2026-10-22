import { z } from "zod";
import type { IntegrationResult } from "../provenance";

/**
 * Official-source retrieval (event.md §25, §19). HalaEvents does NOT monitor government portals.
 * `retrieve` fetches ONE curated knowledge source on request; the result is a snapshot with a
 * retrieval time. It is never evidence that a requirement is verified: a person with the
 * reviewer role still reads the source and decides (§19).
 */
export const SourceSnapshotSchema = z.object({
  sourceId: z.string().min(1).max(100),
  url: z.url().max(500),
  title: z.string().max(300),
  /** Plain text, length-capped. Never rendered as HTML. */
  excerpt: z.string().max(4_000),
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type SourceSnapshot = z.infer<typeof SourceSnapshotSchema>;

export interface SourceRetriever {
  readonly name: "mock" | "none";
  readonly isMock: boolean;
  retrieve(sourceId: string): Promise<IntegrationResult<SourceSnapshot>>;
}
