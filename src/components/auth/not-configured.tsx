import { Alert } from "@/components/ui/alert";

export function AuthNotConfigured() {
  return (
    <Alert tone="warning" title="Authentication isn’t configured">
      This deployment has no Supabase project connected, so accounts can&rsquo;t be created or used.
      Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.example) and
      restart. Nothing on this page pretends to sign you in.
    </Alert>
  );
}
