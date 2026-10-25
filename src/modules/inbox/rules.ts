import { emailReference } from "@/modules/email/rules";
import type { VendorCategory } from "@/modules/vendors/schemas";

const CATEGORIES: VendorCategory[] = ["venue", "catering", "transport"];
const REF = /HE-[0-9A-F]{8}/g;

export interface RefTarget {
  category: VendorCategory;
  placeId: string | null;
}

/** Every reference code the app could have put in this event's emails, mapped to its target. */
export function referenceMap(
  eventId: string,
  shortlist: { category: VendorCategory; place_id: string }[],
): Map<string, RefTarget> {
  const map = new Map<string, RefTarget>();
  for (const c of CATEGORIES) map.set(emailReference(eventId, c), { category: c, placeId: null });
  for (const v of shortlist)
    map.set(emailReference(eventId, v.category, v.place_id), {
      category: v.category,
      placeId: v.place_id,
    });
  return map;
}

/** The target of the first of this event's codes found in the subject (then the quoted body). */
export function matchReference(
  text: { subject: string; body: string },
  refs: Map<string, RefTarget>,
): (RefTarget & { reference: string }) | null {
  for (const part of [text.subject, text.body])
    for (const code of part.match(REF) ?? []) {
      const t = refs.get(code);
      if (t) return { ...t, reference: code };
    }
  return null;
}

/** Digits of a quoted price must appear in the email itself: no invented amounts. */
export function priceIsGrounded(price: string | null, body: string): boolean {
  if (!price) return true;
  const nums = price.match(/\d[\d,.]*/g) ?? [];
  const text = body.replace(/\s/g, "");
  return nums.length > 0 && nums.every((n) => text.includes(n.replace(/[,.]$/, "")));
}
