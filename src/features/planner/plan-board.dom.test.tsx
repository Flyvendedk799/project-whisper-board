import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { PlanWithSections, TaskWithAgent } from "@/data";
import { PlanBoard } from "./plan-board";

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/planner.functions", () => ({
  createSection: vi.fn(),
  moveTask: vi.fn(),
}));

vi.mock("@/lib/use-server-action", () => ({
  useServerAction: () => ({
    fire: vi.fn(),
    busy: false,
    run: vi.fn(),
    reset: vi.fn(),
    error: null,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

afterEach(cleanup);

const PROSE =
  "The battle step is 20 Hz (BATTLE_TICK_MS is 50). A fight nobody is standing in, and that nobody is spectating and striking, accumulates time.";

function task(
  partial: Pick<TaskWithAgent, "id" | "title" | "section_id"> &
    Partial<Pick<TaskWithAgent, "description" | "position">>,
): TaskWithAgent {
  return {
    acceptance_criteria: null,
    actual_minutes: null,
    assigned_agent_id: null,
    assigned_user_id: null,
    branch_name: null,
    claimed_at: null,
    completed_at: null,
    complexity: "medium",
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
    status: "available",
    ticket_id: null,
    title: partial.title,
    updated_at: "",
    assigned_agent: null,
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

describe("PlanBoard", () => {
  it("opens a long import as an outline and keeps prose titles scannable", async () => {
    const user = userEvent.setup();
    const onTaskClick = vi.fn();
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

    render(<PlanBoard plan={plan(sections)} onTaskClick={onTaskClick} />);

    expect(screen.getByRole("button", { name: "Outline", pressed: true })).toBeInTheDocument();
    expect(screen.queryByText("Drag tasks here")).not.toBeInTheDocument();
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
    expect(screen.getByText("1 task")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "Show detail for The battle step is 20 Hz (BATTLE_TICK_MS is 50).",
      }),
    );
    expect(onTaskClick).not.toHaveBeenCalled();
    expect(screen.getByText(/A fight nobody is standing in/)).toBeInTheDocument();
    expect(screen.getByText("Cookie refresh")).toBeInTheDocument();
    expect(screen.getByText("Silent renew")).toBeInTheDocument();
    expect(screen.getByText("Logout path")).toBeInTheDocument();
    expect(screen.getByText("Wire the session.")).toBeInTheDocument();

    await user.click(
      screen.getByRole("heading", { name: "The battle step is 20 Hz (BATTLE_TICK_MS is 50)." }),
    );
    expect(onTaskClick).toHaveBeenCalledWith("t1");

    expect(screen.getByRole("button", { name: /Soldiers/ })).toHaveTextContent("0");
    await user.click(screen.getByRole("button", { name: "Columns" }));
    expect(screen.getByRole("button", { name: "Soldiers, empty" })).toBeInTheDocument();
    expect(screen.queryByText("Drag tasks here")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Soldiers, empty" }));
    expect(screen.getByText("Drag tasks here")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Collapse" }));
    expect(screen.queryByText("Drag tasks here")).not.toBeInTheDocument();
  });

  it("keeps a short board in columns and collapses only spare empty sections", () => {
    render(
      <PlanBoard
        plan={plan([
          {
            id: "s1",
            title: "Vehicles",
            tasks: [task({ id: "t1", section_id: "s1", title: "**Driver** and `gunner`" })],
          },
          { id: "s2", title: "Review", tasks: [] },
        ])}
        onTaskClick={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Columns", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Driver and gunner" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show detail/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review, empty" })).toBeInTheDocument();
    expect(screen.queryByText("Drag tasks here")).not.toBeInTheDocument();
  });

  it("shows a full empty column when the plan has no cards yet", () => {
    render(
      <PlanBoard plan={plan([{ id: "s1", title: "Backlog", tasks: [] }])} onTaskClick={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "Columns", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Backlog" })).toBeInTheDocument();
    expect(screen.getByText("Drag tasks here")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /empty/ })).not.toBeInTheDocument();
  });
});
