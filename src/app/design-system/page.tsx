import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { Badge, DemoBadge, MockBadge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import {
  Card,
  CardBody,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Icon } from "@/components/ui/icon";
import { Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Logo } from "@/components/shell/logo";
import { DialogDemo } from "./dialog-demo";

export const metadata: Metadata = { title: "Design system" };

const swatches = [
  ["canvas", "bg-canvas"],
  ["surface", "bg-surface"],
  ["surface-muted", "bg-surface-muted"],
  ["line", "bg-line"],
  ["ink", "bg-ink"],
  ["ink-muted", "bg-ink-muted"],
  ["primary", "bg-primary"],
  ["primary-soft", "bg-primary-soft"],
  ["accent", "bg-accent"],
  ["success", "bg-success"],
  ["warning", "bg-warning"],
  ["danger", "bg-danger"],
  ["info", "bg-info"],
] as const;

export default function DesignSystemPage() {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <ButtonLink href="/app" variant="secondary" size="sm">
            Open the app
          </ButtonLink>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-5xl space-y-12 px-4 py-8 sm:px-6">
        <PageHeader
          title="Design system"
          description="Internal reference for the HalaEvents UI components (event.md §13). All content on this page is sample content."
          badge={<DemoBadge>Sample content</DemoBadge>}
        />

        <Section title="Color tokens" note="Light and dark values switch with the OS color scheme.">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {swatches.map(([name, cls]) => (
              <li key={name} className="space-y-1.5">
                <div className={`h-12 rounded-md border border-line ${cls}`} />
                <p className="font-mono text-xs text-ink-muted">{name}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Typography">
          <div className="space-y-2">
            <p className="text-4xl font-semibold tracking-tight">Display 4xl</p>
            <p className="text-2xl font-semibold tracking-tight">Page title 2xl</p>
            <p className="text-base font-semibold">Card title base</p>
            <p className="text-base">Body text base — readable at 16px with relaxed line height.</p>
            <p className="text-sm text-ink-muted">Muted sm — secondary descriptions and hints.</p>
            <p className="font-mono text-xs">mono xs — identifiers, references</p>
          </div>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button loading>Saving</Button>
            <Button disabled>Disabled</Button>
            <Button size="sm">Small</Button>
            <Button size="lg">Large</Button>
          </div>
        </Section>

        <Section title="Badges">
          <div className="flex flex-wrap gap-2">
            <Badge>Neutral</Badge>
            <Badge tone="primary">Needs approval</Badge>
            <Badge tone="info">Recommended</Badge>
            <Badge tone="success">Verified source</Badge>
            <Badge tone="warning">Awaiting provider</Badge>
            <Badge tone="danger">Failed</Badge>
            <Badge tone="accent">Conditional</Badge>
            <MockBadge />
            <DemoBadge />
          </div>
        </Section>

        <Section title="Form fields">
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="Event name" hint="Shown on the public registration page." required>
              <Input placeholder="e.g. Campus Hackathon" />
            </FormField>
            <FormField label="Capacity" error="Capacity must be greater than 0.">
              <Input type="number" defaultValue={0} />
            </FormField>
            <FormField label="Venue type">
              <Select defaultValue="indoor">
                <option value="indoor">Indoor</option>
                <option value="outdoor">Outdoor</option>
                <option value="hybrid">Hybrid</option>
              </Select>
            </FormField>
            <FormField label="Notes" hint="Optional.">
              <Textarea placeholder="Anything organizers should know" />
            </FormField>
          </div>
        </Section>

        <Section title="Cards">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Card title</CardTitle>
                <CardDescription>Supporting description text.</CardDescription>
              </CardHeader>
              <CardBody className="text-sm">Body content.</CardBody>
              <CardFooter>
                <Button variant="ghost" size="sm">
                  Cancel
                </Button>
                <Button size="sm">Continue</Button>
              </CardFooter>
            </Card>
            <Card>
              <CardBody className="space-y-3">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <div className="flex items-center gap-2 pt-1 text-sm text-ink-muted">
                  <Spinner className="size-4" label={null} /> Loading state
                </div>
              </CardBody>
            </Card>
          </div>
        </Section>

        <Section title="Alerts">
          <div className="space-y-3">
            <Alert tone="info" title="Information">
              Neutral context for the current page.
            </Alert>
            <Alert tone="success" title="Saved">
              The change was stored.
            </Alert>
            <Alert tone="warning" title="Mock mode">
              Email sends are simulated.
            </Alert>
            <Alert tone="danger" title="Send failed">
              The provider rejected the message.
            </Alert>
          </div>
        </Section>

        <Section title="Table">
          <Table caption="Sample attendees">
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Status</TH>
                <TH className="text-right">Applied</TH>
              </TR>
            </THead>
            <TBody>
              <TR>
                <TD className="font-medium">Sample Person A</TD>
                <TD>
                  <Badge tone="success">Accepted</Badge>
                </TD>
                <TD className="text-right text-ink-muted tabular-nums">2 days ago</TD>
              </TR>
              <TR>
                <TD className="font-medium">Sample Person B</TD>
                <TD>
                  <Badge tone="warning">Waitlisted</Badge>
                </TD>
                <TD className="text-right text-ink-muted tabular-nums">3 days ago</TD>
              </TR>
            </TBody>
          </Table>
        </Section>

        <Section title="Empty state">
          <EmptyState
            icon={<Icon path="M8 3v4M16 3v4M4 9h16M5 5h14v16H5z" className="size-6" />}
            title="No events yet"
            description="Create your first event to start planning."
            action={<Button>Create event</Button>}
          />
        </Section>

        <Section title="Dialogs">
          <DialogDemo />
        </Section>
      </main>
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {note && <p className="text-sm text-ink-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}
