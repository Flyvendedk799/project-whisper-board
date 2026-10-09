import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { renderWithQuery } from "@/test/render";
import type { ClientPlanView } from "@/lib/plan-client-view";
import { ClientPlanScreen } from "./client-plan-screen";

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ user: { id: "me" }, workspaceId: "w1", isAdmin: false }),
}));

vi.mock("@/lib/plan-client-view.functions", () => ({
  addPlanComment: vi.fn(),
  deletePlanComment: vi.fn(),
  setSectionApproval: vi.fn(),
  setSectionClientSummary: vi.fn(),
}));

const view = vi.hoisted<{ current: ClientPlanView }>(() => ({
  current: {
    plan: {
      id: "plan-1",
      title: "Zenegy Partner",
      status: "draft",
      project_id: "p1",
      updated_at: "2026-10-09T10:00:00Z",
      sections: [
        {
          id: "s1",
          title: "Forbindelse",
          color: "var(--chart-1)",
          position: 1,
          client_summary: "Vi bygger den sikre forbindelse.",
          task_count: 3,
          done_task_count: 1,
          unwritten_task_count: 1,
          tasks: [
            {
              id: "t1",
              title: "Sikkert login til Zenegy",
              summary: "Virksomheden godkender selv forbindelsen.",
              status: "in_progress",
              position: 1,
              steps: [
                { id: "st1", text: "Vi har lavet log ind-siden", done: true },
                { id: "st2", text: "Vi tester den", done: false },
              ],
            },
            {
              id: "t2",
              title: "Forbindelsen holder sig selv i gang",
              summary: null,
              status: "done",
              position: 2,
              steps: [],
            },
          ],
        },
        {
          id: "s2",
          title: "Lancering",
          color: null,
          position: 2,
          client_summary: null,
          task_count: 2,
          done_task_count: 0,
          unwritten_task_count: 2,
          tasks: [],
        },
      ],
    },
    comments: [],
    approvals: [],
  },
}));

vi.mock("@/data/planner", () => ({
  clientPlanQuery: () => ({
    queryKey: ["client-plan", "plan-1"],
    queryFn: async () => view.current,
  }),
}));

afterEach(cleanup);

describe("ClientPlanScreen", () => {
  it("lays the sections out as columns with the Danish summary and plain task cards", async () => {
    renderWithQuery(<ClientPlanScreen planId="plan-1" />);

    const board = await screen.findByRole("list", { name: "Planens afsnit" });
    expect(within(board).getByRole("heading", { name: "Forbindelse" })).toBeInTheDocument();
    expect(within(board).getByRole("heading", { name: "Lancering" })).toBeInTheDocument();
    expect(within(board).getByText("Vi bygger den sikre forbindelse.")).toBeInTheDocument();

    expect(within(board).getByText("Sikkert login til Zenegy")).toBeInTheDocument();
    expect(within(board).getByText("Forbindelsen holder sig selv i gang")).toBeInTheDocument();
    // Status in plain words, and an honest count over every task.
    expect(within(board).getAllByText("I gang").length).toBeGreaterThan(0);
    expect(within(board).getByText(/1 af 3 opgaver færdige/)).toBeInTheDocument();
  });

  it("opens a task to its summary and plain steps", async () => {
    const user = userEvent.setup();
    renderWithQuery(<ClientPlanScreen planId="plan-1" />);

    expect(screen.queryByText("Vi har lavet log ind-siden")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /Sikkert login til Zenegy/ }));

    expect(screen.getByText("Virksomheden godkender selv forbindelsen.")).toBeInTheDocument();
    expect(screen.getByText("Vi har lavet log ind-siden")).toBeInTheDocument();
    expect(screen.getByText("Vi tester den")).toBeInTheDocument();
  });

  it("says so when a section's tasks are not described yet instead of showing nothing", async () => {
    renderWithQuery(<ClientPlanScreen planId="plan-1" />);
    expect(await screen.findByText(/bliver beskrevet her/)).toBeInTheDocument();
  });

  it("does not warn a client about hidden tasks, but tells the agency preview", async () => {
    renderWithQuery(<ClientPlanScreen planId="plan-1" />);
    await screen.findByRole("list", { name: "Planens afsnit" });
    expect(screen.queryByText(/hidden because/)).not.toBeInTheDocument();
    cleanup();

    renderWithQuery(<ClientPlanScreen planId="plan-1" preview />);
    expect(
      await screen.findByText(/3 tasks are hidden because they have no client title/),
    ).toBeInTheDocument();
  });
});
