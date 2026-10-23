import type { CommunicationKind, MessageDraft } from "./schemas";

/**
 * Starting points for each kind of message (event.md §21). Plain templates written by the HalaEvents
 * team: they use only the supported placeholders, contain no links, and never claim that a permit,
 * venue or booking is approved or confirmed. The organizer edits the text and sends it for approval.
 */
const SIGN_OFF = "The organizing team";

const TEMPLATES: Record<CommunicationKind, { subject: string; lines: string[] }> = {
  invitation: {
    subject: "You're invited to {{event_name}}",
    lines: [
      "We'd like to invite you to {{event_name}} on {{event_date}} in {{event_city}}.",
      "[Say what the event is about, who it is for and how to register.]",
    ],
  },
  registration_confirmation: {
    subject: "We received your registration for {{event_name}}",
    lines: [
      "Thank you for registering for {{event_name}} on {{event_date}} in {{event_city}}.",
      "We'll write to you again once your place has been reviewed.",
    ],
  },
  acceptance: {
    subject: "Your place at {{event_name}}",
    lines: [
      "Good news: your application for {{event_name}} on {{event_date}} in {{event_city}} has been accepted.",
      "[Add what to bring, when to arrive and who to contact.]",
    ],
  },
  waitlist: {
    subject: "You're on the waiting list for {{event_name}}",
    lines: [
      "All places for {{event_name}} on {{event_date}} are taken for now, so you've been added to the waiting list.",
      "If a place opens up we will contact you. Until then, please don't make plans that depend on attending.",
    ],
  },
  reminder: {
    subject: "Reminder: {{event_name}} on {{event_date}}",
    lines: [
      "This is a reminder that {{event_name}} takes place on {{event_date}} in {{event_city}}.",
      "[Add the arrival time, what to bring and who to contact.]",
    ],
  },
  venue_update: {
    subject: "Venue update for {{event_name}}",
    lines: [
      "We have an update about the venue for {{event_name}} on {{event_date}}.",
      "[Describe what changed and what participants need to do. Only state what has been confirmed.]",
    ],
  },
  schedule_update: {
    subject: "Schedule update for {{event_name}}",
    lines: [
      "The schedule for {{event_name}} on {{event_date}} has changed.",
      "[List the changes clearly, with the new times.]",
    ],
  },
  cancellation: {
    subject: "{{event_name}} has been cancelled",
    lines: [
      "We're sorry to tell you that {{event_name}} planned for {{event_date}} has been cancelled.",
      "[Explain briefly what happens next, such as refunds or a new date.]",
    ],
  },
  recovery: {
    subject: "Update about {{event_name}}",
    lines: [
      "We are working on a change to the arrangements for {{event_name}} on {{event_date}} and want you to hear it from us first.",
      "[Say what is known so far. Don't name a new venue until it has agreed.]",
    ],
  },
  thank_you: {
    subject: "Thank you for joining {{event_name}}",
    lines: [
      "Thank you for being part of {{event_name}} in {{event_city}}. We hope you enjoyed it.",
      "[Ask for feedback and share any next steps.]",
    ],
  },
};

/** The draft for one kind of message; the organizer's note, if any, is added as its own paragraph. */
export function templateDraft(kind: CommunicationKind, note?: string): MessageDraft {
  const t = TEMPLATES[kind];
  const paragraphs = [
    "Hello {{name}},",
    ...t.lines,
    ...(note?.trim() ? [note.trim()] : []),
    SIGN_OFF,
  ];
  return { subject: t.subject, body: paragraphs.join("\n\n") };
}
