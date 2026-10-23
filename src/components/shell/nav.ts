/**
 * Authenticated-shell navigation. Every `href` must resolve to a real page file
 * (enforced by tests/unit/shell/nav.test.ts). `phase` refers to docs/IMPLEMENTATION_PLAN.md.
 */
export interface NavItem {
  href: string;
  label: string;
  /** Lucide-style 24×24 stroke path data. */
  icon: string;
  /** Implementation phase that builds it, or "live" once it works. */
  phase: string;
  /** Shown only to members with this capability (the pages still authorize on the server). */
  audience?: "provider" | "admin";
  summary: string;
  planned: string[];
}

export const appNav: NavItem[] = [
  {
    href: "/app",
    label: "Overview",
    icon: "M3 12 12 4l9 8M5 10v10h5v-6h4v6h5V10",
    phase: "live",
    summary:
      "Your events at a glance: what needs attention, what is blocked, what is waiting for approval.",
    planned: [
      "Upcoming events and their lifecycle status",
      "Overdue and blocked tasks",
      "Approvals waiting for your decision",
    ],
  },
  {
    href: "/app/events",
    label: "Events",
    icon: "M8 3v4M16 3v4M4 9h16M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z",
    phase: "live",
    summary: "Create an event, answer the adaptive interview, and generate a source-aware plan.",
    planned: [
      "Event profile: type, venue, dates, timezone, capacity, budget",
      "Adaptive interview driven by the university-hackathon playbook",
      "Plan suggestions you accept or reject one by one",
    ],
  },
  {
    href: "/app/marketplace",
    label: "Marketplace",
    icon: "M3 9l1.5-5h15L21 9M3 9h18M3 9v11h18V9M9 20v-6h6v6",
    phase: "live",
    summary: "Find verified venues, caterers and AV providers, request quotes, and track bookings.",
    planned: [
      "Verified providers only, ranked by a deterministic, explainable score",
      "Service requests and quotes",
      "Bookings confirmed by the provider themselves — never assumed",
    ],
  },
  {
    href: "/app/provider",
    label: "My business",
    icon: "M4 7h16v13H4zM9 7V4h6v3M4 12h16",
    phase: "live",
    audience: "provider",
    summary: "Your venue or service listings, credentials and verification.",
    planned: [],
  },
  {
    href: "/app/provider/requests",
    label: "Quote requests",
    icon: "M4 4h16v12H7l-3 3zM8 9h8M8 12h5",
    phase: "live",
    audience: "provider",
    summary: "Requests organizers sent to your listings, questions and your quotes.",
    planned: [],
  },
  {
    href: "/app/provider/bookings",
    label: "Bookings",
    icon: "M8 3v4M16 3v4M4 9h16M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM9 15l2 2 4-4",
    phase: "live",
    audience: "provider",
    summary: "Booking requests from organizers: confirm, decline, cancel or dispute.",
    planned: [],
  },
  {
    href: "/app/tasks",
    label: "Tasks",
    icon: "M9 11l3 3 8-8M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h11",
    phase: "live",
    summary: "Plan tasks with owners, deadlines and dependencies.",
    planned: [
      "Dependencies with cycle checks",
      "Blocked and overdue status derived automatically",
      "Owners and due dates in the event's timezone",
    ],
  },
  {
    href: "/app/attendees",
    label: "Attendees",
    icon: "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM21 19v-1a4 4 0 0 0-3-3.87M16 4.13a3 3 0 0 1 0 5.75",
    phase: "live",
    summary: "Public registration, application review, and capacity-safe acceptance.",
    planned: [],
  },
  {
    href: "/app/messages",
    label: "Messages",
    icon: "M4 6h16v12H4zM4 7l8 6 8-6",
    phase: "live",
    summary: "Draft communications, send them through an approval gate, and track delivery.",
    planned: [],
  },
  {
    href: "/app/compliance",
    label: "Compliance",
    icon: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3ZM9 12l2 2 4-4",
    phase: "live",
    summary:
      "The curated official-source registry. Each event's checks are on its Compliance page.",
    planned: [],
  },
  {
    href: "/app/notifications",
    label: "Notifications",
    icon: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0",
    phase: "live",
    summary: "In-app reminders: deadlines, missing information, compliance changes and decisions.",
    planned: [],
  },
  {
    href: "/app/reviews",
    label: "Reviews",
    icon: "M12 3l2.7 5.5 6 .9-4.4 4.2 1 6L12 16.8 6.7 19.6l1-6L3.3 9.4l6-.9z",
    phase: "live",
    summary:
      "Review providers after a completed booking, respond to reviews, and dispute unfair ones.",
    planned: [],
  },
  {
    href: "/app/admin/providers",
    label: "Provider review",
    icon: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3ZM9 12l2 2 4-4",
    phase: "live",
    audience: "admin",
    summary: "Verify businesses, review credentials and moderate listings.",
    planned: [],
  },
  {
    href: "/app/admin/bookings",
    label: "Booking disputes",
    icon: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
    phase: "live",
    audience: "admin",
    summary: "Resolve disputed bookings.",
    planned: [],
  },
  {
    href: "/app/admin/reviews",
    label: "Review moderation",
    icon: "M12 3l2.7 5.5 6 .9-4.4 4.2 1 6L12 16.8 6.7 19.6l1-6L3.3 9.4l6-.9z",
    phase: "live",
    audience: "admin",
    summary: "Reports and disputes about reviews, and the provider-review policy.",
    planned: [],
  },
  {
    href: "/app/settings",
    label: "Settings",
    icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z",
    phase: "live",
    summary: "Your profile, roles and account.",
    planned: ["Profile and contact details", "Account roles", "Provider profile onboarding (P9)"],
  },
];

export function navItem(href: string): NavItem {
  const item = appNav.find((i) => i.href === href);
  if (!item) throw new Error(`Unknown nav href: ${href}`);
  return item;
}

/** Overview matches exactly; other items match their subtree. */
export function isActive(href: string, pathname: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function visibleNav(ctx: { roles: string[]; isAdmin: boolean } | null): NavItem[] {
  const isProvider = !!ctx?.roles.some((r) => r === "venue_provider" || r === "service_provider");
  return appNav.filter(
    (i) =>
      !i.audience ||
      (i.audience === "provider" && isProvider) ||
      (i.audience === "admin" && ctx?.isAdmin),
  );
}
