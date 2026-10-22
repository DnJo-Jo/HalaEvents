import { describe, expect, it } from "vitest";
import { generate } from "@/lib/ai/client";
import { createGeminiProvider } from "@/lib/ai/gemini";
import { PLAN_SYSTEM, planPrompt } from "@/modules/ai/prompts";
import { evidenceCatalog, missingInformation, planContext, validatePlan } from "@/modules/ai/rules";
import { PlanOutput } from "@/modules/ai/schemas";
import { answerContext, eventContext, interviewState } from "@/modules/events/interview-rules";
import type { EventRow } from "@/modules/events/repo";
import { playbookFor } from "@/playbooks";

// REAL Gemini call: uses quota on the configured Google AI Studio key. Run only on purpose:
//   npm run test:ai-live          (key + model from .env.local or the shell)
// Skipped when GEMINI_API_KEY or GEMINI_MODEL is unset. The key is never printed.

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL;

describe.skipIf(!apiKey || !model)("Gemini live smoke test", () => {
  it("returns a schema-valid plan that passes HalaEvents' rules", async () => {
    const start = new Date(Date.now() + 60 * 86_400_000);
    const event: EventRow = {
      id: "00000000-0000-4000-8000-000000000001",
      owner_id: "00000000-0000-4000-8000-000000000002",
      name: "Live test",
      event_type: "university_hackathon",
      status: "planning",
      venue_type: "indoor",
      location_text: null,
      city: "Dubai",
      country: "AE",
      timezone: "Asia/Dubai",
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + 24 * 3_600_000).toISOString(),
      capacity: 120,
      budget_amount: 20000,
      currency: "AED",
    };
    const playbook = playbookFor("university_hackathon");
    const ectx = eventContext(event);
    const state = interviewState(playbook, ectx, {
      "audience.level": "university_students",
      "audience.multi_institution": true,
      "format.team_size": 4,
      "format.overnight": false,
      "venue.on_campus": true,
      "venue.campus_booking": "requested",
      "catering.provided": true,
      "catering.dietary": ["halal", "vegetarian"],
      "prizes.offered": true,
      "prizes.kind": ["cash"],
      "sponsors.expected": true,
      "ip.ownership": "participants",
      "media.photography": false,
      "accessibility.ask_needs": true,
    });
    const actx = answerContext(ectx, state);
    const pctx = planContext(event, evidenceCatalog(playbook, actx, state));
    const { prompt } = planPrompt(
      event,
      playbook,
      actx,
      state,
      pctx,
      missingInformation(playbook, actx),
    );

    const result = await generate(createGeminiProvider({ apiKey: apiKey!, model: model! }), {
      pipeline: "plan",
      system: PLAN_SYSTEM,
      prompt,
      schema: PlanOutput,
      validate: (p) => validatePlan(p, pctx),
      timeoutMs: 90_000,
    });
    // Outcome summary only (no prompt, no output text, no key).
    console.info(
      JSON.stringify({
        ok: result.ok,
        error: result.ok ? undefined : result.error.code,
        model: result.model,
        attempts: result.attempts,
        latencyMs: result.latencyMs,
        usage: result.usage,
        tasks: result.ok ? result.data.tasks.length : 0,
      }),
    );
    expect(result.ok, result.ok ? "" : `${result.error.code}: ${result.error.message}`).toBe(true);
  });
});
