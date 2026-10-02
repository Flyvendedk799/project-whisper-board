import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { PlanAttachmentWithUrl, PlanWithSections, TaskWithAgent } from "@/data";
import { PlanBoard } from "./plan-board";
import { NO_FILTERS, type TaskFilters } from "./plan-model";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

const media = vi.hoisted(() => ({
  byTask: new Map<string, unknown[]>(),
  upload: vi.fn(),
}));

vi.mock("./plan-media", () => ({
  usePlanMedia: () => ({
    byTask: media.byTask,
    upload: media.upload,
    visible: [],
    uploads: [],
  }),
}));

afterEach(() => {
  cleanup();
  media.byTask.clear();
});

const PROSE =
  "The battle step is 20 Hz (BATTLE_TICK_MS is 50). A fight nobody is standing in, and that nobody is spectating and striking, accumulates time.";

function task(
  partial: Pick<TaskWithAgent, "id" | "title" | "section_id"> &
    Partial<Pick<TaskWithAgent, "description" | "position" | "status" | "steps" | "comment_count">>,
): TaskWithAgent {
  return {
    acceptance_criteria: null,
    ai_assessed_at: null,
    ai_assessment: null,
    ai_context: null,
    ai_context_at: null,
    blocked_from: null,
    color: null,
    actual_minutes: null,
    assigned_agent_id: null,
    assigned_user_id: null,
    branch_name: null,
    claimed_at: null,
    completed_at: null,
    complexity: null,
    context_files: [],
    created_at: "",
    depends_on: [],
    description: partial.description ?? null,
    estimated_minutes: null,
    id: partial.id,
    labels: [],
    plan_id: "plan-1",
    position: partial.position ?? 1,
    preferred_models: [],
    preferred_providers: [],
    pr_number: null,
    pr_status: null,
    pr_url: null,
    priority: "medium",
    section_id: partial.section_id,
    status: partial.status ?? "available",
    ticket_id: null,
    title: partial.title,
    updated_at: "",
    assigned_agent: null,
    steps: partial.steps,
    comment_count: partial.comment_count,
  };
}

function plan(
  sections: Array<{ id: string; title: string; tasks: TaskWithAgent[] }>,
): PlanWithSections {
  return {
    id: "plan-1",
    sections: sections.map((section, index) => ({
      id: section.id,
      plan_id: "plan-1",
      title: section.title,
      description: null,
      color: null,
      position: index,
      created_at: "",
      tasks: section.tasks,
    })),
  } as PlanWithSections;
}

function actionsMock() {
  return {
    advance: vi.fn(),
    moveTask: vi.fn(),
    moveSection: vi.fn(),
    shiftSection: vi.fn(),
    create: { fire: vi.fn(), run: vi.fn(), busy: false, error: null, reset: vi.fn() },
    removeSection: { fire: vi.fn(), run: vi.fn(), busy: false, error: null, reset: vi.fn() },
  };
}

function board(
  p: PlanWithSections,
  options: {
    layout?: "columns" | "outline";
    filters?: TaskFilters;
    onOpenTask?: (id: string) => void;
    actions?: ReturnType<typeof actionsMock>;
  } = {},
) {
  const actions = options.actions ?? actionsMock();
  return {
    actions,
    ...render(
      <PlanBoard
        plan={p}
        layout={options.layout ?? "columns"}
        filters={options.filters ?? NO_FILTERS}
        meId="me"
        onOpenTask={options.onOpenTask ?? vi.fn()}
        onSelectSection={vi.fn()}
        actions={actions}
      />,
    ),
  };
}

