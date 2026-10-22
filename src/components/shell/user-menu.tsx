import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { signOutAction } from "@/modules/auth/actions";
import { getMemberContext } from "@/modules/profiles/service";

export async function UserMenu() {
  const ctx = await getMemberContext();
  if (!ctx) return null;
  const name = ctx.profile.display_name ?? ctx.user.email ?? "Member";
  return (
    <div className="flex items-center gap-3">
      {ctx.isAdmin && <Badge tone="info">Platform admin</Badge>}
      <span
        className="hidden max-w-48 truncate text-sm font-medium text-ink sm:inline"
        title={ctx.user.email ?? undefined}
      >
        {name}
      </span>
      <form action={signOutAction}>
        <SubmitButton variant="secondary" size="sm">
          Sign out
        </SubmitButton>
      </form>
    </div>
  );
}

export function UserMenuSkeleton() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-8 w-40 animate-shimmer rounded-md bg-surface-muted"
    />
  );
}
