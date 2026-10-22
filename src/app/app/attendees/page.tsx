import type { Metadata } from "next";
import { PlannedPage } from "@/components/shell/planned-page";

export const metadata: Metadata = { title: "Attendees" };

export default function AttendeesPage() {
  return <PlannedPage href="/app/attendees" />;
}
