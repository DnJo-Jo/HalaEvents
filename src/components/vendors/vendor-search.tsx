"use client";

import { useActionState, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { VendorCandidate } from "@/lib/integrations/geoapify";
import {
  removeVendorAction,
  searchVendorsAction,
  shortlistVendorAction,
} from "@/modules/vendors/actions";
import {
  RADIUS_OPTIONS_KM,
  SERVICE_HINTS,
  SERVICE_LABELS,
  type VendorCategory,
} from "@/modules/vendors/schemas";

const PHONE = /^\+?[\d\s().-]{5,30}$/;
const mapUrl = (v: { latitude: number; longitude: number }) =>
  `https://www.google.com/maps/search/?api=1&query=${v.latitude},${v.longitude}`;

const ICONS: Record<VendorCategory, string> = {
  venue: "M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6",
  catering: "M7 3v8M11 3v8M7 7h4M9 11v10M17 3c-2 2-2 6 0 8v10",
  transport: "M5 16l1.5-6h11L19 16M5 16v3M19 16v3M3 16h18M8 13h.01M16 13h.01",
};

function Thumbnail({ category }: { category: VendorCategory }) {
  return (
    <div
      className="flex h-20 w-full items-center justify-center rounded-md bg-surface-muted text-ink-muted"
      role="img"
      aria-label={`${SERVICE_LABELS[category]} (no photo available)`}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d={ICONS[category]} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function VendorCard({
  eventId,
  category,
  vendor,
  shortlisted,
  canEdit,
}: {
  eventId: string;
  category: VendorCategory;
  vendor: VendorCandidate;
  shortlisted: boolean;
  canEdit: boolean;
}) {
  const link = "underline underline-offset-2 hover:text-ink";
  return (
    <Card>
      <CardBody className="space-y-2 text-sm">
        <Thumbnail category={category} />
        <p className="font-medium">{vendor.name}</p>
        {vendor.address && <p className="text-ink-muted">{vendor.address}</p>}
        <p>
          {vendor.phone && PHONE.test(vendor.phone) ? (
            <a className={link} href={`tel:${vendor.phone.replace(/[^\d+]/g, "")}`}>
              {vendor.phone}
            </a>
          ) : (
            <span className="text-ink-muted">Phone not available</span>
          )}
        </p>
        <p className="flex flex-wrap gap-x-3">
          {vendor.website && (
            <a className={link} href={vendor.website} target="_blank" rel="noopener noreferrer">
              Website
            </a>
          )}
          <a className={link} href={mapUrl(vendor)} target="_blank" rel="noopener noreferrer">
            View on map
          </a>
        </p>
        {canEdit && (
          <form
            action={(shortlisted ? removeVendorAction : shortlistVendorAction).bind(null, eventId)}
          >
            <input type="hidden" name="category" value={category} />
            <input type="hidden" name="placeId" value={vendor.id} />
            {!shortlisted && (
              <>
                <input type="hidden" name="name" value={vendor.name} />
                <input type="hidden" name="address" value={vendor.address ?? ""} />
                <input type="hidden" name="phone" value={vendor.phone ?? ""} />
                <input type="hidden" name="website" value={vendor.website ?? ""} />
                <input type="hidden" name="latitude" value={vendor.latitude} />
                <input type="hidden" name="longitude" value={vendor.longitude} />
              </>
            )}
            <Button type="submit" size="sm" variant={shortlisted ? "ghost" : "secondary"}>
              {shortlisted ? "Remove from shortlist" : "Shortlist"}
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

function Panel({
  eventId,
  category,
  defaultLocation,
  shortlistedIds,
  canEdit,
}: {
  eventId: string;
  category: VendorCategory;
  defaultLocation: string;
  shortlistedIds: Set<string>;
  canEdit: boolean;
}) {
  const [state, search, pending] = useActionState(searchVendorsAction.bind(null, eventId), null);
  const fieldError =
    state && "fieldErrors" in state ? Object.values(state.fieldErrors).flat()[0] : null;
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">{SERVICE_HINTS[category]}</p>
      <form action={search} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="category" value={category} />
        <label className="grow text-sm">
          <span className="mb-1 block font-medium">Search location</span>
          <Input name="location" defaultValue={defaultLocation} maxLength={200} required />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Radius</span>
          <Select name="radiusKm" defaultValue="15">
            {RADIUS_OPTIONS_KM.map((km) => (
              <option key={km} value={km}>
                {km} km
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" disabled={pending}>
          Find vendors
        </Button>
        {pending && <Spinner label="Searching" />}
      </form>
      {fieldError && (
        <Alert tone="danger" title="Check the search">
          {fieldError}
        </Alert>
      )}
      {state && "message" in state && !state.ok && (
        <Alert tone="danger" title="Search unavailable">
          {state.message}
        </Alert>
      )}
      {state?.ok === true &&
        (state.vendors.length === 0 ? (
          <Alert tone="info" title="No results">
            No {SERVICE_LABELS[category].toLowerCase()} results near {state.location.label}. Try a
            larger radius or another location.
          </Alert>
        ) : (
          <>
            <p className="text-sm text-ink-muted">
              Showing {state.vendors.length} nearby result{state.vendors.length === 1 ? "" : "s"}{" "}
              for {state.location.label}. These are listed businesses, not confirmed{" "}
              {category === "transport" ? "shuttle operators" : `${category} providers`}.
            </p>
            <ul className="grid gap-4 sm:grid-cols-3">
              {state.vendors.map((v) => (
                <li key={v.id}>
                  <VendorCard
                    eventId={eventId}
                    category={category}
                    vendor={v}
                    shortlisted={shortlistedIds.has(`${category}:${v.id}`)}
                    canEdit={canEdit}
                  />
                </li>
              ))}
            </ul>
          </>
        ))}
    </div>
  );
}

export function VendorSearch({
  eventId,
  categories,
  defaultLocation,
  shortlistedKeys,
  canEdit,
}: {
  eventId: string;
  categories: VendorCategory[];
  defaultLocation: string;
  /** `category:placeId` of every shortlisted vendor. */
  shortlistedKeys: string[];
  canEdit: boolean;
}) {
  const [active, setActive] = useState(categories[0]);
  const ids = new Set(shortlistedKeys);
  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Service categories"
        className="flex gap-2 border-b border-line"
      >
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            id={`tab-${c}`}
            aria-selected={active === c}
            aria-controls={`panel-${c}`}
            onClick={() => setActive(c)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${active === c ? "border-primary text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}
          >
            {SERVICE_LABELS[c]}
          </button>
        ))}
      </div>
      {categories.map((c) => (
        <div
          key={c}
          role="tabpanel"
          id={`panel-${c}`}
          aria-labelledby={`tab-${c}`}
          hidden={active !== c}
        >
          <Panel
            eventId={eventId}
            category={c}
            defaultLocation={defaultLocation}
            shortlistedIds={ids}
            canEdit={canEdit}
          />
        </div>
      ))}
    </div>
  );
}
