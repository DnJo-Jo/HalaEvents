"use client";

import { ErrorPanel } from "@/components/error-panel";

export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <main id="main" className="px-4">
      <ErrorPanel error={error} retry={retry} />
    </main>
  );
}
