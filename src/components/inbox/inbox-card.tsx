import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  analyzeReplyAction,
  checkRepliesAction,
  disconnectGmailAction,
} from "@/modules/inbox/actions";
import type { getInboxView } from "@/modules/inbox/service";
import { SERVICE_LABELS } from "@/modules/vendors/schemas";

type Inbox = Awaited<ReturnType<typeof getInboxView>>;

const FLAGS: Record<string, { tone: "success" | "danger" | "info"; text: string }> = {
  connected: { tone: "success", text: "Gmail connected. You can now check for replies." },
  failed: { tone: "danger", text: "Gmail wasn't connected. Try again." },
  unavailable: { tone: "info", text: "Connecting Gmail isn't set up yet." },
};

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );

/** Manual inbox agent: connect Gmail (read-only), check for replies, analyze a reply. */
export function InboxCard({
  eventId,
  inbox,
  flag,
}: {
  eventId: string;
  inbox: Inbox;
  flag?: string;
}) {
  const notice = flag ? FLAGS[flag] : undefined;
  return (
    <Card id="vendor-replies">
      <CardHeader>
        <CardTitle>Vendor replies</CardTitle>
        <CardDescription>
          You send emails yourself from Gmail. Click Check for replies to read answers from your
          vendor here; HalaEvents only reads your inbox and never sends or changes anything.
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-4">
        {notice && <Alert tone={notice.tone} title={notice.text} />}
        {!inbox.available ? (
          <p className="text-sm text-ink-muted">Reply checking isn&apos;t set up yet.</p>
        ) : !inbox.connectedAs ? (
          <div className="space-y-2">
            <ButtonLink href={`/api/integrations/gmail/connect?event=${eventId}`} size="sm">
              Connect Gmail
            </ButtonLink>
            <p className="text-sm text-ink-muted">
              Read-only access to your Gmail. You can disconnect at any time.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-ink-muted">
              Connected as {inbox.connectedAs}
              {inbox.vendorEmail ? `. Reading replies from ${inbox.vendorEmail}.` : "."}
            </p>
            <ActionForm action={checkRepliesAction.bind(null, eventId)} className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <SubmitButton size="sm">Check for replies</SubmitButton>
              </div>
            </ActionForm>
            <ActionForm action={disconnectGmailAction.bind(null, eventId)}>
              <SubmitButton size="sm" variant="ghost">
                Disconnect Gmail
              </SubmitButton>
            </ActionForm>
          </div>
        )}

        {inbox.replies.length > 0 && (
          <ul className="space-y-3">
            {inbox.replies.map((r) => (
              <li key={r.id} className="space-y-2 rounded-md border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="success">Replied</Badge>
                  <span className="font-medium">
                    {r.vendorName ?? `${SERVICE_LABELS[r.category]} vendor`}
                  </span>
                  <span className="text-xs text-ink-muted">{when(r.received_at)}</span>
                </div>
                <dl className="text-sm">
                  <div className="flex gap-1">
                    <dt className="text-ink-muted">From:</dt>
                    <dd>
                      {r.from_name ? `${r.from_name} ` : ""}&lt;{r.from_email}&gt;
                    </dd>
                  </div>
                  <div className="flex gap-1">
                    <dt className="text-ink-muted">Subject:</dt>
                    <dd>{r.subject}</dd>
                  </div>
                </dl>
                <pre className="max-h-64 overflow-auto rounded bg-surface-muted p-2 text-sm whitespace-pre-wrap">
                  {r.body || "(no text)"}
                </pre>
                {r.analysis ? (
                  <div className="space-y-1 rounded-md border border-line p-2 text-sm">
                    <p className="font-medium">Extracted from this email</p>
                    <p>
                      <span className="text-ink-muted">Quoted price:</span>{" "}
                      {r.analysis.price ?? "Not stated"}
                    </p>
                    <p>
                      <span className="text-ink-muted">Availability:</span>{" "}
                      {r.analysis.availability ?? "Not stated"}
                    </p>
                    <List label="Service details" items={r.analysis.serviceDetails} />
                    <List label="Conditions" items={r.analysis.conditions} />
                    <p className="text-xs text-ink-muted">
                      Read by software. Check it against the email before relying on it. This is not
                      an accepted quote.
                    </p>
                  </div>
                ) : inbox.aiAvailable ? (
                  <ActionForm action={analyzeReplyAction.bind(null, eventId)}>
                    <input type="hidden" name="replyId" value={r.id} />
                    <SubmitButton size="sm" variant="secondary">
                      Analyze reply
                    </SubmitButton>
                  </ActionForm>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function List({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <span className="text-ink-muted">{label}:</span>{" "}
      {items.length === 0 ? (
        "Not stated"
      ) : (
        <ul className="list-disc pl-5">
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
