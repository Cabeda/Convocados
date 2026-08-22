// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { AddPlayerConfirmDialog, type AddPlayerIntent } from "~/components/event/AddPlayerConfirmDialog";

afterEach(() => cleanup());

// Minimal translation stub so the dialog renders without locale data
vi.mock("~/lib/useT", () => ({
  useT: () => (key: string, params?: Record<string, string>) => {
    const map: Record<string, string> = {
      cancel: "Cancel",
      addOrInviteTitle: "Add or invite {name}?",
      addOrInviteDesc: "Choose how to add {name} to {eventName}.",
      choiceAddTitle: "Add to list",
      choiceAddDesc: "Adds {name} to the list right away. No notification.",
      choiceAddDescBench: "Adds {name} to the list right away — no notification. The roster is full, so they'll sit on the bench.",
      choiceInviteTitle: "Invite",
      choiceInviteDescEmail: "Sends an invite to {email} — they accept before joining.",
      choiceInviteDescUser: "Sends {name} a link to confirm they're coming.",
      inviteNeedsEmailHint: "Add an email to send an invite.",
    };
    let v = map[key] ?? key;
    for (const [k, val] of Object.entries(params ?? {})) v = v.replace(`{${k}}`, val);
    return v;
  },
}));

function renderDialog(intent: AddPlayerIntent | null, overrides: Partial<Parameters<typeof AddPlayerConfirmDialog>[0]> = {}) {
  const props = {
    intent,
    eventName: "Friday Padel",
    isBench: false,
    isAdding: false,
    isInviting: false,
    onConfirmAdd: vi.fn(),
    onConfirmInvite: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<AddPlayerConfirmDialog {...props} />) };
}

describe("AddPlayerConfirmDialog — invite vs add choice", () => {
  it("shows both Add to list and Invite options for a known user", () => {
    renderDialog({ kind: "single", name: "Charlie", userId: "u-charlie", source: "chip" });
    expect(screen.getByText("Add or invite Charlie?")).toBeTruthy();
    expect(screen.getByText("Add to list")).toBeTruthy();
    expect(screen.getByText("Adds Charlie to the list right away. No notification.")).toBeTruthy();
    expect(screen.getByText("Invite")).toBeTruthy();
    expect(screen.getByText("Sends Charlie a link to confirm they're coming.")).toBeTruthy();
  });

  it("shows the email variant of the Invite option for an email address", () => {
    renderDialog({ kind: "single", name: "John", email: "john@example.com", source: "input" });
    expect(screen.getByText("Add to list")).toBeTruthy();
    expect(screen.getByText("Sends an invite to john@example.com — they accept before joining.")).toBeTruthy();
  });

  it("hides the Invite option for a plain name with no contact channel and shows a hint", () => {
    renderDialog({ kind: "single", name: "Newcomer", source: "input" });
    expect(screen.getByText("Add to list")).toBeTruthy();
    expect(screen.queryByText("Invite")).toBeNull();
    expect(screen.getByText("Add an email to send an invite.")).toBeTruthy();
  });

  it("appends the bench footnote to the Add option when the roster is full", () => {
    renderDialog(
      { kind: "single", name: "Charlie", userId: "u-charlie", source: "chip" },
      { isBench: true },
    );
    expect(screen.getByText(/The roster is full/)).toBeTruthy();
  });

  it("dispatches the add when the Add to list option is clicked", () => {
    const intent: AddPlayerIntent = { kind: "single", name: "Charlie", userId: "u-charlie", source: "chip" };
    const { props } = renderDialog(intent);
    fireEvent.click(screen.getByText("Add to list"));
    expect(props.onConfirmAdd).toHaveBeenCalledWith(intent);
    expect(props.onConfirmInvite).not.toHaveBeenCalled();
  });

  it("dispatches the invite when the Invite option is clicked", () => {
    const intent: AddPlayerIntent = { kind: "single", name: "Charlie", userId: "u-charlie", source: "chip" };
    const { props } = renderDialog(intent);
    fireEvent.click(screen.getByText("Invite"));
    expect(props.onConfirmInvite).toHaveBeenCalledWith(intent);
    expect(props.onConfirmAdd).not.toHaveBeenCalled();
  });

  it("disables the options while an add or invite is in flight", () => {
    renderDialog(
      { kind: "single", name: "Charlie", userId: "u-charlie", source: "chip" },
      { isInviting: true },
    );
    expect((screen.getByText("Add to list").closest("button") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("Invite").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not render when intent is null", () => {
    renderDialog(null);
    expect(screen.queryByText(/Charlie/)).toBeNull();
  });
});