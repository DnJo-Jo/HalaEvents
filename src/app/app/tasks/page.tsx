import type { Metadata } from "next";
import { PlannedPage } from "@/components/shell/planned-page";

export const metadata: Metadata = { title: "Tasks" };

export default function TasksPage() {
  return <PlannedPage href="/app/tasks" />;
}
