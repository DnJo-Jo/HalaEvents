import type { AiPipeline, AiProvider, ProviderRequest, ProviderResult } from "./types";

/**
 * Deterministic offline provider (`AI_PROVIDER=mock`). Each pipeline has a fixture function that
 * builds the "model output" from the request's structured context, e.g. the playbook-derived plan.
 * Results are stored with `is_mock = true` and labelled "Mock" in the UI.
 */
export type MockFixtures = Partial<Record<AiPipeline, (context: unknown) => unknown>>;

export function createMockProvider(fixtures: MockFixtures, model = "mock-playbook-v1"): AiProvider {
  return {
    name: "mock",
    model,
    isMock: true,
    async generate(req: ProviderRequest): Promise<ProviderResult> {
      const fixture = fixtures[req.pipeline];
      if (!fixture) {
        return {
          ok: false,
          code: "not_configured",
          message: `No mock fixture for ${req.pipeline}.`,
        };
      }
      return {
        ok: true,
        text: JSON.stringify(fixture(req.context)),
        model,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}
