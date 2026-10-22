import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TR } from "@/components/ui/table";

describe("Button", () => {
  it("defaults to type=button so it never submits forms by accident", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("type", "button");
  });

  it("is disabled and busy while loading", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("FormField", () => {
  it("associates label, hint and error with the control", () => {
    render(
      <FormField
        label="Capacity"
        hint="Maximum attendees."
        error="Must be greater than 0."
        required
      >
        <Input />
      </FormField>,
    );
    const input = screen.getByLabelText(/Capacity/);
    expect(input).toBeRequired();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Maximum attendees. Must be greater than 0.");
  });

  it("keeps an explicit id on the control", () => {
    render(
      <FormField label="Name">
        <Input id="event-name" />
      </FormField>,
    );
    expect(screen.getByLabelText("Name")).toHaveAttribute("id", "event-name");
  });
});

describe("Alert", () => {
  it("announces danger immediately and other tones politely", () => {
    const { rerender } = render(<Alert tone="danger" title="Failed" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Failed");
    rerender(<Alert tone="info" title="Note" />);
    expect(screen.getByRole("status")).toHaveTextContent("Note");
  });
});

describe("EmptyState", () => {
  it("renders title, description and action", () => {
    render(
      <EmptyState title="No events" description="Create one." action={<Button>Create</Button>} />,
    );
    expect(screen.getByRole("heading", { name: "No events" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  });
});

describe("Table", () => {
  it("exposes a caption and a keyboard-focusable scroll region", () => {
    render(
      <Table caption="Attendees">
        <TBody>
          <TR>
            <TD>Sample</TD>
          </TR>
        </TBody>
      </Table>,
    );
    expect(screen.getByRole("table", { name: "Attendees" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Attendees" })).toHaveAttribute("tabindex", "0");
  });
});

describe("ConfirmDialog", () => {
  const setup = (props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Send emails?"
        description="This sends 3 emails."
        confirmLabel="Send"
        onConfirm={onConfirm}
        onCancel={onCancel}
        {...props}
      />,
    );
    return { onConfirm, onCancel };
  };

  it("is an accessible alertdialog with title and description", () => {
    setup();
    const dialog = screen.getByRole("alertdialog", { name: "Send emails?" });
    expect(dialog).toHaveAccessibleDescription("This sends 3 emails.");
  });

  it("calls onConfirm / onCancel from the buttons", async () => {
    const { onConfirm, onCancel } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("blocks both actions while pending", () => {
    setup({ pending: true });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});
