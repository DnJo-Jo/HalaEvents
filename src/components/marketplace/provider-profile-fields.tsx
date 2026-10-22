import { FormField } from "@/components/ui/form-field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { CATEGORY_LABELS, PRICING_MODEL_LABELS } from "@/modules/profiles/labels";
import type { ProviderPrivateRow, ProviderRow } from "@/modules/profiles/providers-repo";
import { PricingModel, ProviderCategory } from "@/modules/profiles/schemas";

export const PROVIDER_FIELD_LABELS: Record<string, string> = {
  kind: "Listing type",
  category: "Category",
  name: "Business name",
  description: "Description",
  city: "City",
  serviceArea: "Service area",
  pricingModel: "Pricing model",
  minCapacity: "Minimum guests",
  maxCapacity: "Maximum guests",
  priceMin: "Indicative price from",
  priceMax: "Indicative price to",
  capabilities: "Facilities / capabilities",
  availabilityNote: "Availability statement",
  website: "Website",
  contactEmail: "Contact email",
  contactPhone: "Contact phone",
};

/** Shared fields for creating and editing a provider profile (server-rendered). */
export function ProviderProfileFields({
  p,
  priv,
  kind,
}: {
  p?: ProviderRow;
  priv?: ProviderPrivateRow | null;
  kind?: "venue" | "service";
}) {
  const fixedKind = p?.kind ?? kind;
  return (
    <div className="space-y-5">
      {fixedKind ? (
        <input type="hidden" name="kind" value={fixedKind} />
      ) : (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">What are you listing?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              ["venue", "A venue", "Halls, rooms, outdoor spaces."],
              ["service", "A service", "Catering, AV, security, transport, cleaning, photography…"],
            ].map(([value, label, help]) => (
              <label
                key={value}
                className="flex cursor-pointer gap-3 rounded-md border border-line p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
              >
                <input
                  type="radio"
                  name="kind"
                  value={value}
                  defaultChecked={value === "service"}
                  className="mt-0.5 size-4 accent-[var(--primary)]"
                />
                <span>
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-ink-muted">{help}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Business name" required>
          <Input name="name" required minLength={2} maxLength={120} defaultValue={p?.name} />
        </FormField>
        <FormField
          label="Category"
          hint="Venues use “Venue”; services choose their main category."
          required
        >
          <Select
            name="category"
            defaultValue={p?.category ?? (fixedKind === "venue" ? "venue" : "catering")}
          >
            {ProviderCategory.options
              .filter((c) => !fixedKind || (fixedKind === "venue") === (c === "venue"))
              .map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
          </Select>
        </FormField>
      </div>
      <FormField
        label="Description"
        hint="What you offer and what makes you a good fit for events."
      >
        <Textarea
          name="description"
          rows={4}
          maxLength={2000}
          defaultValue={p?.description ?? ""}
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="City">
          <Input name="city" maxLength={80} defaultValue={p?.city ?? ""} />
        </FormField>
        <FormField label="Service area" hint="Cities or areas you serve, comma-separated.">
          <Input
            name="serviceArea"
            defaultValue={p?.service_area.join(", ")}
            placeholder="Dubai, Sharjah"
          />
        </FormField>
        <FormField label="Pricing model">
          <Select name="pricingModel" defaultValue={p?.pricing_model ?? "quote_only"}>
            {PricingModel.options.map((m) => (
              <option key={m} value={m}>
                {PRICING_MODEL_LABELS[m]}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Indicative from (AED)">
            <Input
              name="priceMin"
              type="number"
              min={0}
              inputMode="decimal"
              defaultValue={p?.price_min ?? ""}
            />
          </FormField>
          <FormField label="to (AED)">
            <Input
              name="priceMax"
              type="number"
              min={0}
              inputMode="decimal"
              defaultValue={p?.price_max ?? ""}
            />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Min. guests">
            <Input
              name="minCapacity"
              type="number"
              min={1}
              inputMode="numeric"
              defaultValue={p?.min_capacity ?? ""}
            />
          </FormField>
          <FormField label="Max. guests">
            <Input
              name="maxCapacity"
              type="number"
              min={1}
              inputMode="numeric"
              defaultValue={p?.max_capacity ?? ""}
            />
          </FormField>
        </div>
        <FormField label="Website" hint="https:// only.">
          <Input name="website" type="url" defaultValue={p?.website ?? ""} placeholder="https://" />
        </FormField>
      </div>
      <FormField
        label={fixedKind === "venue" ? "Facilities" : "Capabilities / equipment"}
        hint="Comma-separated, e.g. Wi-Fi, projectors, halal kitchen, licensed guards."
      >
        <Textarea name="capabilities" rows={2} defaultValue={p?.capabilities.join(", ")} />
      </FormField>
      <FormField
        label="Availability statement"
        hint="Your own words, e.g. “Weekends usually free”. Shown as a statement, never as live availability."
      >
        <Input name="availabilityNote" maxLength={500} defaultValue={p?.availability_note ?? ""} />
      </FormField>
      <fieldset className="grid gap-4 rounded-md border border-line p-4 sm:grid-cols-2">
        <legend className="px-1 text-sm font-medium">
          Private contact (only your team and HalaEvents admins)
        </legend>
        <FormField label="Contact email" hint="Required before submitting for verification.">
          <Input name="contactEmail" type="email" defaultValue={priv?.contact_email ?? ""} />
        </FormField>
        <FormField label="Contact phone">
          <Input name="contactPhone" type="tel" defaultValue={priv?.contact_phone ?? ""} />
        </FormField>
      </fieldset>
      <input type="hidden" name="currency" value={p?.currency ?? "AED"} />
    </div>
  );
}
