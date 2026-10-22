"use client";

import { ErrorPanel } from "@/components/error-panel";

export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorPanel error={error} retry={retry} />;
}
