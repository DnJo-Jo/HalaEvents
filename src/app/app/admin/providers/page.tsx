import type { Metadata } from "next";
import Link from "next/link";
import { ListingBadges } from "@/components/marketplace/badges";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/dates";
import { CATEGORY_LABELS } from "@/modules/profiles/labels";
import { listForReview, requireAdmin } from "@/modules/profiles/providers-service";

export const metadata: Metadata = { title: "Provider review" };

const FILTERS = [
  ["submitted", "Awaiting review"],
  ["verified", "Verified"],
  ["rejected", "Rejected"],
  ["moderated", "Hidden / suspended"],
  ["draft", "Drafts"],
  ["all", "All"],
] as const;
type Filter = (typeof FILTERS)[number][0];

export default async function AdminProvidersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const raw = (await searchParams).status;
  const filter: Filter = FILTERS.some(([f]) => f === raw) ? (raw as Filter) : "submitted";
  const providers = await listForReview(filter);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Provider review"
        description="Verify businesses, review credentials and moderate listings. You can't review providers you belong to."
      />
      <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
        {FILTERS.map(([f, label]) => (
          <Link
            key={f}
            href={`/app/admin/providers?status=${f}`}
            aria-current={f === filter ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              f === filter
                ? "border-primary bg-primary-soft text-primary"
                : "border-line text-ink-muted hover:text-ink",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>
      {providers.length === 0 ? (
        <EmptyState title="Nothing here" description="No providers match this filter." />
      ) : (
        <Table caption="Providers">
          <THead>
            <TR>
              <TH>Provider</TH>
              <TH>Category</TH>
              <TH>Submitted</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {providers.map((p) => (
              <TR key={p.id}>
                <TD>
                  <Link
                    href={`/app/admin/providers/${p.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {p.name}
                  </Link>
                </TD>
                <TD className="text-sm">{CATEGORY_LABELS[p.category]}</TD>
                <TD className="text-sm text-ink-muted">
                  {p.submitted_at ? formatDate(p.submitted_at) : "—"}
                </TD>
                <TD>
                  <ListingBadges p={p} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
