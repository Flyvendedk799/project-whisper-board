import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/test/render";
import { TicketDeleteDialog } from "./ticket-delete-dialog";

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("sonner", () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { toast, Toaster: () => null };
});

const fns = vi.hoisted(() => ({
  deleteTickets: vi.fn(),
}));
vi.mock("@/lib/tickets.functions", () => ({ deleteTickets: fns.deleteTickets }));

afterEach(() => {
  cleanup();
  fns.deleteTickets.mockReset();
});

describe("TicketDeleteDialog", () => {
  it("names the ticket, and deletes only after the button is pressed", async () => {
    fns.deleteTickets.mockResolvedValue({ deleted: ["t1"], failed: [] });
    const onDeleted = vi.fn();
    const onOpenChange = vi.fn();
    renderWithQuery(
      <TicketDeleteDialog
        tickets={[{ id: "t1", title: "Duplicate report", number: 7 }]}
        open
        onOpenChange={onOpenChange}
        onDeleted={onDeleted}
      />,
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete ticket #7?")).toBeInTheDocument();
    expect(within(dialog).getByText("Duplicate report")).toBeInTheDocument();
    expect(fns.deleteTickets).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole("button", { name: "Delete ticket" }));

    await waitFor(() => expect(fns.deleteTickets).toHaveBeenCalledTimes(1));
    expect(fns.deleteTickets.mock.calls[0][0]).toEqual({ data: { ticketIds: ["t1"] } });
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(["t1"]));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("deletes a whole selection in one request", async () => {
    fns.deleteTickets.mockResolvedValue({ deleted: ["a", "b"], failed: [] });
    renderWithQuery(
      <TicketDeleteDialog tickets={[{ id: "a" }, { id: "b" }]} open onOpenChange={vi.fn()} />,
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete 2 tickets?")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Delete 2 tickets" }));

    await waitFor(() => expect(fns.deleteTickets).toHaveBeenCalledTimes(1));
    expect(fns.deleteTickets.mock.calls[0][0]).toEqual({ data: { ticketIds: ["a", "b"] } });
  });

  it("stays open and leaves the page alone when the server refuses", async () => {
    fns.deleteTickets.mockRejectedValue(new Error("nope"));
    const onDeleted = vi.fn();
    const onOpenChange = vi.fn();
    renderWithQuery(
      <TicketDeleteDialog
        tickets={[{ id: "t1" }]}
        open
        onOpenChange={onOpenChange}
        onDeleted={onDeleted}
      />,
    );
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete ticket" }));

    await waitFor(() => expect(fns.deleteTickets).toHaveBeenCalled());
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
