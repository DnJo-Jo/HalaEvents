import type { Metadata } from "next";
import { ProfileForm, RolesForm } from "@/components/profile/profile-form";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireMember } from "@/modules/profiles/service";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { user, profile, roles, isAdmin } = await requireMember();
  return (
    <div className="space-y-8">
      <PageHeader title="Settings" description="Your profile and how you use HalaEvents." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Signed in as {user.email ?? "unknown email"}.</CardDescription>
          </CardHeader>
          <CardBody>
            <ProfileForm
              displayName={profile.display_name ?? ""}
              phone={profile.phone}
              locale={profile.locale}
            />
          </CardBody>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Roles</CardTitle>
              <CardDescription>
                Roles decide which tools you see. They don&rsquo;t verify a business: provider
                listings are reviewed separately.
              </CardDescription>
            </CardHeader>
            <CardBody>
              <RolesForm roles={roles} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              <p className="flex items-center gap-2">
                Account status: <Badge tone="success">Active</Badge>
              </p>
              {isAdmin && (
                <p className="flex items-center gap-2">
                  Access: <Badge tone="info">Platform admin</Badge>
                </p>
              )}
              {isAdmin && (
                <ButtonLink href="/status" variant="ghost" size="sm">
                  System status
                </ButtonLink>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
