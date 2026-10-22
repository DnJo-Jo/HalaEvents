import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function AppNotFound() {
  return (
    <EmptyState
      title="We couldn’t find that"
      description="It may not exist, or you may not have access to it."
      action={<ButtonLink href="/app">Back to overview</ButtonLink>}
    />
  );
}
