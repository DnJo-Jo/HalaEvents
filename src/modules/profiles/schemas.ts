import { z } from "zod";
import {
  CurrencyCode,
  Phone,
  optionalInt,
  optionalNumber,
  optionalText,
  textList,
} from "@/lib/schemas/common";

// Status/role enums are the TypeScript source of truth; migrations repeat them in CHECK
// constraints and tests/db/enums.test.ts asserts both lists match.

/** Self-service account roles. Platform administrator is intentionally not one of them. */
export const AccountRole = z.enum(["organizer", "venue_provider", "service_provider"]);
export type AccountRole = z.infer<typeof AccountRole>;

export const ACCOUNT_ROLE_LABELS: Record<AccountRole, { label: string; description: string }> = {
  organizer: { label: "Organizer", description: "Plan and run events." },
  venue_provider: { label: "Venue provider", description: "List a venue and receive requests." },
  service_provider: {
    label: "Service provider",
    description: "Offer catering, AV, security, photography and more.",
  },
};

/** Moderation state of a member account — independent of provider verification. */
export const AccountStatus = z.enum(["active", "suspended", "deactivated"]);
export type AccountStatus = z.infer<typeof AccountStatus>;

export const Locale = z.enum(["en", "ar"]);

export const DisplayName = z
  .string()
  .trim()
  .min(1, { message: "Enter your name." })
  .max(80, { message: "Use at most 80 characters." });

const optionalPhone = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  Phone.optional(),
);

export const OnboardingInput = z.object({
  displayName: DisplayName,
  phone: optionalPhone,
  locale: Locale.default("en"),
  roles: z
    .array(AccountRole)
    .min(1, { message: "Choose at least one way you'll use HalaEvents." })
    .max(3)
    .transform((r) => [...new Set(r)]),
});
export type OnboardingInput = z.infer<typeof OnboardingInput>;

export const ProfileUpdateInput = z.object({
  displayName: DisplayName,
  phone: optionalPhone,
  locale: Locale,
});
export type ProfileUpdateInput = z.infer<typeof ProfileUpdateInput>;

export const ProviderKind = z.enum(["venue", "service"]);
export const ProviderCategory = z.enum([
  "venue",
  "catering",
  "av",
  "security",
  "photography",
  "decor",
  "transport",
  "cleaning",
  "other",
]);
export type ProviderCategory = z.infer<typeof ProviderCategory>;

/** Business verification by platform admins (is this a real, checked business?). */
export const ProviderVerificationStatus = z.enum(["draft", "submitted", "verified", "rejected"]);
export type ProviderVerificationStatus = z.infer<typeof ProviderVerificationStatus>;

/** Listing moderation by platform admins — separate from verification and from account status. */
export const ProviderModerationStatus = z.enum(["active", "hidden", "suspended"]);
export type ProviderModerationStatus = z.infer<typeof ProviderModerationStatus>;
export const ProviderMemberRole = z.enum(["owner", "staff"]);

export const PricingModel = z.enum([
  "per_person",
  "per_hour",
  "per_day",
  "per_event",
  "quote_only",
]);
export type PricingModel = z.infer<typeof PricingModel>;

