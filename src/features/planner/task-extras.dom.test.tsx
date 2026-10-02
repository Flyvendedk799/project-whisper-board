import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TaskWithAgent } from "@/data";
import { SearchableSelect } from "@/components/searchable-select";
import { CopyIdButton } from "./copy-id-button";
import { TagEditor } from "./tag-editor";
import { TaskFeatures } from "./task-features";
import { TaskQuestions } from "./task-questions";
import { TaskSteps } from "./task-steps";
import type { PlanActions } from "./use-plan-actions";

vi.mock("sonner", () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { toast, Toaster: () => null };
});

afterEach(cleanup);

const action = () => ({
  run: vi.fn(async () => ({ ok: true })),
  fire: vi.fn(),
  busy: false,
  error: null,
  reset: vi.fn(),
});

function buildActions() {
  return {
    ask: action(),
    answer: action(),
    dismiss: action(),
    setBlocking: action(),
    addFeatures: action(),
    editFeature: action(),
    addStep: action(),
    addSteps: action(),
    editStep: action(),
    convert: action(),
    toggleFeature: vi.fn(),
    deleteFeature: vi.fn(),
    shiftFeature: vi.fn(),
    toggleStep: vi.fn(),
    deleteStep: vi.fn(),
    shiftStep: vi.fn(),
    setStepDepth: vi.fn(),
    linkStep: vi.fn(),
    setStatus: vi.fn(),
  };
}

function actionsMock() {
  return buildActions() as unknown as PlanActions & ReturnType<typeof buildActions>;
}

function task(extra: Partial<TaskWithAgent> = {}): TaskWithAgent {
  return {
    id: "t1",
    title: "Build it",
    description: null,
    status: "in_progress",
    steps: [],
    features: [],
    questions: [],
    ...extra,
  } as unknown as TaskWithAgent;
}

const question = (extra: Record<string, unknown> = {}) => ({
  id: "q1",
  task_id: "t1",
  body: "Which payment provider?",
  blocking: false,
  status: "open",
  answer: null,
  asked_by_user_id: "u1",
  asked_by_agent_id: null,
  asked_by_user: { id: "u1", full_name: "Ada Lovelace", email: "a@x.test", avatar_url: null },
  asked_by_agent: null,
  answered_by_user: null,
  answered_by_agent: null,
  answered_at: null,
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
  ...extra,
});

