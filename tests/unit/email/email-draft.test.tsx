import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const DRAFT = {
  ok: true as const,
  draft: {
    to: "",
    subject: "Catering quotation request: Campus Hack [HE-ABCD1234]",
    body: "Hello,\n\nPlease send a quotation.\n\nKind regards,\n[Your name]",
    source: "template" as const,
    reference: "HE-ABCD1234",
    vendorName: null,
    category: "catering" as const,
    notice: "A custom draft couldn't be written this time, so this is a template draft.",
  },
};
vi.mock("@/modules/email/actions", () => ({ draftEmailAction: vi.fn(async () => DRAFT) }));

const { EmailDraft } = await import("@/components/email/email-draft");
const targets = {
  categories: [{ value: "catering", label: "Catering" }],
  vendors: [],
  customAvailable: false,
  organizerEmail: "organizer@gmail.com" as string | null,
  vendorEmail: "vendor@gmail.com" as string | null,
};

afterEach(cleanup);

async function drafted(t: typeof targets = targets) {
  render(<EmailDraft eventId="e" targets={t} />);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "catering" } });
  fireEvent.click(screen.getByRole("button", { name: "Create a draft" }));
  return screen.findByLabelText(/Subject/);
}

describe("EmailDraft", () => {
  it("shows an editable preview; the Gmail link follows the edits and opens a new tab", async () => {
    const subject = await drafted();
    expect(screen.getByText(/this is a template draft/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/To \(optional\)/), { target: { value: "v@x.co" } });
    fireEvent.change(subject, { target: { value: "My subject [HE-ABCD1234]" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Edited & sent?" } });
    const link = screen.getByRole("link", { name: "Open in Gmail" });
    const u = new URL(link.getAttribute("href")!);
    expect(u.origin + u.pathname).toBe("https://mail.google.com/mail/");
    expect(u.searchParams.get("to")).toBe("v@x.co");
    expect(u.searchParams.get("su")).toBe("My subject [HE-ABCD1234]");
    expect(u.searchParams.get("body")).toBe("Edited & sent?");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText(/doesn.t send anything or save a draft/)).toBeTruthy();
  });

  it("an empty recipient is fine, and an over-long message disables Gmail but keeps Copy", async () => {
    await drafted({ ...targets, vendorEmail: null });
    expect(
      new URL(
        screen.getByRole("link", { name: "Open in Gmail" }).getAttribute("href")!,
      ).searchParams.has("to"),
    ).toBe(false);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "x ".repeat(5000) } });
    expect(screen.queryByRole("link", { name: "Open in Gmail" })).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Open in Gmail" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText(/too long to pass to Gmail/)).toBeTruthy();

    const writeText = vi.fn(async (_text: string) => {});
    Object.assign(navigator, { clipboard: { writeText } });
    fireEvent.click(screen.getByRole("button", { name: "Copy email" }));
    await waitFor(() => expect(screen.getByText("Copied.")).toBeTruthy());
    expect(writeText.mock.calls[0][0]).toContain("Catering quotation request");
  });

  it("composes from the organizer's account and prefills the vendor in To (editable)", async () => {
    const subject = await drafted();
    const open = () =>
      new URL(screen.getByRole("link", { name: "Open in Gmail" }).getAttribute("href")!);
    let u = open();
    expect(u.origin + u.pathname).toBe("https://mail.google.com/mail/");
    expect(u.searchParams.get("authuser")).toBe("organizer@gmail.com");
    expect(u.searchParams.get("to")).toBe("vendor@gmail.com");
    // Subject and body (with the HE code) are passed through unchanged.
    expect(u.searchParams.get("su")).toBe(DRAFT.draft.subject);
    expect(u.searchParams.get("su")).toContain("[HE-ABCD1234]");
    expect(u.searchParams.get("body")).toBe(DRAFT.draft.body);
    expect((screen.getByLabelText(/To \(optional\)/) as HTMLInputElement).value).toBe(
      "vendor@gmail.com",
    );
    expect(screen.getByText("organizer@gmail.com")).toBeTruthy();
    expect(subject).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/To \(optional\)/), { target: { value: "" } });
    u = open();
    expect(u.searchParams.has("to")).toBe(false);
    expect(u.searchParams.get("authuser")).toBe("organizer@gmail.com");
  });

  it("without a connected account it names no account and warns instead", async () => {
    await drafted({ ...targets, organizerEmail: null, vendorEmail: null });
    const u = new URL(screen.getByRole("link", { name: "Open in Gmail" }).getAttribute("href")!);
    expect(u.searchParams.has("authuser")).toBe(false);
    expect(u.searchParams.has("to")).toBe(false);
    expect(screen.getByText("Sender account not set")).toBeTruthy();
  });
});
