import type { Metadata } from "next";
import { PlannedPage } from "@/components/shell/planned-page";

export const metadata: Metadata = { title: "Messages" };

export default function MessagesPage() {
  return <PlannedPage href="/app/messages" />;
}
