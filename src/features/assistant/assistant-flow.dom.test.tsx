import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/test/render";
import { AssistantProvider, useAssistant } from "./assistant-provider";
import { AssistantRoot } from "./assistant-root";

const PLAN = "11111111-1111-4111-8111-111111111111";
const TASK = "22222222-2222-4222-8222-222222222222";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useLocation: () => ({ pathname: `/app/planner/${PLAN}`, search: { task: TASK } }),
}));
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ workspaceId: "ws-1" }) }));
vi.mock("@/hooks/use-ai-enabled", () => ({ useAiEnabled: () => true }));

const fns = vi.hoisted(() => ({
  assistantChat: vi.fn(),
  addTaskFeatures: vi.fn(),
  askQuestion: vi.fn(),
  getPlan: vi.fn(),
  listPlans: vi.fn(),
}));
vi.mock("@/lib/ai-planner.functions", () => ({ assistantChat: fns.assistantChat }));
vi.mock("@/lib/plan-extras.functions", () => ({
  addTaskFeatures: fns.addTaskFeatures,
  addTaskSteps: vi.fn(),
  answerQuestion: vi.fn(),
  askQuestion: fns.askQuestion,
}));
vi.mock("@/lib/planner.functions", () => ({
  getPlan: fns.getPlan,
  listPlans: fns.listPlans,
  addTaskComment: vi.fn(),
  createSection: vi.fn(),
  createTask: vi.fn(),
  updateSection: vi.fn(),
  updateTask: vi.fn(),
}));
vi.mock("@/lib/plan-pulls.functions", () => ({}));

function StartPreset() {
  const assistant = useAssistant();
  return (
    <button
      onClick={() =>
        assistant.run({ preset: "write_features", planId: PLAN, taskId: TASK, taskTitle: "Login" })
      }
    >
      Start preset
    </button>
  );
}

const reply = (proposals: Array<{ action: unknown; summary: string }>) => ({
  reply: "Here is what I would add.",
  proposals,
  dropped: 0,
  truncated: false,
});

beforeEach(() => {
  fns.getPlan.mockResolvedValue({
    plan: {
      id: PLAN,
      title: "Launch",
      sections: [{ id: "s", tasks: [{ id: TASK, title: "Login" }] }],
    },
  });
  fns.listPlans.mockResolvedValue({ plans: [] });
  fns.addTaskFeatures.mockResolvedValue({ created: 1, ids: ["f"] });
  fns.askQuestion.mockResolvedValue({ id: "q" });
});
afterEach(cleanup);

function setup() {
  renderWithQuery(
    <AssistantProvider>
      <StartPreset />
      <AssistantRoot />
    </AssistantProvider>,
  );
  return userEvent.setup();
}

describe("the assistant", () => {
  it("starts a preset from another button, on the task in view, and proposes before it acts", async () => {
    fns.assistantChat.mockResolvedValue(
      reply([
        {
          action: { type: "add_features", taskId: TASK, items: ["Locks out after 5 tries"] },
          summary: 'Add 1 feature to task "Login"',
        },
      ]),
    );
    const user = setup();
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Start preset" }));

    expect(await screen.findByText("Here is what I would add.")).toBeTruthy();
    expect(fns.assistantChat).toHaveBeenCalledWith({
      data: {
        messages: [{ role: "user", content: 'Write the feature list for "Login".' }],
        context: { planId: PLAN, taskId: TASK, projectId: undefined, preset: "write_features" },
      },
    });
    // Proposed, not applied.
    expect(fns.addTaskFeatures).not.toHaveBeenCalled();
    expect(screen.getByText('Add 1 feature to task "Login"')).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.getByText("Applied")).toBeTruthy());
    expect(fns.addTaskFeatures).toHaveBeenCalledWith({
      data: { taskId: TASK, items: ["Locks out after 5 tries"], source: "ai" },
    });
  });

  it("applies several at once, and says which failed", async () => {
    fns.assistantChat.mockResolvedValue(
      reply([
        { action: { type: "add_features", taskId: TASK, items: ["A"] }, summary: "Add feature A" },
        {
          action: { type: "ask_question", taskId: TASK, body: "Which db?", blocking: true },
          summary: "Ask which db",
        },
      ]),
    );
    fns.askQuestion.mockRejectedValue(new Error("nope"));
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Start preset" }));
    await user.click(await screen.findByRole("button", { name: "Apply all (2)" }));

    await waitFor(() => expect(screen.getByText("Applied")).toBeTruthy());
    expect(fns.addTaskFeatures).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("shows a failed turn as a message, keeps the person's text, and does not send it back", async () => {
    fns.assistantChat.mockRejectedValueOnce(new Error("boom"));
    fns.assistantChat.mockResolvedValueOnce(reply([]));
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Open assistant" }));
    await user.type(screen.getByLabelText("Message the assistant"), "hello{Enter}");

    expect(await screen.findByText(/couldn.t answer/i)).toBeTruthy();
    expect(screen.getByText("hello")).toBeTruthy();

    await user.type(screen.getByLabelText("Message the assistant"), "again{Enter}");
    await waitFor(() => expect(fns.assistantChat).toHaveBeenCalledTimes(2));
    const second = fns.assistantChat.mock.calls[1][0].data.messages;
    expect(second.map((m: { content: string }) => m.content)).toEqual(["hello", "again"]);
  });
});
