import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { renderWithQuery } from "@/test/render";
import { PlanScreen } from "./plan-screen";

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ user: { id: "me" }, workspaceId: "w1", isAdmin: true }),
}));

vi.mock("@/integrations/supabase/client", () => {
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    supabase: {
      channel: () => channel,
      removeChannel: vi.fn(),
      auth: { getSession: async () => ({ data: { session: null } }) },
    },
  };
});

vi.mock("@/data/projects", async () => {
  const { queryOptions } = await import("@tanstack/react-query");
  return {
    workspacePeopleQuery: () =>
      queryOptions({
        queryKey: ["people"],
        queryFn: async () => [
          { id: "me", full_name: "Jonas Berg", email: "j@x.test", avatar_url: null },
        ],
      }),
    projectListQuery: () => queryOptions({ queryKey: ["projects"], queryFn: async () => [] }),
  };
});

vi.mock("@/data/tickets", async () => {
  const { queryOptions } = await import("@tanstack/react-query");
  return {
    ticketSearchQuery: () => queryOptions({ queryKey: ["ticket-search"], queryFn: async () => [] }),
  };
});

const fns = vi.hoisted(() => {
  const ok = () => vi.fn(async () => ({ ok: true }));
  return {
    getPlan: vi.fn(),
    getPlanEvents: vi.fn(),
    listPlanAttachments: vi.fn(),
    listTaskComments: vi.fn(),
    updateTaskStep: ok(),
    createTaskStep: vi.fn(async () => ({ id: "new-step" })),
    updateTask: ok(),
    moveTaskTo: ok(),
    createTask: vi.fn(async () => ({ id: "new-task" })),
    deleteTask: ok(),
    releaseTaskAgent: ok(),
    deleteTaskStep: ok(),
    convertDescriptionToSteps: vi.fn(async () => ({ created: 0 })),
    createSection: vi.fn(async () => ({ id: "s-new" })),
    updateSection: ok(),
    deleteSection: ok(),
    addTaskComment: vi.fn(async () => ({ id: "c-new" })),
    updatePlan: ok(),
    importOpenTickets: vi.fn(async () => ({ created: 0, skipped: 0, taskIds: [] })),
    importPlanMarkdown: vi.fn(),
    createApiKey: vi.fn(),
    revokeApiKey: ok(),
    updateApiKeyScopes: ok(),
    registerPlanAttachment: vi.fn(),
    deletePlanAttachment: ok(),
    setPlanAttachmentShared: ok(),
    signPlanAttachmentDownload: vi.fn(),
    listPlans: vi.fn(),
    listAgents: vi.fn(),
    listApiKeys: vi.fn(async () => ({ keys: [] })),
    listTasksByTicket: vi.fn(),
  };
});

vi.mock("@/lib/planner.functions", () => fns);
vi.mock("./plan-upload", () => ({ uploadPlanFile: vi.fn(async () => undefined) }));
vi.mock("sonner", () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { toast, Toaster: () => null };
});
vi.mock("@/lib/github.functions", () => ({ refreshTaskPullRequest: vi.fn() }));

const IMAGE = {
  id: "a1",
  task_id: "t1",
  plan_id: "plan-1",
  comment_id: null,
  uploader_id: "me",
  storage_bucket: "plan-attachments",
  storage_path: "me/plan-1/t1/a1-mock.png",
  file_name: "checklist-mock.png",
  mime_type: "image/png",
  size_bytes: 184320,
  shared_with_agents: true,
  source_attachment_id: null,
  width: null,
  height: null,
  created_at: "2026-09-29T10:00:00Z",
  url: "https://files.test/mock.png",
  uploader: { id: "me", full_name: "Jonas Berg", email: "j@x.test", avatar_url: null },
};

function taskRow(id: string, section: string, position: number, extra: Record<string, unknown>) {
  return {
    id,
    section_id: section,
    plan_id: "plan-1",
    position,
    title: `Task ${id}`,
    description: null,
    status: "available",
    priority: "medium",
    complexity: null,
    assigned_agent_id: null,
    assigned_user_id: null,
    assigned_agent: null,
    assigned_user: null,
    ticket: null,
    ticket_id: null,
    branch_name: null,
    pr_number: null,
    pr_url: null,
    pr_status: null,
    created_at: "2026-09-20T10:00:00Z",
    steps: [],
    comment_count: [{ count: 0 }],
    ...extra,
  };
}

