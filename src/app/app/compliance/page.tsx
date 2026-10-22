import type { Metadata } from "next";
import { PlannedPage } from "@/components/shell/planned-page";

export const metadata: Metadata = { title: "Compliance" };

export default function CompliancePage() {
  return <PlannedPage href="/app/compliance" />;
}
