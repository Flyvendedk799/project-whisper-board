import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
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

const fns = vi.hoisted(() => ({
  addPlanComment: vi.fn(async () => ({ id: "c-new" })),
  answerClientQuestion: vi.fn(async () => ({ ok: true })),
  askClientQuestion: vi.fn(async () => ({ id: "q-new" })),
  deletePlanComment: vi.fn(async () => ({ ok: true })),
  setSectionApproval: vi.fn(async () => ({ ok: true })),
  setSectionClientSummary: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/plan-client-view.functions", () => fns);

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
              features: [
                { id: "f1", text: "Log ind uden at dele adgangskoder", met: true },
                { id: "f2", text: "Et klart fejlbesked, hvis det går galt", met: false },
              ],
              questions: [
                {
                  id: "q1",
                  body: "Hvor længe må vi gemme oplysningerne?",
                  status: "open",
                  from_client: false,
                  awaiting_client: true,
                  answer: null,
                  created_at: "2026-10-09T09:00:00Z",
                  answered_at: null,
                },
                {
                  id: "q2",
                  body: "Kan vi få en tidsplan?",
                  status: "answered",
                  from_client: true,
                  awaiting_client: false,
                  answer: "Ja, den kommer på fredag.",
                  created_at: "2026-10-08T09:00:00Z",
                  answered_at: "2026-10-08T10:00:00Z",
                },
              ],
            },
            {
              id: "t2",
              title: "Forbindelsen holder sig selv i gang",
              summary: null,
              status: "done",
              position: 2,
              steps: [],
              features: [],
              questions: [],
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
    comments: [
      {
        id: "k1",
        section_id: null,
        task_id: "t1",
        body: "Det her mangler jeg svar på.",
        created_at: "2026-10-09T09:30:00Z",
        author: { id: "me", full_name: "Nicolai", email: null, avatar_url: null },
      },
    ],
    approvals: [],
  },
}));

vi.mock("@/data/planner", () => ({
  clientPlanQuery: () => ({
    queryKey: ["client-plan", "plan-1"],
    queryFn: async () => view.current,
  }),
}));

beforeEach(() => vi.clearAllMocks());
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
    expect(within(board).getAllByText("I gang").length).toBeGreaterThan(0);
    expect(within(board).getByText(/1 af 3 opgaver færdige/)).toBeInTheDocument();
    // What is waiting for the client is visible without opening anything.
    expect(within(board).getAllByText(/1 spørgsmål til dig/).length).toBeGreaterThan(0);
  });

  it("tells the client up front that a question is waiting, and opens it", async () => {
    const user = userEvent.setup();
    renderWithQuery(<ClientPlanScreen planId="plan-1" />);

    expect(await screen.findByText(/1 spørgsmål venter på dit svar/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Besvar nu" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Hvor længe må vi gemme oplysningerne?")).toBeInTheDocument();
  });

  it("opens a task to what it must deliver, its steps and the conversation", async () => {
    const user = userEvent.setup();
    renderWithQuery(<ClientPlanScreen planId="plan-1" />);

    await user.click(await screen.findByRole("button", { name: /Sikkert login til Zenegy/ }));
    const dialog = await screen.findByRole("dialog");

    expect(
      within(dialog).getByText("Virksomheden godkender selv forbindelsen."),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: /Det skal leveres/ })).toBeInTheDocument();
    expect(within(dialog).getByText("Log ind uden at dele adgangskoder")).toBeInTheDocument();
    expect(within(dialog).getByText("Et klart fejlbesked, hvis det går galt")).toBeInTheDocument();
    expect(within(dialog).getByText("Vi har lavet log ind-siden")).toBeInTheDocument();
    expect(within(dialog).getByText("Vi tester den")).toBeInTheDocument();
    expect(within(dialog).getByText("Det her mangler jeg svar på.")).toBeInTheDocument();
    // Their own earlier question and our answer.
    expect(within(dialog).getByText("Ja, den kommer på fredag.")).toBeInTheDocument();
  });

  it("lets the client answer a question put to them", async () => {
    const user = userEvent.setup();
    renderWithQuery(<ClientPlanScreen planId="plan-1" />);

    await user.click(await screen.findByRole("button", { name: /Sikkert login til Zenegy/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByRole("textbox", { name: /Dit svar/ }),
      "Op til 12 måneder.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Send svar" }));

    await waitFor(() =>
      expect(fns.answerClientQuestion).toHaveBeenCalledWith({
        data: { questionId: "q1", answer: "Op til 12 måneder." },
      }),
    );
  });

  it("lets the client ask their own question and comment on the task", async () => {
    const user = userEvent.setup();
    renderWithQuery(<ClientPlanScreen planId="plan-1" />);

    await user.click(await screen.findByRole("button", { name: /Sikkert login til Zenegy/ }));
    const dialog = await screen.findByRole("dialog");

    await user.type(
      within(dialog).getByRole("textbox", { name: "Stil et spørgsmål til os" }),
      "Hvad koster det?",
    );
    await user.click(within(dialog).getByRole("button", { name: "Stil spørgsmål" }));
    await waitFor(() =>
      expect(fns.askClientQuestion).toHaveBeenCalledWith({
        data: { taskId: "t1", body: "Hvad koster det?" },
      }),
    );

    await user.type(
      within(dialog).getByRole("textbox", { name: "Skriv en kommentar til opgaven" }),
      "Tak!",
    );
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(fns.addPlanComment).toHaveBeenCalledWith({
        data: { planId: "plan-1", sectionId: null, taskId: "t1", body: "Tak!" },
      }),
    );
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
