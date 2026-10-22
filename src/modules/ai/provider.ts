import "server-only";
import { createGeminiProvider } from "@/lib/ai/gemini";
import { createMockProvider } from "@/lib/ai/mock";
import type { AiProvider } from "@/lib/ai/types";
import { parseServerEnv } from "@/lib/env.server";
import { deterministicProposal } from "@/modules/recovery/rules";
import type { Impact, RecoveryProposal } from "@/modules/recovery/schemas";
import type { RecoveryGuidance } from "./playbook";
import type { FollowUpOutput, PlanOutput, TaskProposal, TaskRevisionOutput } from "./schemas";

/**
 * The configured provider: Gemini when AI_PROVIDER=gemini (env validation requires GEMINI_API_KEY
 * and GEMINI_MODEL), otherwise the deterministic mock. There is no silent fallback from Gemini to
 * the mock: a misconfigured Gemini fails at env validation (event.md §8).
 */
let cached: AiProvider | undefined;

export function getAiProvider(): AiProvider {
  if (cached) return cached;
  const env = parseServerEnv();
  cached =
    env.AI_PROVIDER === "gemini"
      ? createGeminiProvider({ apiKey: env.GEMINI_API_KEY!, model: env.GEMINI_MODEL! })
      : createMockProvider(MOCK_FIXTURES);
  return cached;
}

// Mock "model output". Each fixture receives the structured context the service passes.
const MOCK_FOLLOW_UPS: FollowUpOutput["questions"] = [
  {
    key: "custom.judging_format",
    text: "How will teams present their projects to the judges?",
    why: "The presentation format decides the AV setup, room layout and schedule.",
    type: "single_choice",
    options: ["Live demo", "Slides", "Recorded video"],
  },
  {
    key: "custom.wifi_capacity",
    text: "Has the venue confirmed Wi-Fi capacity for every participant?",
    why: "Hackathons fail quickly without reliable internet for all devices.",
    type: "boolean",
    options: [],
  },
];

export const MOCK_FIXTURES = {
  plan: (ctx: unknown) => (ctx as { deterministicPlan: PlanOutput }).deterministicPlan,
  interview: (ctx: unknown): FollowUpOutput => {
    const asked = new Set((ctx as { existingKeys: string[] }).existingKeys);
    const questions = MOCK_FOLLOW_UPS.filter((q) => !asked.has(q.key));
    return { questions, enoughInformation: questions.length === 0 };
  },
  draft_message: (ctx: unknown) => {
    const { kindLabel, eventName } = ctx as { kindLabel: string; eventName: string };
    return {
      subject: `${kindLabel}: {{event_name}}`,
      body:
        `Hello {{name}},\n\nThis is a ${kindLabel.toLowerCase()} for {{event_name}} on {{event_date}} in {{event_city}}.` +
        `\n\n[Mock draft for ${eventName}: replace this text with the details you want to share.]\n\nThe organizing team`,
    };
  },
  recovery: (ctx: unknown): RecoveryProposal => {
    const { impact, today, guidance } = ctx as {
      impact: Impact;
      today: string;
      guidance?: RecoveryGuidance["venueCancellation"];
    };
    return deterministicProposal(impact, today, guidance);
  },
  revise_task: (ctx: unknown): TaskRevisionOutput => {
    const { task, note } = ctx as { task: TaskProposal; note: string };
    return {
      task: { ...task, description: `${task.description} (Mock revision: ${note})`.slice(0, 600) },
      changeSummary: "Mock revision: the request was added to the description.",
    };
  },
};
