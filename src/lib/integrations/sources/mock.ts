import { createHash } from "node:crypto";
import type { SourceRetriever } from "./types";

/** Fixture snapshots keyed by the curated source ids; text is clearly placeholder content. */
export function createMockSourceRetriever(now: () => Date = () => new Date()): SourceRetriever {
  return {
    name: "mock",
    isMock: true,
    async retrieve(sourceId) {
      const provenance = {
        provider: "mock",
        isMock: true,
        retrievedAt: now().toISOString(),
        providerIds: {},
      };
      if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(sourceId))
        return {
          ok: false,
          error: { code: "rejected", message: "Unknown source id." },
          provenance,
        };
      const excerpt = `MOCK snapshot for "${sourceId}". This is placeholder text, not the content of an official page.`;
      return {
        ok: true,
        data: {
          sourceId,
          url: `https://example.invalid/mock/${sourceId}`,
          title: `Mock snapshot: ${sourceId}`,
          excerpt,
          contentSha256: createHash("sha256").update(excerpt).digest("hex"),
        },
        provenance,
      };
    },
  };
}

/** Default when nothing is configured: says so instead of pretending a portal is being watched. */
export function createNoSourceRetriever(now: () => Date = () => new Date()): SourceRetriever {
  return {
    name: "none",
    isMock: false,
    async retrieve() {
      return {
        ok: false,
        error: {
          code: "not_configured",
          message:
            "Official sources are not retrieved automatically. Open the source and review it yourself.",
        },
        provenance: {
          provider: "none",
          isMock: false,
          retrievedAt: now().toISOString(),
          providerIds: {},
        },
      };
    },
  };
}
