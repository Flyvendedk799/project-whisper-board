import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TOOL_CATALOG } from "../../mcp/tool-catalog";
import { ConnectTab } from "./connect-tab";
import { PublicAgentsPage } from "./public-agents-page";

const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  auth.user = null;
});
afterEach(cleanup);

describe("PublicAgentsPage", () => {
  it("explains itself and counts the tools without needing an account", () => {
    render(<PublicAgentsPage tab="connect" onTabChange={() => {}} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/AI agent/);
    expect(screen.getByText(String(TOOL_CATALOG.length))).toBeTruthy();
  });

  it("asks a signed-out visitor to sign in or sign up, in the nav and where the key is made", () => {
    render(<PublicAgentsPage tab="connect" onTabChange={() => {}} />);
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toContain("/login");
    expect(hrefs).toContain("/signup");
    expect(screen.getByText("Create an account")).toBeTruthy();
    expect(screen.queryByText("Open the dashboard")).toBeNull();
  });

  it("sends someone who is signed in to the dashboard and to their key settings", () => {
    auth.user = { id: "user-1" };
    render(<PublicAgentsPage tab="connect" onTabChange={() => {}} />);
    expect(screen.getByText("Open the dashboard").closest("a")?.getAttribute("href")).toBe(
      "/app/agents",
    );
    expect(
      screen
        .getByText(/Open Settings/)
        .closest("a")
        ?.getAttribute("href"),
    ).toBe("/app/settings");
    expect(screen.queryByText("Create an account")).toBeNull();
  });

  it("shows the tab it is given and changes tab on click", async () => {
    const onTabChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<PublicAgentsPage tab="tools" onTabChange={onTabChange} />);
    expect(screen.getByLabelText("Search tools")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Tools" }).getAttribute("aria-selected")).toBe("true");

    await user.click(screen.getByRole("tab", { name: "Skill" }));
    expect(onTabChange).toHaveBeenCalledWith("skill");

    rerender(<PublicAgentsPage tab="skill" onTabChange={onTabChange} />);
    expect(screen.getByLabelText("SKILL.md").textContent).toContain("name: ai-planner");
  });

  it("opens the connect steps from the hero button", async () => {
    const onTabChange = vi.fn();
    const user = userEvent.setup();
    render(<PublicAgentsPage tab="workflow" onTabChange={onTabChange} />);
    await user.click(screen.getByRole("button", { name: "Connect an agent" }));
    expect(onTabChange).toHaveBeenCalledWith("connect");
  });

  it("downloads the skill as SKILL.md", async () => {
    const created: Blob[] = [];
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: (blob: Blob) => (created.push(blob), "blob:skill"),
      revokeObjectURL: () => {},
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const user = userEvent.setup();
    render(<PublicAgentsPage tab="connect" onTabChange={() => {}} />);

    await user.click(screen.getByRole("button", { name: /Download the skill/ }));

    expect(click).toHaveBeenCalledTimes(1);
    expect(await created[0].text()).toContain("name: ai-planner");
    click.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe("ConnectTab", () => {
  it("clones a public repository, with a zip as the alternative", () => {
    render(<ConnectTab />);
    expect(screen.getByText(/git clone https:\/\/github\.com\//)).toBeTruthy();
    const zip = screen.getByText("Download as a zip instead").closest("a");
    expect(zip?.getAttribute("href")).toMatch(/archive\/refs\/heads\/main\.zip$/);
  });

  it("offers the Cursor config and the env file as downloads", async () => {
    const user = userEvent.setup();
    render(<ConnectTab />);
    expect(screen.getByRole("button", { name: ".boared.env" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "mcp.json" })).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Cursor" }));
    expect(screen.getByRole("button", { name: "mcp.json" })).toBeTruthy();
  });

  it("says what each kind of key reaches, and lets the page decide how to get one", () => {
    render(<ConnectTab keyAction={<a href="/somewhere">Get a key here</a>} />);
    expect(screen.getByText("account")).toBeTruthy();
    expect(screen.getByText("planner")).toBeTruthy();
    expect(screen.getByText("Get a key here")).toBeTruthy();
    expect(screen.queryByText(/Open Settings/)).toBeNull();
  });
});
