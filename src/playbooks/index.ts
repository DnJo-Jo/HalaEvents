import { PlaybookSchema, type Playbook } from "@/modules/planning/playbook";
import type { EventType } from "@/modules/events/schemas";
import conference from "../../playbooks/conference.json";
import universityHackathon from "../../playbooks/university-hackathon.json";
import workshop from "../../playbooks/workshop.json";

/**
 * Playbooks are versioned JSON data in /playbooks (event.md §6.4, §17.2). Each is parsed once at
 * import: an invalid playbook throws here, so tests and the build fail before any user sees it.
 */
const PLAYBOOKS: Record<EventType, Playbook> = {
  university_hackathon: PlaybookSchema.parse(universityHackathon),
  conference: PlaybookSchema.parse(conference),
  workshop: PlaybookSchema.parse(workshop),
};

export function playbookFor(eventType: EventType): Playbook {
  return PLAYBOOKS[eventType];
}
