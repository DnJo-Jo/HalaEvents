import { RequestStatusBadge } from "@/components/marketplace/status-badges";
import { Card, CardBody } from "@/components/ui/card";
import { formatInZone } from "@/lib/dates";
import type { RequestRow } from "@/modules/bookings/repo";
import { CATEGORY_LABELS, formatMoney } from "@/modules/profiles/labels";

export function RequestSummary({ r }: { r: RequestRow }) {
  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <RequestStatusBadge status={r.status} />
          <span className="text-sm text-ink-muted">{CATEGORY_LABELS[r.category]}</span>
        </div>
        <p className="text-sm whitespace-pre-line">{r.requirements}</p>
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-ink-muted">Needed</dt>
            <dd>
              {formatInZone(r.needed_from, r.timezone, { zoneLabel: false })} →{" "}
              {formatInZone(r.needed_to, r.timezone, { zoneLabel: false })}
              <span className="block text-xs text-ink-muted">{r.timezone}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Expected attendance</dt>
            <dd>{r.expected_attendance}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Maximum budget</dt>
            <dd>{r.budget_max !== null ? formatMoney(r.budget_max, r.currency) : "Not stated"}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Respond by</dt>
            <dd>
              {r.respond_by
                ? formatInZone(r.respond_by, r.timezone, { zoneLabel: false })
                : "No deadline"}
            </dd>
          </div>
        </dl>
      </CardBody>
    </Card>
  );
}
