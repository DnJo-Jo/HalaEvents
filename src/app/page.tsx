import Link from "next/link";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Logo } from "@/components/shell/logo";

const organizerPoints = [
  {
    title: "From idea to plan in one sitting",
    body: "Describe your event and answer a short adaptive interview. HalaEvents proposes tasks, deadlines and dependencies you accept one by one.",
  },
  {
    title: "Requirements with their sources",
    body: "Every requirement is labelled verified-source, conditional or recommended, with a link to where it came from — or a clear “Not verified”.",
  },
  {
    title: "Nothing goes out without you",
    body: "Messages, quote acceptances and re-plans wait for your approval, and every decision lands in an audit trail.",
  },
  {
    title: "Ready when plans change",
    body: "When a venue cancels, see which tasks are affected and approve only the changes you want.",
  },
];

const providerPoints = [
  {
    title: "Requests that fit what you offer",
    body: "Organizers find you by category, service area, capacity and price range — once your profile is verified.",
  },
  {
    title: "Quote on your terms",
    body: "Reply to service requests with your price, terms and validity. You see exactly what the organizer asked for.",
  },
  {
    title: "You confirm every booking",
    body: "A booking is only marked confirmed when you confirm it. HalaEvents never commits your availability for you.",
  },
];

const steps = [
  { n: "1", title: "Describe", body: "Event type, venue, dates, audience and budget." },
  {
    n: "2",
    title: "Plan",
    body: "Guided questions for your event type, and a draft plan checked by rules.",
  },
  {
    n: "3",
    title: "Approve",
    body: "You review drafts and decisions before anything is sent or booked.",
  },
  {
    n: "4",
    title: "Run & recover",
    body: "Track tasks and attendees; re-plan when something breaks.",
  },
];

const principles = [
  {
    icon: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3ZM9 12l2 2 4-4",
    title: "Approval-gated",
    body: "Consequential actions need an explicit human approval.",
  },
  {
    icon: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
    title: "Source-aware",
    body: "Claims link to sources; unverified ones say so.",
  },
  {
    icon: "M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8",
    title: "Honest integrations",
    body: "Anything simulated is clearly labelled as test data.",
  },
  {
    icon: "M4 6h16M4 12h10M4 18h7",
    title: "Fully audited",
    body: "Who requested, who approved, what changed.",
  },
];

