import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDeleteDialog } from "./confirm-delete-dialog";

afterEach(cleanup);

function renderDialog(props: Partial<Parameters<typeof ConfirmDeleteDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ConfirmDeleteDialog
      open
      onOpenChange={onOpenChange}
      title="Delete Acme?"
      onConfirm={onConfirm}
      {...props}
    >
      <p>Everything goes.</p>
    </ConfirmDeleteDialog>,
  );
  return { onConfirm, onOpenChange };
}

describe("ConfirmDeleteDialog", () => {
  it("confirms straight away when no name is required", async () => {
    const { onConfirm } = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("holds the button until the exact text is typed", async () => {
    const { onConfirm } = renderDialog({ confirmText: "Acme" });
    const button = screen.getByRole("button", { name: "Delete" });
    expect(button).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Type/), "acme");
    expect(button).toBeDisabled();

    await userEvent.clear(screen.getByLabelText(/Type/));
    await userEvent.type(screen.getByLabelText(/Type/), "Acme");
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("confirms on Enter in the field, but only once it matches", async () => {
    const { onConfirm } = renderDialog({ confirmText: "Acme" });
    await userEvent.type(screen.getByLabelText(/Type/), "Ac{Enter}");
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText(/Type/), "me{Enter}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("cannot be dismissed while the delete is running", async () => {
    const { onOpenChange } = renderDialog({ busy: true });
    expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("shows no delete button when the delete is blocked", () => {
    renderDialog({ blocked: true, confirmText: "Acme" });
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.queryByLabelText(/Type/)).toBeNull();
  });
});
