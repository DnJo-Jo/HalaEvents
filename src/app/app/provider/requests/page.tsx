import type { Metadata } from "next";
import Link from "next/link";
import { QuoteStatusBadge, RequestStatusBadge } from "@/components/marketplace/status-badges";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatInZone } from "@/lib/dates";
import { quoteDisplayStatus } from "@/modules/bookings/rules";
import { inboxForProvider } from "@/modules/bookings/service";
import { CATEGORY_LABELS } from "@/modules/profiles/labels";

export const metadata: Metadata = { title: "Quote requests" };

export default async function ProviderInboxPage() {
  const rows = await inboxForProvider();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Quote requests"
        description="Requests organizers sent to your listings. You only see requests addressed to you."
      />
      {rows.length === 0 ? (
        <EmptyState
          title="No requests yet"
          description="Once your listing is verified and visible, organizers can send you requests from the marketplace."
        />
      ) : (
        <Table caption="Requests addressed to your listings">
          <THead>
            <TR>
              <TH>Request</TH>
              <TH>For listing</TH>
              <TH>Needed</TH>
              <TH>Request</TH>
              <TH>Your response</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => {
              const req = r.service_requests;
              return (
                <TR key={`${r.request_id}-${r.provider_id}`}>
                  <TD>
                    <Link
                      href={`/app/provider/requests/${r.request_id}/${r.provider_id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {req.title}
                    </Link>
                    <span className="block text-xs text-ink-muted">
                      {req.event_name}
                      {req.event_city ? ` · ${req.event_city}` : ""} ·{" "}
                      {CATEGORY_LABELS[req.category]}
                    </span>
                  </TD>
                  <TD className="text-sm">{r.providers?.name}</TD>
                  <TD className="text-sm text-ink-muted">
                    {formatInZone(req.needed_from, req.timezone, { zoneLabel: false })}
                  </TD>
                  <TD>
                    <RequestStatusBadge status={req.status} />
                  </TD>
                  <TD>
                    {r.status === "declined" ? (
                      <Badge tone="neutral">You declined</Badge>
                    ) : r.quote ? (
                      <QuoteStatusBadge status={quoteDisplayStatus(r.quote)} />
                    ) : (
                      <Badge tone="warning">Needs response</Badge>
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </div>
  );
}
