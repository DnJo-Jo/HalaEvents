import type { Metadata } from "next";
import Link from "next/link";
import { ProviderCard } from "@/components/marketplace/provider-card";
import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Icon } from "@/components/ui/icon";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { CATEGORY_LABELS } from "@/modules/profiles/labels";
import { ProviderCategory } from "@/modules/profiles/schemas";
import { DirectorySearchInput } from "@/modules/marketplace/schemas";
import { searchDirectory } from "@/modules/marketplace/service";

export const metadata: Metadata = { title: "Marketplace" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MarketplacePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]);
  const filters = DirectorySearchInput.parse({
    q: one("q"),
    category: one("category"),
    city: one("city"),
    attendance: one("attendance"),
    budget: one("budget"),
    page: one("page"),
  });
  const { providers, hasNext, page } = await searchDirectory(filters);
  const active = Object.entries(filters).some(([k, v]) => k !== "page" && v !== undefined);
  const pageHref = (n: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters))
      if (v !== undefined && k !== "page") params.set(k, String(v));
    if (n > 1) params.set("page", String(n));
    const qs = params.toString();
    return qs ? `/app/marketplace?${qs}` : "/app/marketplace";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Marketplace"
        description="Venues and service providers whose business details were reviewed by the HalaEvents team. Prices are indicative; availability is what providers state, not a live calendar."
      />

      <form
        method="get"
        role="search"
        aria-label="Filter providers"
        className="grid gap-4 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-6"
      >
        <FormField label="Search" className="lg:col-span-2">
          <Input
            name="q"
            type="search"
            defaultValue={filters.q}
            placeholder="Name or description"
          />
        </FormField>
        <FormField label="Category">
          <Select name="category" defaultValue={filters.category ?? ""}>
            <option value="">All categories</option>
            {ProviderCategory.options.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="City / area">
          <Input name="city" defaultValue={filters.city} placeholder="e.g. Dubai" />
        </FormField>
        <FormField label="Guests">
          <Input
            name="attendance"
            type="number"
            min={1}
            inputMode="numeric"
            defaultValue={filters.attendance}
          />
        </FormField>
        <FormField label="Budget (AED)" hint="Hides providers whose indicative minimum is higher.">
          <Input
            name="budget"
            type="number"
            min={0}
            inputMode="decimal"
            defaultValue={filters.budget}
          />
        </FormField>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-6">
          <Button type="submit">Search</Button>
          {active && (
            <ButtonLink href="/app/marketplace" variant="ghost">
              Clear filters
            </ButtonLink>
          )}
        </div>
      </form>

      {providers.length === 0 ? (
        <EmptyState
          icon={
            <Icon path="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3" className="size-6" />
          }
          title={active ? "No providers match these filters" : "No providers are listed yet"}
          description={
            active
              ? "Try a broader category, another city, or remove the budget filter."
              : "Listings appear here once providers are verified. For local development, run the demo seed (supabase/seed.sql)."
          }
        />
      ) : (
        <>
          {providers.some((p) => p.is_demo) && (
            <Alert tone="info" title="Some results are demo listings">
              Listings marked &ldquo;Demo listing&rdquo; are fictional sample data for local
              development. They can be browsed and shortlisted but can&rsquo;t receive requests.
            </Alert>
          )}
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Providers">
            {providers.map((p) => (
              <li key={p.id}>
                <ProviderCard p={p} />
              </li>
            ))}
          </ul>
          {(page > 1 || hasNext) && (
            <nav aria-label="Pagination" className="flex items-center justify-between">
              {page > 1 ? (
                <Link
                  href={pageHref(page - 1)}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  ← Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="text-sm text-ink-muted">Page {page}</span>
              {hasNext ? (
                <Link
                  href={pageHref(page + 1)}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  Next →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}

/** Data-dependent route behind the app shell Suspense; blocking navigation is intended. */
export const instant = false;
