import { z } from "zod";
import { optionalText } from "@/lib/schemas/common";

export const ComplianceStatus = z.enum([
  "not_assessed",
  "needs_information",
  "conditional",
  "source_supported",
  "under_review",
  "awaiting_official_response",
  "cleared",
  "action_required",
  "rejected",
  "closed",
]);
export type ComplianceStatus = z.infer<typeof ComplianceStatus>;

export const ComplianceCategory = z.enum([
  "permit",
  "venue_policy",
  "minors_safeguarding",
  "food_safety",
  "privacy_media",
  "prizes_finance",
  "health_safety",
  "other",
]);
export type ComplianceCategory = z.infer<typeof ComplianceCategory>;

export const Applicability = z.enum(["unknown", "likely_applies", "applies", "does_not_apply"]);
export type Applicability = z.infer<typeof Applicability>;
export const Severity = z.enum(["info", "concern"]);
export type Severity = z.infer<typeof Severity>;

export const EvidenceKind = z.enum([
  "note",
  "document_reference",
  "reference_number",
  "link",
  "submission_reference",
  "official_response",
]);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

/** Statuses deterministic rules may set (the RPC refuses anything else). */
export const RuleStatus = z.enum(["not_assessed", "needs_information", "conditional"]);

/** One rule result, sent to sync_compliance_checks. */
export const ComplianceItem = z.object({
  topicKey: z
    .string()
    .regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/)
    .max(64),
  category: ComplianceCategory,
  title: z.string().min(3).max(160),
  description: z.string().max(1000),
  reason: z.string().min(3).max(600),
  severity: Severity,
  status: RuleStatus,
  applicability: Applicability,
  nextAction: z.string().max(300),
  channelSourceKey: z.string().optional(),
  sourceKeys: z.array(z.string()).max(6),
});
export type ComplianceItem = z.infer<typeof ComplianceItem>;

// ---- Form inputs ---------------------------------------------------------------------------

const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

export const CreateCheckInput = z
  .object({
    title: z.string().trim().min(3, { message: "Use at least 3 characters." }).max(160),
    category: ComplianceCategory,
    description: optionalText(1000),
    reason: z.string().trim().min(3, { message: "Say why this needs checking." }).max(600),
  })
  .transform((v) => ({
    ...v,
    topicKey: `custom.${/^[a-z]/.test(slug(v.title)) ? slug(v.title) : `c_${slug(v.title)}`}`,
  }));

export const ChangeStatusInput = z.object({
  status: ComplianceStatus,
  reason: optionalText(600),
});

export const UpdateCheckInput = z.object({
  applicability: Applicability,
  nextAction: optionalText(300),
});

export const AssignReviewerInput = z.object({
  reviewerUserId: z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable()),
});

export const EvidenceInput = z
  .object({
    kind: EvidenceKind,
    value: z.string().trim().min(3, { message: "Describe the evidence." }).max(1000),
  })
  .refine((e) => e.kind !== "link" || /^https:\/\/\S+$/.test(e.value), {
    path: ["value"],
    message: "Links must start with https://",
  });

export const ReferenceInput = z.object({
  sourceId: z.uuid({ message: "Choose a source." }),
  note: optionalText(400),
});

export const SourceVerificationInput = z.object({
  verified: z.enum(["true", "false"]).transform((v) => v === "true"),
  note: optionalText(400),
});

export const SimulatedResponseInput = z.object({
  summary: z.string().trim().min(3, { message: "Describe the simulated response." }).max(600),
});