export const VenueSetting = z.enum(["indoor", "outdoor", "mixed"]);
export const Accessibility = z.enum([
  "step_free",
  "accessible_toilets",
  "lift",
  "hearing_loop",
  "accessible_parking",
]);
export const Suitability = z.enum([
  "hackathon",
  "conference",
  "workshop",
  "exhibition",
  "social",
  "ceremony",
]);
export const DocumentKind = z.enum([
  "trade_license",
  "insurance",
  "food_safety",
  "security_license",
  "venue_permit",
  "other",
]);
export const DocumentReviewStatus = z.enum(["submitted", "accepted", "rejected"]);

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** Business profile (create and edit). Prices are indicative, never a quote. */
export const ProviderProfileInput = z
  .object({
    kind: ProviderKind,
    category: ProviderCategory,
    name: z.string().trim().min(2, { message: "Use at least 2 characters." }).max(120),
    description: optionalText(2000),
    city: optionalText(80),
    serviceArea: textList(50),
    pricingModel: PricingModel.default("quote_only"),
    minCapacity: optionalInt(1, 100000),
    maxCapacity: optionalInt(1, 100000),
    priceMin: optionalNumber(z.number().nonnegative().max(10_000_000)),
    priceMax: optionalNumber(z.number().nonnegative().max(10_000_000)),
    currency: CurrencyCode.default("AED"),
    capabilities: textList(40),
    availabilityNote: optionalText(500),
    website: z.preprocess(
      blank,
      z
        .url({ protocol: /^https$/, message: "Use a full https:// address." })
        .max(200)
        .optional(),
    ),
    contactEmail: z.preprocess(
      blank,
      z.email({ message: "Enter a valid email address." }).optional(),
    ),
    contactPhone: z.preprocess(blank, Phone.optional()),
  })
  .refine((p) => (p.kind === "venue") === (p.category === "venue"), {
    path: ["category"],
    message: "Venues use the venue category; service providers use a service category.",
  })
  .refine((p) => !p.minCapacity || !p.maxCapacity || p.minCapacity <= p.maxCapacity, {
    path: ["maxCapacity"],
    message: "Maximum must be at least the minimum.",
  })
  .refine((p) => p.priceMin === undefined || p.priceMax === undefined || p.priceMin <= p.priceMax, {
    path: ["priceMax"],
    message: "Maximum price must be at least the minimum.",
  })
  .refine(
    (p) =>
      p.pricingModel !== "quote_only" || (p.priceMin === undefined && p.priceMax === undefined),
    {
      path: ["pricingModel"],
      message: "“Price on request” listings don’t show a price range.",
    },
  );
export type ProviderProfileInput = z.infer<typeof ProviderProfileInput>;

export const VenueProfileInput = z.object({
  setting: VenueSetting.default("indoor"),
  seatedCapacity: optionalInt(1, 100000),
  standingCapacity: optionalInt(1, 100000),
  addressText: optionalText(300),
  area: optionalText(80),
  accessConditions: optionalText(1000),
  accessibility: z.array(Accessibility).max(5).default([]),
  suitability: z.array(Suitability).max(6).default([]),
});
export type VenueProfileInput = z.infer<typeof VenueProfileInput>;

export const ServiceInput = z
  .object({
    category: ProviderCategory,
    title: z.string().trim().min(2).max(120),
    description: optionalText(2000),
    pricingModel: PricingModel.default("quote_only"),
    priceFrom: optionalNumber(z.number().nonnegative().max(10_000_000)),
    priceTo: optionalNumber(z.number().nonnegative().max(10_000_000)),
    currency: CurrencyCode.default("AED"),
    minQuantity: optionalInt(1, 100000),
    maxQuantity: optionalInt(1, 100000),
    inclusions: textList(30, 200),
    isActive: z.boolean().default(true),
  })
  .refine((s) => s.priceFrom === undefined || s.priceTo === undefined || s.priceFrom <= s.priceTo, {
    path: ["priceTo"],
    message: "“To” must be at least “from”.",
  })
  .refine((s) => !s.minQuantity || !s.maxQuantity || s.minQuantity <= s.maxQuantity, {
    path: ["maxQuantity"],
    message: "Maximum must be at least the minimum.",
  })
  .refine(
    (s) =>
      s.pricingModel !== "quote_only" || (s.priceFrom === undefined && s.priceTo === undefined),
    {
      path: ["pricingModel"],
      message: "“Price on request” services don’t show a price.",
    },
  );
export type ServiceInput = z.infer<typeof ServiceInput>;

export const DocumentInput = z.object({
  kind: DocumentKind,
  title: z.string().trim().min(2).max(120),
  referenceNumber: optionalText(80),
  issuedBy: optionalText(120),
  expiresOn: z.preprocess(blank, z.iso.date({ message: "Use a valid date." }).optional()),
});
export type DocumentInput = z.infer<typeof DocumentInput>;

export const VerificationDecisionInput = z
  .object({ decision: z.enum(["verified", "rejected"]), note: optionalText(1000) })
  .refine((d) => d.decision !== "rejected" || d.note, {
    path: ["note"],
    message: "Give a reason for rejecting.",
  });

export const ModerationDecisionInput = z
  .object({ status: ProviderModerationStatus, reason: optionalText(1000) })
  .refine((d) => d.status === "active" || d.reason, {
    path: ["reason"],
    message: "Give a reason.",
  });

export const DocumentReviewInput = z
  .object({ decision: z.enum(["accepted", "rejected"]), note: optionalText(1000) })
  .refine((d) => d.decision !== "rejected" || d.note, {
    path: ["note"],
    message: "Give a reason for rejecting.",
  });
