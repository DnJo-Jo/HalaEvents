import Link from "next/link";
import { Card, CardBody } from "@/components/ui/card";
import { CATEGORY_LABELS } from "@/modules/profiles/labels";
import type { ProviderRow } from "@/modules/profiles/providers-repo";
import { CapacityLabel, ListingBadges, PriceLabel } from "./badges";

export function ProviderCard({ p }: { p: ProviderRow }) {
  return (
    <Link
      href={`/app/marketplace/${p.id}`}
      className="group block h-full rounded-lg focus-visible:outline-offset-4"
    >
      <Card className="flex h-full flex-col transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-line-strong group-hover:shadow-md motion-reduce:transform-none">
        <CardBody className="flex flex-1 flex-col gap-3">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-accent">{CATEGORY_LABELS[p.category]}</p>
            <h2 className="font-semibold text-ink group-hover:text-primary">{p.name}</h2>
            <p className="text-sm text-ink-muted">
              {[
                p.city,
                p.service_area
                  .filter((a) => a !== p.city)
                  .slice(0, 2)
                  .join(", "),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          {p.description && <p className="line-clamp-2 text-sm text-ink-muted">{p.description}</p>}
          <div className="mt-auto space-y-2 pt-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <PriceLabel
                model={p.pricing_model}
                min={p.price_min}
                max={p.price_max}
                currency={p.currency}
              />
              <CapacityLabel min={p.min_capacity} max={p.max_capacity} />
            </div>
            <ListingBadges p={p} />
          </div>
        </CardBody>
      </Card>
    </Link>
  );
}