export default function LandingPage() {
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-line/70 bg-canvas/85 backdrop-blur supports-[backdrop-filter]:bg-canvas/70">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Logo />
          <nav
            aria-label="Landing"
            className="hidden items-center gap-6 text-sm text-ink-muted md:flex"
          >
            <a href="#organizers" className="rounded-sm hover:text-ink">
              For organizers
            </a>
            <a href="#providers" className="rounded-sm hover:text-ink">
              For providers
            </a>
            <a href="#how" className="rounded-sm hover:text-ink">
              How it works
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <ButtonLink href="/sign-in" variant="ghost" size="sm">
              Sign in
            </ButtonLink>
            <ButtonLink href="/sign-up" size="sm">
              Create account
            </ButtonLink>
          </div>
        </div>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 -top-40 -z-10 mx-auto h-[28rem] max-w-4xl rounded-full bg-primary-soft opacity-70 blur-3xl"
          />
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
            <div className="motion-safe:animate-rise">
              <Badge tone="primary">University hackathons in the UAE — first</Badge>
              <h1 className="mt-5 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
                Plan the event.
                <br />
                <span className="text-primary">Keep the final say.</span>
              </h1>
              <p className="mt-5 max-w-xl text-lg text-pretty text-ink-muted">
                HalaEvents turns an event idea into a coordinated, source-aware plan — tasks,
                requirements, attendees, providers and messages — and asks for your approval before
                anything is sent, booked or claimed.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <ButtonLink href="/sign-up" size="lg">
                  Create an account
                </ButtonLink>
                <ButtonLink href="#how" size="lg" variant="secondary">
                  See how it works
                </ButtonLink>
              </div>
              <p className="mt-6 text-sm text-ink-muted">
                In active development: accounts and profiles work today; event planning, the
                marketplace and messaging are being built.
              </p>
            </div>
            <PlanIllustration />
          </div>
        </section>

        {/* Audiences */}
        <section id="organizers" className="scroll-mt-20 border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
            <SectionHeading
              eyebrow="For organizers"
              title="A co-pilot that prepares, not one that decides"
              body="Student societies, university staff and small teams get a structured plan without losing control of what actually happens."
            />
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {organizerPoints.map((p) => (
                <Feature key={p.title} title={p.title} body={p.body} />
              ))}
            </div>
          </div>
        </section>

        <section id="providers" className="scroll-mt-20 border-t border-line">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
            <SectionHeading
              eyebrow="For providers"
              title="Venues, caterers and AV teams — on your own terms"
              body="Join the marketplace, receive requests that match what you offer, and stay the one who confirms."
            />
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {providerPoints.map((p) => (
                <Feature key={p.title} title={p.title} body={p.body} />
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-20 border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
            <SectionHeading eyebrow="How it works" title="Four steps, with you at every gate" />
            <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((s) => (
                <li key={s.n} className="rounded-lg border border-line bg-canvas p-5">
                  <span
                    aria-hidden="true"
                    className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-ink"
                  >
                    {s.n}
                  </span>
                  <h3 className="mt-4 font-semibold">
                    <span className="sr-only">Step {s.n}: </span>
                    {s.title}
                  </h3>
                  <p className="mt-1 text-sm text-ink-muted">{s.body}</p>
                </li>
              ))}
            </ol>

            <ul className="mt-12 grid gap-6 border-t border-line pt-10 sm:grid-cols-2 lg:grid-cols-4">
              {principles.map((p) => (
                <li key={p.title} className="flex gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
                    <Icon path={p.icon} className="size-[1.1rem]" />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold">{p.title}</h3>
                    <p className="mt-0.5 text-sm text-ink-muted">{p.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-line">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
            <div className="flex flex-col items-start justify-between gap-6 rounded-xl bg-primary px-6 py-10 text-primary-ink sm:px-10 md:flex-row md:items-center">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">
                  Get ready for your next event
                </h2>
                <p className="mt-2 max-w-xl opacity-90">
                  Create an account as an organizer, a venue or a service provider. Provider
                  listings are reviewed before organizers see them.
                </p>
              </div>
              <Link
                href="/sign-up"
                className="inline-flex h-12 shrink-0 items-center rounded-md bg-primary-ink px-6 font-medium text-primary transition-opacity hover:opacity-90 focus-visible:outline-primary-ink"
              >
                Create an account
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>HalaEvents — event planning with approvals built in.</p>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/sign-in" className="rounded-sm hover:text-ink">
              Sign in
            </Link>
          </nav>
        </div>
      </footer>
    </>
  );
}

function SectionHeading({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body?: string;
}) {
  return (
    <div className="max-w-2xl">
      <p className="text-sm font-semibold text-accent">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight text-balance">{title}</h2>
      {body && <p className="mt-3 text-ink-muted">{body}</p>}
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-line bg-canvas p-6 transition-shadow hover:shadow-sm">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-ink-muted">{body}</p>
    </div>
  );
}

/** Product illustration. Sample content only — labelled as such, not real data. */
function PlanIllustration() {
  const rows = [
    { task: "Confirm venue booking", tag: "Awaiting provider", tone: "warning" as const },
    { task: "Publish code of conduct", tag: "Recommended", tone: "info" as const },
    { task: "Check event permit requirement", tag: "Conditional", tone: "accent" as const },
    { task: "Send acceptance emails", tag: "Needs approval", tone: "primary" as const },
  ];
  return (
    <figure className="relative motion-safe:animate-rise motion-safe:[animation-delay:120ms]">
      <div className="rounded-xl border border-line bg-surface p-5 shadow-lg">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-ink-muted">Sample plan</p>
            <p className="font-semibold">Campus Hackathon</p>
          </div>
          <DemoBadge>Illustration</DemoBadge>
        </div>
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
          {rows.map((r) => (
            <li
              key={r.task}
              className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
            >
              <span className="flex items-center gap-2.5">
                <span aria-hidden="true" className="size-4 rounded border border-line-strong" />
                {r.task}
              </span>
              <Badge tone={r.tone}>{r.tag}</Badge>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-center justify-between rounded-lg bg-primary-soft px-3 py-2.5 text-sm">
          <span className="text-ink">Draft: “You’re in!” acceptance email</span>
          <span className="font-medium text-primary">Review →</span>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-xs text-ink-muted">
        Illustrative sample — not live data.
      </figcaption>
    </figure>
  );
}
