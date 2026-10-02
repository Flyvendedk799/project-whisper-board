import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/test/render";
import { ProjectDeleteDialog } from "./project-delete-dialog";

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ workspaceId: "w1" }) }));
vi.mock("sonner", () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { toast, Toaster: () => null };
});

const fns = vi.hoisted(() => ({
  getProjectDeletionImpact: vi.fn(),
  deleteProject: vi.fn(async () => ({ ok: true })),
  setProjectStatus: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/projects.functions", () => ({
  getProjectDeletionImpact: fns.getProjectDeletionImpact,
  deleteProject: fns.deleteProject,
}));
vi.mock("@/lib/tickets.functions", () => ({ setProjectStatus: fns.setProjectStatus }));

const EMPTY = {
  tickets: 0,
  milestones: 0,
  meetings: 0,
  updates: 0,
  timeEntries: 0,
  quotes: 0,
  invoices: 0,
  issuedInvoices: 0,
  plans: 0,
};

const PROJECT = { id: "p1", title: "Acme storefront", status: "in_progress" };

afterEach(() => {
  cleanup();
  for (const fn of Object.values(fns)) fn.mockClear();
});

function renderDialog(onDeleted = vi.fn()) {
  return {
    onDeleted,
    ...renderWithQuery(
      <ProjectDeleteDialog project={PROJECT} open onOpenChange={vi.fn()} onDeleted={onDeleted} />,
    ),
  };
}

describe("ProjectDeleteDialog", () => {
  it("lists what goes, notes the plans that stay, and asks for the title", async () => {
    fns.getProjectDeletionImpact.mockResolvedValue({
      ...EMPTY,
      tickets: 12,
      milestones: 1,
      plans: 2,
    });
    const { onDeleted } = renderDialog();
    const dialog = await screen.findByRole("alertdialog");

    expect(await within(dialog).findByText(/12 tickets and 1 milestone/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Its 2 plans stay in the Planner/)).toBeInTheDocument();

    const confirm = within(dialog).getByRole("button", { name: "Delete project" });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Type/), "Acme storefront");
    await userEvent.click(confirm);

    await waitFor(() => expect(fns.deleteProject).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });

  it("refuses a project with issued invoices and offers archiving instead", async () => {
    fns.getProjectDeletionImpact.mockResolvedValue({ ...EMPTY, invoices: 3, issuedInvoices: 2 });
    renderDialog();
    const dialog = await screen.findByRole("alertdialog");

    expect(await within(dialog).findByText(/2 issued invoices/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Delete project" })).toBeNull();
    expect(within(dialog).queryByLabelText(/Type/)).toBeNull();

    await userEvent.click(within(dialog).getByRole("button", { name: "Archive project" }));
    await waitFor(() => expect(fns.setProjectStatus).toHaveBeenCalledTimes(1));
    expect(fns.deleteProject).not.toHaveBeenCalled();
  });

  it("does not ask for the name when the project is empty", async () => {
    fns.getProjectDeletionImpact.mockResolvedValue(EMPTY);
    renderDialog();
    const dialog = await screen.findByRole("alertdialog");

    expect(await within(dialog).findByText(/It’s empty/)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Type/)).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Delete project" })).toBeEnabled();
  });

  it("keeps delete off until it knows what is in the project", async () => {
    fns.getProjectDeletionImpact.mockReturnValue(new Promise(() => undefined));
    renderDialog();
    const dialog = await screen.findByRole("alertdialog");

    expect(within(dialog).getByText(/Checking what’s in this project/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Delete project" })).toBeDisabled();
  });
});
