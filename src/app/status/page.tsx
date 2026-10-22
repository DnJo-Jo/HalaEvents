import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Logo } from "@/components/shell/logo";
import { buildHealthReport } from "@/lib/health";

export const metadata: Metadata = { title: "System status" };

export default function StatusPage() {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <ButtonLink href="/app" variant="secondary" size="sm">
            Open the app
          </ButtonLink>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-6">
        <PageHeader
          title="System status"
          description="Configuration health for development. Shows variable names and on/off states only — never values. The same data is available as JSON at /api/health."
        />
        <Suspense fallback={<StatusSkeleton />}>
          <StatusDetails />
        </Suspense>
      </main>
    </div>
  );
}

async function StatusDetails() {
  await connection(); // read the environment at request time, not build time
  const report = buildHealthReport();
  const d = report.details;

  return (
    <div className="space-y-6">
      {report.status === "ok" ? (
        <Alert tone="success" title="Environment is valid and Supabase is configured">
          Checked {new Date(report.time).toUTCString()} · version {report.version}
        </Alert>
      ) : (
        <Alert tone="danger" title="Degraded: environment invalid or Supabase not configured">
          Fix the variables listed below; see <code className="font-mono">.env.example</code>.
        </Alert>
      )}

      {!d ? (
        <Alert tone="info" title="Details hidden in production">
          Only the overall status is shown outside development.
        </Alert>
      ) : (
        <>
          {d.env.issues.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Problems</CardTitle>
              </CardHeader>
              <CardBody>
                <ul className="space-y-1.5 text-sm">
                  {d.env.issues.map((i) => (
                    <li key={`${i.variable}-${i.message}`}>
                      <code className="font-mono font-semibold">{i.variable}</code>: {i.message}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          <Table caption="Integrations">
            <THead>
              <TR>
                <TH>Integration</TH>
                <TH>Mode</TH>
                <TH>Label</TH>
              </TR>
            </THead>
            <TBody>
              {d.env.integrations.map((i) => (
                <TR key={i.name}>
                  <TD className="font-medium capitalize">{i.name}</TD>
                  <TD>
                    <code className="font-mono text-xs">{i.mode}</code>
                  </TD>
                  <TD>
                    {i.mock ? (
                      <Badge tone="warning">Mock — simulated results</Badge>
                    ) : i.mode === "invalid" ? (
                      <Badge tone="danger">Invalid value</Badge>
                    ) : i.mode === "none" ? (
                      <Badge tone="neutral">Disabled</Badge>
                    ) : (
                      <Badge tone="success">Real provider</Badge>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>

          <Card>
            <CardHeader>
              <CardTitle>Database (Supabase)</CardTitle>
              <CardDescription>
                Required for sign-in. Variables are checked for presence only; this page does not
                attempt a connection, so &ldquo;Set&rdquo; does not prove the project is reachable.
              </CardDescription>
            </CardHeader>
            <CardBody>
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <Flag label="NEXT_PUBLIC_SUPABASE_URL" on={d.env.supabase.urlSet} />
                <Flag
                  label="NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
                  on={d.env.supabase.publishableKeySet}
                />
                <Flag label="SUPABASE_SECRET_KEY" on={d.env.supabase.secretKeySet} />
              </dl>
            </CardBody>
          </Card>

          <p className="text-xs text-ink-muted">
            Runtime: Node {d.node} · NODE_ENV={d.environment}
          </p>
        </>
      )}
    </div>
  );
}

function Flag({ label, on }: { label: string; on: boolean }) {
  return (
    <div className="space-y-1 rounded-md border border-line p-3">
      <dt className="font-mono text-[0.7rem] break-all text-ink-muted">{label}</dt>
      <dd>{on ? <Badge tone="success">Set</Badge> : <Badge tone="neutral">Not set</Badge>}</dd>
    </div>
  );
}

function StatusSkeleton() {
  return (
    <div role="status" aria-label="Loading status" className="space-y-4">
      <Skeleton className="h-16" />
      <Skeleton className="h-48" />
      <Skeleton className="h-32" />
    </div>
  );
}
