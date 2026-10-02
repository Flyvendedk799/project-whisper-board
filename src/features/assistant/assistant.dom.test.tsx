import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/test/render";
import { AiAutomationCard } from "@/features/settings/ai-automation-card";
import { PlanAiMenu, TaskAiMenu } from "@/features/planner/ai-plan-actions";
import { AssistantRoot } from "./assistant-root";

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));

const ai = vi.hoisted(() => ({ enabled: false }));
vi.mock("@/hooks/use-ai-enabled", () => ({ useAiEnabled: () => ai.enabled }));

const fns = vi.hoisted(() => ({
  getAiSettings: vi.fn(),
  setAiSettings: vi.fn(),
  assistantChat: vi.fn(),
  auditPlan: vi.fn(),
  addTaskContext: vi.fn(),
  assessTask: vi.fn(),
}));
vi.mock("@/lib/ai-planner.functions", () => fns);
vi.mock("@/lib/planner.functions", () => ({}));
vi.mock("@/lib/plan-extras.functions", () => ({}));
vi.mock("@/lib/plan-pulls.functions", () => ({}));

const plan = { id: "plan-1", title: "Launch", github_repo: "acme/app", project: null };
const task = { id: "task-1", title: "Build the API" };

beforeEach(() => {
  ai.enabled = false;
  fns.getAiSettings.mockResolvedValue({ autoEnrich: false });
  fns.setAiSettings.mockImplementation(async ({ data }: { data: { autoEnrich: boolean } }) => data);
});
afterEach(cleanup);

describe("AI controls stay hidden without AI", () => {
  it("renders no assistant button, plan menu or task menu", () => {
    const { container } = renderWithQuery(
      <>
        <AssistantRoot />
        <PlanAiMenu plan={plan} />
        <TaskAiMenu plan={plan} task={task} />
      </>,
    );
    expect(container.querySelector("button")).toBeNull();
  });

  it("shows no switch in settings, only why", () => {
    renderWithQuery(<AiAutomationCard />);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByText(/once AI is set up/)).toBeTruthy();
    expect(fns.getAiSettings).not.toHaveBeenCalled();
  });
});

describe("with AI", () => {
  beforeEach(() => {
    ai.enabled = true;
  });

  it("offers the plan and task menus", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <>
        <PlanAiMenu plan={plan} selectedTaskIds={[]} />
        <TaskAiMenu plan={{ ...plan, github_repo: null }} task={task} />
      </>,
    );
    const [planMenu, taskMenu] = screen.getAllByRole("button", { name: "AI" });

    await user.click(planMenu);
    expect(await screen.findByRole("menuitem", { name: "Audit plan" })).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: /Filter the board to the tasks you want first/ }),
    ).toBeTruthy();
    await user.keyboard("{Escape}");

    await user.click(taskMenu);
    expect(await screen.findByRole("menuitem", { name: "Break into sub-steps" })).toBeTruthy();
    // No repository: context cannot be added, and it says why.
    expect(screen.getByText("Connect a repository to the plan first")).toBeTruthy();
  });

  it("is honest that automation runs in the browser, and saves the person's choice", async () => {
    const user = userEvent.setup();
    renderWithQuery(<AiAutomationCard />);

    expect(await screen.findByText(/runs in your browser while a plan is open/)).toBeTruthy();
    expect(screen.getByText(/no background server job/)).toBeTruthy();

    const toggle = await screen.findByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await user.click(toggle);
    await waitFor(() =>
      expect(fns.setAiSettings).toHaveBeenCalledWith({ data: { autoEnrich: true } }),
    );
  });
});