const PLAN = {
  id: "plan-1",
  title: "Launch v2 onboarding",
  description: "Rebuild the first-run flow.",
  status: "active",
  project_id: null,
  project: null,
  github_repo: "acme/web-app",
  github_base: "main",
  sections: [
    {
      id: "s1",
      plan_id: "plan-1",
      title: "Discovery",
      color: null,
      position: 1,
      tasks: [taskRow("t0", "s1", 1, { title: "Audit drop-off", status: "done" })],
    },
    {
      id: "s2",
      plan_id: "plan-1",
      title: "Build",
      color: null,
      position: 2,
      tasks: [
        taskRow("t1", "s2", 1, {
          title: "Replace wizard with checklist",
          status: "in_review",
          steps: [
            {
              id: "p1",
              task_id: "t1",
              text: "Checklist component",
              done: true,
              depth: 0,
              position: 1,
            },
            {
              id: "p2",
              task_id: "t1",
              text: "Persist dismissal",
              done: false,
              depth: 1,
              position: 2,
            },
          ],
          comment_count: [{ count: 1 }],
          assigned_agent_id: "ag1",
          assigned_agent: { id: "ag1", name: "Claude Code", provider: "anthropic", model: null },
        }),
        taskRow("t2", "s2", 2, { title: "Fix Safari upload", status: "blocked" }),
      ],
    },
  ],
};

beforeEach(() => {
  fns.getPlan.mockResolvedValue({ plan: PLAN });
  fns.getPlanEvents.mockResolvedValue({
    events: [
      {
        id: "e1",
        plan_id: "plan-1",
        task_id: "t1",
        kind: "attachment_added",
        new_value: "checklist-mock.png",
        old_value: null,
        metadata: {},
        created_at: new Date().toISOString(),
        actor: { id: "me", full_name: "Jonas Berg", email: "j@x.test", avatar_url: null },
        agent: null,
      },
    ],
  });
  fns.listPlanAttachments.mockResolvedValue({ attachments: [IMAGE] });
  fns.listTaskComments.mockResolvedValue({ comments: [] });
});

afterEach(() => {
  cleanup();
  for (const fn of Object.values(fns)) fn.mockClear();
});

function renderScreen(taskId: string | null = null, onTaskChange = vi.fn()) {
  return {
    onTaskChange,
    ...renderWithQuery(<PlanScreen planId="plan-1" taskId={taskId} onTaskChange={onTaskChange} />),
  };
}