describe("TaskQuestions", () => {
  it("asks a question, blocking when asked to", async () => {
    const user = userEvent.setup();
    const actions = actionsMock();
    render(<TaskQuestions task={task()} actions={actions} />);

    await user.type(screen.getByLabelText("Ask a question"), "Is SSO in scope?");
    await user.click(screen.getByRole("switch", { name: "Block the task until answered" }));
    await user.click(screen.getByRole("button", { name: "Ask" }));

    expect(actions.ask.run).toHaveBeenCalledWith({
      taskId: "t1",
      body: "Is SSO in scope?",
      blocking: true,
    });
  });

  it("will not ask an empty question", () => {
    render(<TaskQuestions task={task()} actions={actionsMock()} />);
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
  });

  it("shows an open question as needing an answer, and answers it", async () => {
    const user = userEvent.setup();
    const actions = actionsMock();
    render(
      <TaskQuestions
        task={task({ questions: [question({ blocking: true })] as never })}
        actions={actions}
      />,
    );

    expect(screen.getByText("1 open, 1 blocking")).toBeInTheDocument();
    expect(screen.getByText("Blocking")).toBeInTheDocument();
    expect(screen.getByText(/Asked by/)).toHaveTextContent("Ada Lovelace");

    await user.type(screen.getByLabelText(/^Answer:/), "Stripe");
    await user.click(screen.getByRole("button", { name: "Answer" }));
    expect(actions.answer.run).toHaveBeenCalledWith({ questionId: "q1", answer: "Stripe" });
  });

  it("lets an agent's question be told apart and dismissed", async () => {
    const user = userEvent.setup();
    const actions = actionsMock();
    render(
      <TaskQuestions
        task={task({
          questions: [
            question({
              asked_by_user: null,
              asked_by_user_id: null,
              asked_by_agent_id: "a1",
              asked_by_agent: { id: "a1", name: "Claude Code", provider: "anthropic", model: null },
            }),
          ] as never,
        })}
        actions={actions}
      />,
    );
    expect(screen.getByText("Needs an answer")).toBeInTheDocument();
    expect(screen.getByText(/Asked by/)).toHaveTextContent("Claude Code");
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(actions.dismiss.fire).toHaveBeenCalledWith({ questionId: "q1" });
  });

  it("keeps answered questions out of the way but reachable, and can reopen one", async () => {
    const user = userEvent.setup();
    const actions = actionsMock();
    render(
      <TaskQuestions
        task={task({
          questions: [
            question({ status: "answered", answer: "Stripe", answered_at: "2026-10-01T11:00:00Z" }),
          ] as never,
        })}
        actions={actions}
      />,
    );
    await user.click(screen.getByText("1 resolved"));
    expect(screen.getByText("Stripe")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reopen" }));
    expect(actions.dismiss.fire).toHaveBeenCalledWith({ questionId: "q1", reopen: true });
  });
});

describe("TaskFeatures", () => {
  it("adds pasted bullets as several features", async () => {
    const user = userEvent.setup();
    const actions = actionsMock();
    render(<TaskFeatures task={task()} actions={actions} />);

    const box = screen.getByLabelText("Add features");
    await user.click(box);
    await user.paste("2.1.1 Must be able to block questions\n2.1.2 Has to have good security");
    expect(screen.getByRole("button", { name: "Add 2 features" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Add 2 features" }));
    expect(actions.addFeatures.run).toHaveBeenCalledWith({
      taskId: "t1",
      text: "2.1.1 Must be able to block questions\n2.1.2 Has to have good security",
    });
  });

  it("ticks a feature off and shows how many are met", async () => {
    const user = userEvent.setup();
    const actions = actionsMock();
    render(
      <TaskFeatures
        task={task({
          features: [
            { id: "f1", text: "Block questions", met: true, source: "human", position: 1 },
            { id: "f2", text: "Good security", met: false, source: "agent", position: 2 },
          ] as never,
        })}
        actions={actions}
      />,
    );
    expect(screen.getByText("1 of 2 met")).toBeInTheDocument();
    expect(screen.getByText("agent")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Mark met: Good security" }));
    expect(actions.toggleFeature).toHaveBeenCalledWith("t1", "f2", true);
  });
});

describe("TaskSteps with a feature list", () => {
  const features = [
    { id: "f1", text: "Block questions", met: false, source: "human", position: 1 },
    { id: "f2", text: "Good security", met: false, source: "human", position: 2 },
  ];

  it("says which features still have no sub-step, and writes steps for one", async () => {
    const user = userEvent.setup();
    const actions = actionsMock();
    render(
      <TaskSteps
        task={task({
          features: features as never,
          steps: [
            {
              id: "p1",
              text: "Add the switch",
              done: false,
              depth: 0,
              position: 1,
              feature_id: "f1",
              source: "human",
            },
          ] as never,
        })}
        actions={actions}
      />,
    );
    expect(screen.getByText("1 feature has no sub-step yet:")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /2\. Good security/ }));
    await user.type(screen.getByLabelText("Add a sub-step"), "Audit the endpoints{Enter}");
    expect(actions.addSteps.fire).toHaveBeenCalledWith({
      taskId: "t1",
      text: "Audit the endpoints",
      featureId: "f2",
    });
  });

  it("keeps a plain single step on the original path", async () => {
    const user = userEvent.setup();
    const actions = actionsMock();
    render(<TaskSteps task={task()} actions={actions} />);
    await user.type(screen.getByLabelText("Add a sub-step"), "One thing{Enter}");
    expect(actions.addStep.fire).toHaveBeenCalledWith({ taskId: "t1", text: "One thing" });
  });
});

describe("TagEditor", () => {
  it("adds a normalised tag on Enter and removes with the chip", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<TagEditor tags={[]} onChange={onChange} label="Tags" />);
    await user.type(screen.getByLabelText("Tags"), "#Front End{Enter}");
    expect(onChange).toHaveBeenCalledWith(["front-end"]);

    rerender(<TagEditor tags={["front-end", "bug"]} onChange={onChange} label="Tags" />);
    await user.click(screen.getByRole("button", { name: "Remove tag bug" }));
    expect(onChange).toHaveBeenLastCalledWith(["front-end"]);
  });

  it("does not add the same tag twice", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagEditor tags={["bug"]} onChange={onChange} label="Tags" />);
    await user.type(screen.getByLabelText("Tags"), "Bug{Enter}");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("CopyIdButton", () => {
  it("copies the full id without triggering the card around it", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const outer = vi.fn();
    render(
      <div onClick={outer}>
        <CopyIdButton id="3f2a9c10-aaaa-bbbb-cccc-1234567890ab" label="task" />
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "Copy task id" }));
    expect(writeText).toHaveBeenCalledWith("3f2a9c10-aaaa-bbbb-cccc-1234567890ab");
    expect(outer).not.toHaveBeenCalled();
  });
});

describe("SearchableSelect", () => {
  const options = [
    { value: "acme/web-app" },
    { value: "acme/api", hint: "private" },
    { value: "acme/docs" },
  ];

  it("filters as you type and picks one", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SearchableSelect
        value=""
        onChange={onChange}
        options={options}
        placeholder="Choose a repository"
        searchPlaceholder="Search repositories"
        ariaLabel="Repository"
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Repository" }));
    const list = screen.getByRole("listbox");
    expect(within(list).getAllByRole("option")).toHaveLength(3);

    await user.type(screen.getByPlaceholderText("Search repositories"), "doc");
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(1);
    await user.click(screen.getByRole("option", { name: /acme\/docs/ }));
    expect(onChange).toHaveBeenCalledWith("acme/docs");
  });

  it("offers a typed value that is not in the list when custom values are allowed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SearchableSelect
        value=""
        onChange={onChange}
        options={options}
        placeholder="Choose"
        searchPlaceholder="Search"
        ariaLabel="Repository"
        allowCustom
        validateCustom={(text) => /^[\w.-]+\/[\w.-]+$/.test(text)}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Repository" }));
    await user.type(screen.getByPlaceholderText("Search"), "other/thing");
    await user.click(screen.getByRole("option", { name: /Use .other\/thing./ }));
    expect(onChange).toHaveBeenCalledWith("other/thing");
  });

  it("does not offer text that fails validation", async () => {
    const user = userEvent.setup();
    render(
      <SearchableSelect
        value=""
        onChange={vi.fn()}
        options={options}
        placeholder="Choose"
        searchPlaceholder="Search"
        ariaLabel="Repository"
        allowCustom
        validateCustom={(text) => /^[\w.-]+\/[\w.-]+$/.test(text)}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Repository" }));
    await user.type(screen.getByPlaceholderText("Search"), "nonsense");
    expect(screen.queryByRole("option", { name: /Use/ })).not.toBeInTheDocument();
    expect(screen.getByText("Nothing matches.")).toBeInTheDocument();
  });
});
