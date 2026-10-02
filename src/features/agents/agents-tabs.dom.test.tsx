import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TOOL_CATALOG } from "../../mcp/tool-catalog";
import { SkillTab } from "./skill-tab";
import { ToolsTab } from "./tools-tab";
import { WorkflowTab } from "./workflow-tab";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

afterEach(cleanup);

describe("ToolsTab", () => {
  it("lists every tool in the catalog", () => {
    const { container } = render(<ToolsTab />);
    expect(container.querySelectorAll("[data-tool]")).toHaveLength(TOOL_CATALOG.length);
    expect(screen.getByText("report_progress")).toBeTruthy();
  });

  it("narrows to what matches the search, and says when nothing does", async () => {
    const user = userEvent.setup();
    const { container } = render(<ToolsTab />);
    await user.type(screen.getByLabelText("Search tools"), "question");
    const shown = [...container.querySelectorAll("[data-tool]")].map((el) =>
      el.getAttribute("data-tool"),
    );
    expect(shown).toContain("ask_question");
    expect(shown).toContain("answer_question");
    expect(shown).not.toContain("claim_task");

    await user.clear(screen.getByLabelText("Search tools"));
    await user.type(screen.getByLabelText("Search tools"), "zzzz-nothing");
    expect(screen.getByText(/No tool matches/)).toBeTruthy();
  });
});

describe("SkillTab", () => {
  it("shows the real skill file with copy and download", () => {
    render(<SkillTab />);
    expect(screen.getByLabelText("SKILL.md").textContent).toContain("name: ai-planner");
    expect(screen.getByText("Copy skill")).toBeTruthy();
    expect(screen.getByText(/Download SKILL\.md/)).toBeTruthy();
  });
});

describe("WorkflowTab", () => {
  it("shows the progress rules agents follow", () => {
    render(<WorkflowTab />);
    expect(screen.getByText(/Claim a task before working on it/)).toBeTruthy();
    expect(screen.getByText(/Comment only when there is something to say/)).toBeTruthy();
  });
});