describe("PlanScreen", () => {
  it("shows the roadmap: progress, what needs you, and each section's own progress", async () => {
    renderScreen();

    expect(
      await screen.findByRole("heading", { name: "Launch v2 onboarding" }),
    ).toBeInTheDocument();
    expect(screen.getByText("33%")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 tasks done")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 to review" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 blocked" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discovery: 1 of 1 done" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Build: 0 of 2 done" })).toBeInTheDocument();
    expect(screen.getByText(/1 agent working/)).toBeInTheDocument();
  });

  it("filters to what needs you with one click, and clears again", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByRole("heading", { name: "Launch v2 onboarding" });

    await user.click(screen.getByRole("button", { name: "1 blocked" }));
    expect(screen.getByRole("heading", { name: "Fix Safari upload" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Replace wizard with checklist" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(
      screen.getByRole("heading", { name: "Replace wizard with checklist" }),
    ).toBeInTheDocument();
  });

  it("searches task titles", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByRole("heading", { name: "Launch v2 onboarding" });

    await user.type(screen.getByRole("searchbox", { name: "Search tasks" }), "safari");
    expect(screen.getByRole("heading", { name: "Fix Safari upload" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Audit drop-off" })).not.toBeInTheDocument();
  });

  it("shows card sub-step progress and the file count, and opens the task on click", async () => {
    const user = userEvent.setup();
    const { onTaskChange } = renderScreen();
    await screen.findByRole("heading", { name: "Launch v2 onboarding" });

    expect(await screen.findByText("1/2 sub-steps")).toBeInTheDocument();
    expect(screen.getByText("1 file")).toBeInTheDocument();
    expect(screen.getByText("1 note")).toBeInTheDocument();

    await user.click(screen.getByRole("heading", { name: "Replace wizard with checklist" }));
    expect(onTaskChange).toHaveBeenCalledWith("t1");
  });

  it("opens a task in the drawer with its steps, files and properties", async () => {
    const user = userEvent.setup();
    renderScreen("t1");

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByLabelText("Task title")).toHaveValue(
      "Replace wizard with checklist",
    );
    expect(within(drawer).getByText("1 of 2 done")).toBeInTheDocument();
    expect(within(drawer).queryByText("Every sub-step is done.")).not.toBeInTheDocument();
    expect(await within(drawer).findByText("checklist-mock.png")).toBeInTheDocument();
    expect(within(drawer).getByText("Agents can see")).toBeInTheDocument();
    expect(within(drawer).getByText("Claude Code")).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Release" })).toBeInTheDocument();
    expect(within(drawer).getByText("2 of 3")).toBeInTheDocument();

    // Ticking a sub-step saves it.
    await user.click(within(drawer).getByRole("checkbox", { name: "Finish Persist dismissal" }));
    await waitFor(() =>
      expect(fns.updateTaskStep).toHaveBeenCalledWith({ data: { stepId: "p2", done: true } }),
    );

    // Adding one does too.
    await user.type(within(drawer).getByLabelText("Add a sub-step"), "Remove old wizard{Enter}");
    await waitFor(() =>
      expect(fns.createTaskStep).toHaveBeenCalledWith({
        data: { taskId: "t1", text: "Remove old wizard" },
      }),
    );
  });

  it("offers to move a task to review once every sub-step is done", async () => {
    const user = userEvent.setup();
    const done = structuredClone(PLAN);
    const build = done.sections[1].tasks[0] as unknown as {
      status: string;
      steps: Array<{ done: boolean }>;
    };
    build.status = "in_progress";
    build.steps = build.steps.map((step) => ({ ...step, done: true }));
    fns.getPlan.mockResolvedValue({ plan: done });
    renderScreen("t1");

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("Every sub-step is done.")).toBeInTheDocument();
    await user.click(within(drawer).getByRole("button", { name: "Move to review" }));
    await waitFor(() =>
      expect(fns.updateTask).toHaveBeenCalledWith({ data: { taskId: "t1", status: "in_review" } }),
    );
  });

  it("walks to the next task from the drawer", async () => {
    const user = userEvent.setup();
    const { onTaskChange } = renderScreen("t1");
    const drawer = await screen.findByRole("dialog");

    await user.click(within(drawer).getByRole("button", { name: "Next task" }));
    expect(onTaskChange).toHaveBeenCalledWith("t2");
    expect(within(drawer).getByRole("button", { name: "Previous task" })).toBeEnabled();
  });

  it("opens the lightbox on a file and toggles what agents can see", async () => {
    const user = userEvent.setup();
    renderScreen("t1");
    const drawer = await screen.findByRole("dialog");

    await user.click(await within(drawer).findByRole("button", { name: /checklist-mock\.png/ }));
    const lightbox = (await screen.findAllByRole("dialog")).find((d) =>
      within(d).queryByRole("button", { name: "Mark up" }),
    )!;
    expect(
      within(lightbox).getByRole("button", { name: "Shared with agents" }),
    ).toBeInTheDocument();
    expect(within(lightbox).getByRole("button", { name: "Download" })).toBeInTheDocument();
    expect(within(lightbox).getByRole("button", { name: "Delete" })).toBeInTheDocument();

    await user.click(within(lightbox).getByRole("button", { name: "Shared with agents" }));
    await waitFor(() =>
      expect(fns.setPlanAttachmentShared).toHaveBeenCalledWith({
        data: { attachmentId: "a1", shared: false },
      }),
    );
  });

  it("lists every file in the Files layout and filters by type", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByRole("heading", { name: "Launch v2 onboarding" });

    await user.click(screen.getByRole("button", { name: "Files" }));
    expect(await screen.findByText("checklist-mock.png")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Video" }));
    expect(screen.getByText(/No files match/)).toBeInTheDocument();
  });

  it("shows live activity with the file events, in a side panel", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByRole("heading", { name: "Launch v2 onboarding" });

    await user.click(screen.getByRole("button", { name: "Activity" }));
    const panel = await screen.findByRole("complementary", { name: "Activity" });
    expect(await within(panel).findByText("attached a file to")).toBeInTheDocument();
    expect(within(panel).getByText("checklist-mock.png")).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "Replace wizard with checklist" }),
    ).toBeInTheDocument();
  });

  it("creates a task from the keyboard shortcut and opens it", async () => {
    const user = userEvent.setup();
    const { onTaskChange } = renderScreen();
    await screen.findByRole("heading", { name: "Launch v2 onboarding" });

    await user.keyboard("n");
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Task title"), "Write launch post");
    await user.click(within(dialog).getByRole("button", { name: "Create task" }));

    await waitFor(() =>
      expect(fns.createTask).toHaveBeenCalledWith({
        data: { planId: "plan-1", sectionId: "s1", title: "Write launch post" },
      }),
    );
    await waitFor(() => expect(onTaskChange).toHaveBeenCalledWith("new-task"));
  });

  it("attaches files picked in the drawer: uploads, then registers them on the task", async () => {
    const user = userEvent.setup();
    fns.registerPlanAttachment.mockResolvedValue({ id: "a-new" });
    const { uploadPlanFile } = await import("./plan-upload");
    renderScreen("t1");
    const drawer = await screen.findByRole("dialog");

    const file = new File(["png-bytes"], "Safari Console.png", { type: "image/png" });
    await user.upload(within(drawer).getByLabelText("Attach files"), file);

    await waitFor(() => expect(fns.registerPlanAttachment).toHaveBeenCalledTimes(1));
    expect(uploadPlanFile).toHaveBeenCalledTimes(1);
    const [{ data }] = fns.registerPlanAttachment.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ];
    expect(data).toMatchObject({
      taskId: "t1",
      fileName: "Safari Console.png",
      mimeType: "image/png",
      sizeBytes: 9,
    });
    expect(String(data.storagePath)).toMatch(/^me\/plan-1\/t1\/[0-9a-f-]{36}-safari-console\.png$/);
  });

  it("refuses a file that is too big or the wrong type, and says why", async () => {
    const user = userEvent.setup();
    renderScreen("t1");
    const drawer = await screen.findByRole("dialog");

    const exe = new File(["MZ"], "setup.exe", { type: "application/x-msdownload" });
    await user.upload(within(drawer).getByLabelText("Attach files"), exe);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "setup.exe is a application/x-msdownload file, which can't be attached.",
      ),
    );

    const huge = new File(["x"], "recording.mp4", { type: "video/mp4" });
    Object.defineProperty(huge, "size", { value: 30 * 1024 * 1024 });
    await user.upload(within(drawer).getByLabelText("Attach files"), huge);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("The limit is 25.0 MB")),
    );
    expect(fns.registerPlanAttachment).not.toHaveBeenCalled();
  });

  it("turns each file dropped on a section into its own task with the file attached", async () => {
    fns.registerPlanAttachment.mockResolvedValue({ id: "a-new" });
    fns.createTask.mockResolvedValueOnce({ id: "t-a" }).mockResolvedValueOnce({ id: "t-b" });
    renderScreen();
    await screen.findByRole("heading", { name: "Launch v2 onboarding" });

    const column = document.getElementById("col-s2")!;
    const files = [
      new File(["a"], "empty-state_v2.png", { type: "image/png" }),
      new File(["b"], "copy-deck.pdf", { type: "application/pdf" }),
    ];
    fireEvent.drop(column, { dataTransfer: { files, types: ["Files"], getData: () => "" } });

    await waitFor(() => expect(fns.registerPlanAttachment).toHaveBeenCalledTimes(2));
    expect(fns.createTask).toHaveBeenCalledWith({
      data: { planId: "plan-1", sectionId: "s2", title: "empty state v2" },
    });
    expect(fns.createTask).toHaveBeenCalledWith({
      data: { planId: "plan-1", sectionId: "s2", title: "copy deck" },
    });
    const targets = fns.registerPlanAttachment.mock.calls.map(
      (call) => (call as unknown as [{ data: { taskId: string } }])[0].data.taskId,
    );
    expect(targets).toEqual(["t-a", "t-b"]);
  });

  it("attaches a file dropped on a card to that task", async () => {
    fns.registerPlanAttachment.mockResolvedValue({ id: "a-new" });
    renderScreen();
    await screen.findByRole("heading", { name: "Launch v2 onboarding" });

    const card = screen.getByRole("group", { name: "Fix Safari upload" });
    const file = new File(["a"], "console.png", { type: "image/png" });
    fireEvent.drop(card, { dataTransfer: { files: [file], types: ["Files"], getData: () => "" } });

    await waitFor(() => expect(fns.registerPlanAttachment).toHaveBeenCalledTimes(1));
    expect(
      (fns.registerPlanAttachment.mock.calls[0] as unknown as [{ data: { taskId: string } }])[0]
        .data.taskId,
    ).toBe("t2");
    expect(fns.createTask).not.toHaveBeenCalled();
  });

  it("offers the empty-plan starter when there are no sections", async () => {
    fns.getPlan.mockResolvedValue({ plan: { ...PLAN, sections: [] } });
    renderScreen();

    expect(
      await screen.findByRole("heading", { name: "Start by giving this plan some structure" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add a section/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Import a Markdown outline/ })).toBeInTheDocument();
    // No project is linked, so tickets can't be imported yet.
    expect(screen.getByRole("button", { name: /Add open tickets/ })).toBeDisabled();
  });
});
