import type { PricingModel, ProviderCategory } from "./schemas";

export const CATEGORY_LABELS: Record<ProviderCategory, string> = {
  venue: "Venue",
  catering: "Catering",
  av: "Technical equipment (AV)",
  security: "Security",
  photography: "Photography & video",
  decor: "Decor & furniture",
  transport: "Transportation",
  cleaning: "Cleaning",
  other: "Other services",
};

export const PRICING_UNIT: Record<PricingModel, string> = {
  per_person: "per person",
  per_hour: "per hour",
  per_day: "per day",
  per_event: "per event",
  quote_only: "",
};

export const PRICING_MODEL_LABELS: Record<PricingModel, string> = {
  per_person: "Per person",
  per_hour: "Per hour",
  per_day: "Per day",
  per_event: "Per event (flat)",
  quote_only: "Price on request",
};

export const ACCESSIBILITY_LABELS: Record<string, string> = {
  step_free: "Step-free access",
  accessible_toilets: "Accessible toilets",
  lift: "Lift",
  hearing_loop: "Hearing loop",
  accessible_parking: "Accessible parking",
};

export const SUITABILITY_LABELS: Record<string, string> = {
  hackathon: "Hackathons",
  conference: "Conferences",
  workshop: "Workshops",
  exhibition: "Exhibitions",
  social: "Social events",
  ceremony: "Ceremonies",
};

export const DOCUMENT_KIND_LABELS: Record<string, string> = {
  trade_license: "Trade licence",
  insurance: "Insurance certificate",
  food_safety: "Food safety certificate",
  security_license: "Security licence",
  venue_permit: "Venue permit",
  other: "Other",
};

export function formatMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** Indicative price label. Never presented as a quote or a confirmed price. */
export function indicativePrice(
  model: PricingModel,
  min: number | null,
  max: number | null,
  currency: string,
): string {
  if (model === "quote_only" || (min === null && max === null)) return "Price on request";
  const unit = PRICING_UNIT[model];
  const range =
    min !== null && max !== null && min !== max
      ? `${formatMoney(min, currency)}–${max.toLocaleString("en-US")}`
      : min !== null
        ? `from ${formatMoney(min, currency)}`
        : `up to ${formatMoney(max as number, currency)}`;
  return `Indicative: ${range}${unit ? ` ${unit}` : ""}`;
}