describe("PlanBoard", () => {
  it("opens a long import as an outline and keeps prose titles scannable", async () => {
    const user = userEvent.setup();
    const onOpenTask = vi.fn();
    const sections = [
      {
        id: "s1",
        title: "What is already true",
        tasks: [
          task({
            id: "t1",
            section_id: "s1",
            title: PROSE,
            description: "Wire the session.\n\n- Cookie refresh\n  - Silent renew\n- Logout path",
          }),
        ],
      },
      { id: "s2", title: "Soldiers", tasks: [] },
      ...["Boats", "Helicopters", "Ridge", "Wharf", "Order of work"].map((title, index) => ({
        id: `s${index + 3}`,
        title,
        tasks: [task({ id: `t${index + 3}`, section_id: `s${index + 3}`, title: "Short card" })],
      })),
    ];

    board(plan(sections), { layout: "outline", onOpenTask });

    expect(screen.queryByText("Drop a task or files here")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "The battle step is 20 Hz (BATTLE_TICK_MS is 50).",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/A fight nobody is standing in/)).not.toBeInTheDocument();
    expect(screen.queryByText("Cookie refresh")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Show detail for The battle step/ }),
    ).toHaveTextContent("3 nested");

    await user.click(
      screen.getByRole("button", {
        name: "Show detail for The battle step is 20 Hz (BATTLE_TICK_MS is 50).",
      }),
    );
    expect(onOpenTask).not.toHaveBeenCalled();
    expect(screen.getByText(/A fight nobody is standing in/)).toBeInTheDocument();
    expect(screen.getByText("Cookie refresh")).toBeInTheDocument();
    expect(screen.getByText("Silent renew")).toBeInTheDocument();
    expect(screen.getByText("Logout path")).toBeInTheDocument();
    expect(screen.getByText("Wire the session.")).toBeInTheDocument();

    await user.click(
      screen.getByRole("heading", { name: "The battle step is 20 Hz (BATTLE_TICK_MS is 50)." }),
    );
    expect(onOpenTask).toHaveBeenCalledWith("t1");

    // The section rail names every section and counts its tasks.
    expect(screen.getByRole("button", { name: /Soldiers/ })).toHaveTextContent("0");
  });

  it("keeps a short board in columns and collapses only spare empty sections", async () => {
    const user = userEvent.setup();
    board(
      plan([
        {
          id: "s1",
          title: "Vehicles",
          tasks: [task({ id: "t1", section_id: "s1", title: "**Driver** and `gunner`" })],
        },
        { id: "s2", title: "Review", tasks: [] },
      ]),
    );

    expect(screen.getByRole("heading", { name: "Driver and gunner" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show detail/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review, empty" })).toBeInTheDocument();
    expect(screen.queryByText("Drop a task or files here")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Review, empty" }));
    expect(screen.getByText("Drop a task or files here")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Collapse" }));
    expect(screen.queryByText("Drop a task or files here")).not.toBeInTheDocument();
  });

  it("shows a full empty column when the plan has no cards yet", () => {
    board(plan([{ id: "s1", title: "Backlog", tasks: [] }]));

    expect(screen.getByRole("heading", { name: "Backlog" })).toBeInTheDocument();
    expect(screen.getByText("Drop a task or files here")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /empty/ })).not.toBeInTheDocument();
  });

  it("advances a task from the circle without opening it", async () => {
    const user = userEvent.setup();
    const onOpenTask = vi.fn();
    const { actions } = board(
      plan([
        {
          id: "s1",
          title: "Build",
          tasks: [task({ id: "t1", section_id: "s1", title: "Wire it" })],
        },
      ]),
      { onOpenTask },
    );

    await user.click(screen.getByRole("button", { name: /Move to Claimed/ }));
    expect(actions.advance).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }));
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  it("adds a task inline and keeps the field for the next one", async () => {
    const user = userEvent.setup();
    const { actions } = board(plan([{ id: "s1", title: "Build", tasks: [] }]));

    await user.click(screen.getByRole("button", { name: "+ Add task" }));
    await user.type(
      screen.getByRole("textbox", { name: "New task in Build" }),
      "Write tests{Enter}",
    );

    expect(actions.create.fire).toHaveBeenCalledWith({
      planId: "plan-1",
      sectionId: "s1",
      title: "Write tests",
    });
    expect(screen.getByRole("textbox", { name: "New task in Build" })).toHaveValue("");
  });

  it("moves a focused card with Shift + arrow keys, and stops at the ends", () => {
    const { actions } = board(
      plan([
        {
          id: "s1",
          title: "Now",
          tasks: [
            task({ id: "t1", section_id: "s1", title: "First", position: 1 }),
            task({ id: "t2", section_id: "s1", title: "Second", position: 2 }),
          ],
        },
        { id: "s2", title: "Next", tasks: [task({ id: "t3", section_id: "s2", title: "Third" })] },
      ]),
    );

    const first = screen.getByRole("group", { name: "First" });
    fireEvent.keyDown(first, { key: "ArrowRight", shiftKey: true });
    expect(actions.moveTask).toHaveBeenLastCalledWith("t1", "s2", null);

    fireEvent.keyDown(first, { key: "ArrowLeft", shiftKey: true });
    expect(actions.moveTask).toHaveBeenCalledTimes(1);

    // Down past the second card swaps them: dropped before "nothing" = at the end.
    fireEvent.keyDown(first, { key: "ArrowDown", shiftKey: true });
    expect(actions.moveTask).toHaveBeenLastCalledWith("t1", "s1", null);
    fireEvent.keyDown(screen.getByRole("group", { name: "Second" }), {
      key: "ArrowDown",
      shiftKey: true,
    });
    expect(actions.moveTask).toHaveBeenCalledTimes(2);
  });

  it("filters cards and says so when nothing matches", () => {
    board(
      plan([
        {
          id: "s1",
          title: "Build",
          tasks: [
            task({ id: "t1", section_id: "s1", title: "Open one", status: "available" }),
            task({ id: "t2", section_id: "s1", title: "Blocked one", status: "blocked" }),
          ],
        },
        {
          id: "s2",
          title: "Review",
          tasks: [task({ id: "t3", section_id: "s2", title: "Other" })],
        },
      ]),
      { filters: { ...NO_FILTERS, status: "blocked" } },
    );

    expect(screen.getByRole("heading", { name: "Blocked one" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Open one" })).not.toBeInTheDocument();
    expect(screen.getByText("No tasks match the filters")).toBeInTheDocument();
  });

  it("shows sub-step progress, file counts, notes and a cover on the card", () => {
    const image = {
      id: "a1",
      task_id: "t1",
      file_name: "mock.png",
      mime_type: "image/png",
      url: "https://files.test/mock.png",
      source_attachment_id: null,
    } as unknown as PlanAttachmentWithUrl;
    media.byTask.set("t1", [image, { ...image, id: "a2", url: "https://files.test/two.png" }]);

    board(
      plan([
        {
          id: "s1",
          title: "Build",
          tasks: [
            task({
              id: "t1",
              section_id: "s1",
              title: "Checklist",
              steps: [
                { id: "p1", done: true },
                { id: "p2", done: false },
              ] as TaskWithAgent["steps"],
              comment_count: [{ count: 3 }],
            }),
          ],
        },
      ]),
    );

    expect(screen.getByText("1/2 sub-steps")).toBeInTheDocument();
    expect(screen.getByText("2 files")).toBeInTheDocument();
    expect(screen.getByText("3 notes")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
  });

  it("shows what a section is for: description, goals and intentions", async () => {
    const user = userEvent.setup();
    const p = plan([
      {
        id: "s1",
        title: "Build",
        tasks: [task({ id: "t1", section_id: "s1", title: "Open one" })],
      },
    ]);
    Object.assign(p.sections[0], {
      description: "The payment flow.",
      goals: "Checkout under 3 clicks.",
      intentions: "Keep it boring.",
      tags: ["payments"],
    });
    board(p);

    await user.click(screen.getByText("About this section"));
    expect(screen.getByText("What it covers")).toBeInTheDocument();
    expect(screen.getByText("The payment flow.")).toBeInTheDocument();
    expect(screen.getByText("Goals")).toBeInTheDocument();
    expect(screen.getByText("Checkout under 3 clicks.")).toBeInTheDocument();
    expect(screen.getByText("Intentions")).toBeInTheDocument();
    expect(screen.getByText("Keep it boring.")).toBeInTheDocument();
    expect(screen.getByText("payments")).toBeInTheDocument();
  });

  it("shows task colour, tags and open questions on the card, and tags filter", async () => {
    const user = userEvent.setup();
    const onTagFilter = vi.fn();
    const tagged = task({ id: "t1", section_id: "s1", title: "Tagged" });
    Object.assign(tagged, {
      color: "#ef4444",
      labels: ["bug", "backend"],
      questions: [
        { id: "q1", status: "open", blocking: true },
        { id: "q2", status: "open", blocking: false },
        { id: "q3", status: "answered", blocking: false },
      ],
    });
    const actions = actionsMock();
    render(
      <PlanBoard
        plan={plan([{ id: "s1", title: "Build", tasks: [tagged] }])}
        layout="columns"
        filters={NO_FILTERS}
        onOpenTask={vi.fn()}
        onTagFilter={onTagFilter}
        actions={actions}
      />,
    );
    expect(screen.getByText("2 questions")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "bug" }));
    expect(onTagFilter).toHaveBeenCalledWith("bug");
  });

  it("filters cards by tag and by open question", () => {
    const a = task({ id: "t1", section_id: "s1", title: "Has bug tag" });
    Object.assign(a, { labels: ["bug"] });
    const b = task({ id: "t2", section_id: "s1", title: "Plain" });
    board(plan([{ id: "s1", title: "Build", tasks: [a, b] }]), {
      filters: { ...NO_FILTERS, tag: "bug" },
    });
    expect(screen.getByRole("heading", { name: "Has bug tag" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Plain" })).not.toBeInTheDocument();
  });

  it("reorders sections: a dropped column goes before the target, or after when moving right", () => {
    const { actions, container } = board(
      plan([
        { id: "s1", title: "One", tasks: [] },
        { id: "s2", title: "Two", tasks: [] },
        { id: "s3", title: "Three", tasks: [] },
      ]),
    );
    const store = new Map<string, string>();
    const dataTransfer = {
      types: ["sectionId"],
      files: [],
      getData: (key: string) => store.get(key) ?? "",
      setData: (key: string, value: string) => store.set(key, value),
      setDragImage: () => undefined,
      dropEffect: "move",
      effectAllowed: "move",
    };

    // Drag section one onto section three (moving right): it lands after it.
    fireEvent.dragStart(screen.getByRole("button", { name: "Drag section One" }), { dataTransfer });
    fireEvent.drop(container.querySelector("#col-s3")!, { dataTransfer });
    expect(actions.moveSection).toHaveBeenCalledWith("s1", null);

    // Drag section three onto section one (moving left): it lands before it.
    actions.moveSection.mockClear();
    store.clear();
    fireEvent.dragStart(screen.getByRole("button", { name: "Drag section Three" }), {
      dataTransfer,
    });
    fireEvent.drop(container.querySelector("#col-s1")!, { dataTransfer });
    expect(actions.moveSection).toHaveBeenCalledWith("s3", "s1");
  });

  it("moves a section from the keyboard with the arrow keys on its handle", () => {
    const { actions } = board(
      plan([
        { id: "s1", title: "One", tasks: [] },
        { id: "s2", title: "Two", tasks: [] },
      ]),
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Drag section One" }), {
      key: "ArrowRight",
    });
    expect(actions.shiftSection).toHaveBeenCalledWith("s1", 1);
  });
});
