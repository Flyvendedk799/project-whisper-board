import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/test/render";
import type { GitHubConnection } from "@/lib/github-token";
import { GitHubAccountCard } from "./github-account";

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));

const fns = vi.hoisted(() => ({
  getGitHubStatus: vi.fn(),
  connectGitHub: vi.fn(),
  disconnectGitHub: vi.fn(),
}));
vi.mock("@/lib/github.functions", () => fns);

const TOKEN = "ghp_secretLookingToken0123456789abcdefghijkl";

const NONE: GitHubConnection = {
  available: true,
  connected: false,
  source: "none",
  login: null,
  scopes: null,
  hint: null,
  problem: null,
};
const MINE: GitHubConnection = {
  available: true,
  connected: true,
  source: "user",
  login: "tobias",
  scopes: ["repo"],
  hint: "ghp_…hijkl",
  problem: null,
};

beforeEach(() => {
  fns.getGitHubStatus.mockReset();
  fns.connectGitHub.mockReset();
  fns.disconnectGitHub.mockReset();
});
afterEach(cleanup);

describe("GitHubAccountCard", () => {
  it("offers to connect, with what the token needs, and keeps the token out of sight", async () => {
    fns.getGitHubStatus.mockResolvedValue(NONE);
    renderWithQuery(<GitHubAccountCard />);

    expect(await screen.findByText("Not connected")).toBeTruthy();
    const input = screen.getByLabelText("Your GitHub token") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(screen.getByText(/Contents: Read and write/)).toBeTruthy();
    expect(screen.getByText(/Pull requests: Read and write/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Connect GitHub" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("sends the pasted token once, then shows who it belongs to and never the token", async () => {
    fns.getGitHubStatus.mockResolvedValueOnce(NONE).mockResolvedValue(MINE);
    fns.connectGitHub.mockResolvedValue(MINE);
    const user = userEvent.setup();
    renderWithQuery(<GitHubAccountCard />);

    await user.type(await screen.findByLabelText("Your GitHub token"), TOKEN);
    await user.click(screen.getByRole("button", { name: "Connect GitHub" }));

    await waitFor(() => expect(fns.connectGitHub).toHaveBeenCalledWith({ data: { token: TOKEN } }));
    expect(await screen.findByText("@tobias")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
    // The field is emptied and the page never prints the secret.
    expect((screen.getByLabelText("Replace your token") as HTMLInputElement).value).toBe("");
    expect(document.body.textContent).not.toContain(TOKEN);
    expect(document.body.textContent).toContain("ghp_…hijkl");
  });

  it("disconnects your own token", async () => {
    fns.getGitHubStatus.mockResolvedValueOnce(MINE).mockResolvedValue(NONE);
    fns.disconnectGitHub.mockResolvedValue(NONE);
    const user = userEvent.setup();
    renderWithQuery(<GitHubAccountCard />);

    await user.click(await screen.findByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(fns.disconnectGitHub).toHaveBeenCalled());
    expect(await screen.findByText("Not connected")).toBeTruthy();
  });

  it("says when the shared server token is what is in use, and still lets you connect your own", async () => {
    fns.getGitHubStatus.mockResolvedValue({ ...MINE, source: "workspace", login: "shared-bot" });
    renderWithQuery(<GitHubAccountCard />);

    expect(await screen.findByText(/shared token this server has/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
    expect(screen.getByLabelText("Your GitHub token")).toBeTruthy();
  });

  it("shows what is wrong, in words, when GitHub no longer accepts the token", async () => {
    fns.getGitHubStatus.mockResolvedValue({
      ...MINE,
      connected: false,
      login: null,
      problem: "GitHub no longer accepts your token. Connect it again.",
    });
    renderWithQuery(<GitHubAccountCard />);

    expect(await screen.findByText("Needs attention")).toBeTruthy();
    expect(screen.getByText(/no longer accepts your token/)).toBeTruthy();
  });

  it("explains itself, and offers no form, when this deployment cannot keep a token", async () => {
    fns.getGitHubStatus.mockResolvedValue({ ...NONE, available: false });
    renderWithQuery(<GitHubAccountCard />);

    expect(await screen.findByText(/nowhere to keep a token/)).toBeTruthy();
    expect(screen.queryByLabelText("Your GitHub token")).toBeNull();
  });
});
