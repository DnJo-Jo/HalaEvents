"use client";

import { useActionState, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { gmailComposeUrl } from "@/lib/integrations/gmail-compose";
import { draftEmailAction } from "@/modules/email/actions";
import type { DraftResult, EmailDraft as Draft } from "@/modules/email/schemas";

interface Targets {
  categories: { value: string; label: string }[];
  vendors: { placeId: string; name: string; category: string }[];
  customAvailable: boolean;
  organizerEmail: string | null;
  vendorEmail: string | null;
}

export function EmailDraft({ eventId, targets }: { eventId: string; targets: Targets }) {
  const [result, action, pending] = useActionState<DraftResult | null, FormData>(
    draftEmailAction.bind(null, eventId),
    null,
  );
  // A new key per request resets the editable preview, even when the text comes back identical.
  const [version, setVersion] = useState(0);
  const draft = result?.ok ? result.draft : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Who is this for?</CardTitle>
          <CardDescription>
            Pick a shortlisted vendor, or a service to write a general request. You don&apos;t need
            their email address yet.
          </CardDescription>
        </CardHeader>
        <CardBody>
          <form
            action={(fd) => {
              setVersion((v) => v + 1);
              return action(fd);
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Recipient</span>
              <Select name="target" required defaultValue="" className="min-w-64">
                <option value="" disabled>
                  Choose…
                </option>
                {targets.vendors.length > 0 && (
                  <optgroup label="Shortlisted vendors">
                    {targets.vendors.map((v) => (
                      <option key={v.placeId} value={`${v.category}|${v.placeId}`}>
                        {v.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Any vendor in a service">
                  {targets.categories.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </optgroup>
              </Select>
            </label>
            {targets.customAvailable && (
              <Button type="submit" name="mode" value="custom" loading={pending}>
                Write a draft
              </Button>
            )}
            <Button
              type="submit"
              name="mode"
              value="template"
              variant={targets.customAvailable ? "secondary" : "primary"}
              disabled={pending}
            >
              {targets.customAvailable ? "Use a template" : "Create a draft"}
            </Button>
            {pending && <Spinner />}
          </form>
          {result && !result.ok && (
            <div className="mt-3">
              <Alert tone="danger" title="No draft">
                {result.message}
              </Alert>
            </div>
          )}
        </CardBody>
      </Card>

      {draft && <DraftPreview key={version} draft={draft} targets={targets} />}
    </div>
  );
}

function DraftPreview({ draft, targets }: { draft: Draft; targets: Targets }) {
  const [to, setTo] = useState(draft.to || targets.vendorEmail || "");
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const url = gmailComposeUrl({
    account: targets.organizerEmail ?? undefined,
    to,
    subject,
    body,
  });
  const tooLong = url === null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`);
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Review your email{" "}
          <Badge tone="neutral">{draft.source === "custom" ? "Custom draft" : "Template"}</Badge>
        </CardTitle>
        <CardDescription>
          Edit anything below. Gmail opens with this text; you send it yourself from Gmail.
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-3">
        {draft.notice && (
          <Alert tone="info" title="Template draft">
            {draft.notice}
          </Alert>
        )}
        <label className="grid gap-1 text-sm">
          <span className="font-medium">To (optional)</span>
          <Input
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="vendor@example.com"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Subject</span>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          <span className="text-xs text-ink-muted">
            Keep the code in brackets: it helps match the vendor&apos;s reply to this event.
          </span>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Message</span>
          <Textarea rows={16} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        {targets.organizerEmail ? (
          <p className="text-sm text-ink-muted">
            Gmail will open with <span className="font-medium">{targets.organizerEmail}</span> as
            the sender. If you&apos;re signed in to several Google accounts, Gmail may ask you to
            choose it.
          </p>
        ) : (
          <Alert tone="warning" title="Sender account not set">
            Connect Gmail on the event page so this opens in the right account. Until then Gmail
            uses whichever Google account your browser picks, so check the sender before you send.
          </Alert>
        )}
        {tooLong && (
          <Alert tone="warning" title="Too long to open in Gmail">
            This message is too long to pass to Gmail. Use Copy email, then paste it into a new
            Gmail message.
          </Alert>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-ink shadow-xs hover:bg-primary-hover"
            >
              Open in Gmail
            </a>
          ) : (
            <Button disabled>Open in Gmail</Button>
          )}
          <Button variant="secondary" onClick={copy}>
            Copy email
          </Button>
          <span role="status" className="text-sm text-ink-muted">
            {copied === "yes" && "Copied."}
            {copied === "failed" && "Couldn't copy. Select the text and copy it manually."}
          </span>
        </div>
        <p className="text-sm text-ink-muted">
          Opening Gmail doesn&apos;t send anything or save a draft. Review the message and press
          Send in Gmail when you&apos;re ready. HalaEvents doesn&apos;t know whether it was sent.
        </p>
      </CardBody>
    </Card>
  );
}
