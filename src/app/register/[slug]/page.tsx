import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AuthShell, FormSkeleton } from "@/components/auth/auth-shell";
import { AuthNotConfigured } from "@/components/auth/not-configured";
import { ActionForm } from "@/components/ui/action-form";
import { FormField } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatInZone } from "@/lib/dates";
import { getSupabaseConfig } from "@/lib/db/config";
import { registerAction } from "@/modules/attendees/actions";
import { publicEvent } from "@/modules/attendees/service";

export const metadata: Metadata = { title: "Register" };

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Public registration (no account). Collects only name, email, optional phone and, if the event reviews applications, a short note. */
export default function RegisterPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense
      fallback={
        <AuthShell title="Register">
          <FormSkeleton />
        </AuthShell>
      }
    >
      <RegisterContent params={params} />
    </Suspense>
  );
}

async function RegisterContent({ params }: { params: Promise<{ slug: string }> }) {
  await connection(); // the event and its open window are request-time data, never prerendered
  const { slug } = await params;
  if (!SLUG.test(slug) || slug.length > 80) notFound();
  if (!getSupabaseConfig()) return <AuthNotConfigured />;
  const event = await publicEvent(slug);
  if (!event) notFound();
  return (
    <AuthShell
      title={`Register: ${event.name}`}
      description={`${formatInZone(event.starts_at, event.timezone)}${event.city ? ` · ${event.city}` : ""}`}
    >
      <ActionForm
        action={registerAction.bind(null, slug)}
        labels={{ fullName: "Full name", email: "Email", phone: "Phone", consent: "Consent" }}
      >
        <FormField label="Full name" required>
          <Input name="fullName" required minLength={2} maxLength={120} autoComplete="name" />
        </FormField>
        <FormField label="Email" required>
          <Input name="email" type="email" required maxLength={254} autoComplete="email" />
        </FormField>
        <FormField label="Phone" hint="Optional.">
          <Input name="phone" type="tel" maxLength={20} autoComplete="tel" />
        </FormField>
        {event.requires_application && (
          <FormField
            label="Why do you want to take part?"
            hint="The organizers review applications."
          >
            <Textarea name="applicationNote" maxLength={1000} rows={3} />
          </FormField>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="consent" value="yes" required className="mt-1" />
          <span>
            I agree that the organizers store my name, email and (if given) phone number to manage
            this event and email me about it.
          </span>
        </label>
        <SubmitButton>Register</SubmitButton>
      </ActionForm>
    </AuthShell>
  );
}
