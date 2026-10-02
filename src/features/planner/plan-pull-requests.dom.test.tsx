import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/test/render";
import { buildStack, pullKey, type PullInfo, type StackTask } from "@/lib/pr-stack";
import { PlanPullRequests } from "./plan-pull-requests";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
    search?: Record<string, string>;
  }) => (
    <a href={`${to}${search?.tab ? `?tab=${search.tab}` : ""}`} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));

const fns = vi.hoisted(() => ({
  getPlanPullRequests: vi.fn(),
  mergePlanPullRequests: vi.fn(),
}));
vi.mock("@/lib/plan-pulls.functions", () => fns);

const REPO = "o/openbot";

function pull(number: number, head: string, base: string, extra: Partial<PullInfo> = {}): PullInfo {
  return {
    number,
    url: `https://github.com/${REPO}/pull/${number}`,
    title: `PR ${number}`,
    state: "open",
    merged: false,
    draft: false,
    base,
    head,
    headSha: `sha${number}`,
    mergeable: true,
    mergeableState: "clean",
    checks: "success",
    ...extra,
  };
}

const TASKS: StackTask[] = [36, 37, 38].map((n, i) => ({
  id: `t${n}`,
  title: `Phase ${i}`,
  repo: REPO,
  prNumber: n,
  prUrl: `https://github.com/${REPO}/pull/${n}`,
  sectionPosition: 1,
  position: i + 1,
}));

function data(pulls: PullInfo[], over: Record<string, unknown> = {}) {
  return {
    planId: "plan-1",
    repo: REPO,
    configured: true,
    tokenCanMerge: true,
    isAdmin: true,
    canMerge: true,
    baseBranches: { [REPO]: "master" },
    fetchedAt: "2026-10-02T10:00:00Z",
    stack: buildStack({
      tasks: TASKS,
      pulls: new Map(pulls.map((p) => [pullKey(REPO, p.number), p])),
      baseBranchOf: () => "master",
    }),
    ...over,
  };
}

const STACK = [
  pull(36, "phase-0", "master"),
  pull(37, "phase-1", "phase-0"),
  pull(38, "phase-2", "phase-1"),
];

const step = (number: number, over: Record<string, unknown> = {}) => ({
  key: pullKey(REPO, number),
  repo: REPO,
  number,
  order: number - 35,
  tasks: [{ id: `t${number}`, title: `Phase ${number - 36}` }],
  action: number === 36 ? "merge" : "retarget_and_merge",
  retargetTo: number === 36 ? undefined : "master",
  outcome: "planned",
  ...over,
});

afterEach(cleanup);
beforeEach(() => {
  fns.getPlanPullRequests.mockReset();
  fns.mergePlanPullRequests.mockReset();
});

describe("PlanPullRequests", () => {
  it("lists the pull requests in merge order, with the branches and what each is waiting on", async () => {
    fns.getPlanPullRequests.mockResolvedValue(data(STACK));
    renderWithQuery(<PlanPullRequests planId="plan-1" />);

    const rows = await screen.findAllByTestId(/^pr-row-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "pr-row-36",
      "pr-row-37",
      "pr-row-38",
    ]);
    expect(within(rows[0]).getByText("Ready to merge")).toBeTruthy();
    expect(within(rows[1]).getByText("Waiting for the one above")).toBeTruthy();
    expect(within(rows[1]).getByText(/phase-0.*phase-1|phase-0 ← phase-1/)).toBeTruthy();
    expect(within(rows[1]).getByText("stacked on #36")).toBeTruthy();
    expect(screen.getByText(/0 of 3 merged/)).toBeTruthy();
  });

  it("offers Merge only on the next pull request in line", async () => {
    fns.getPlanPullRequests.mockResolvedValue(data(STACK));
    renderWithQuery(<PlanPullRequests planId="plan-1" />);
    await screen.findByTestId("pr-row-36");
    expect(screen.queryByTestId("merge-36")).toBeTruthy();
    expect(screen.queryByTestId("merge-37")).toBeNull();
    expect(screen.queryByTestId("merge-38")).toBeNull();
  });

  it("shows what blocks a pull request", async () => {
    fns.getPlanPullRequests.mockResolvedValue(
      data([
        STACK[0],
        pull(37, "phase-1", "phase-0", { mergeable: false, mergeableState: "dirty" }),
        pull(38, "phase-2", "phase-1", { checks: "failure" }),
      ]),
    );
    renderWithQuery(<PlanPullRequests planId="plan-1" />);
    const blocked = await screen.findByTestId("pr-row-37");
    expect(within(blocked).getByText("Has merge conflicts.")).toBeTruthy();
    expect(within(screen.getByTestId("pr-row-38")).getByText("Checks failing")).toBeTruthy();
  });

  it("explains itself, and disables merging, when GitHub is not connected", async () => {
    fns.getPlanPullRequests.mockResolvedValue(
      data(STACK, {
        configured: false,
        canMerge: false,
        tokenCanMerge: false,
        orderIsGuess: true,
        stack: buildStack({ tasks: TASKS, pulls: new Map(), baseBranchOf: () => "master" }),
      }),
    );
    renderWithQuery(<PlanPullRequests planId="plan-1" />);
    expect(await screen.findByText(/GitHub is not connected, so the state/)).toBeTruthy();
    expect(screen.getByText(/this order is a guess, by pull request number/)).toBeTruthy();
    expect(screen.getByText(/Connect GitHub to work it out from the branches/)).toBeTruthy();
    expect((screen.getByTestId("merge-all") as HTMLButtonElement).disabled).toBe(true);
    // still a way to follow the order on GitHub
    expect(screen.getAllByLabelText("Open on GitHub").length).toBeGreaterThan(0);
  });

  it("sends you to connect your own GitHub, to the tab you can see, when there is no token", async () => {
    const none = {
      configured: false,
      tokenSource: "none",
      canMerge: false,
      tokenCanMerge: false,
      orderIsGuess: true,
      stack: buildStack({ tasks: TASKS, pulls: new Map(), baseBranchOf: () => "master" }),
    };
    fns.getPlanPullRequests.mockResolvedValue(data(STACK, { ...none, isAdmin: true }));
    const view = renderWithQuery(<PlanPullRequests planId="plan-1" />);
    const cta = within(await screen.findByTestId("connect-github")).getByRole("link", {
      name: "Connect GitHub",
    });
    expect(cta.getAttribute("href")).toBe("/app/settings?tab=integrations");
    view.unmount();

    fns.getPlanPullRequests.mockResolvedValue(data(STACK, { ...none, isAdmin: false }));
    renderWithQuery(<PlanPullRequests planId="plan-1" />);
    const member = within(await screen.findByTestId("connect-github")).getByRole("link", {
      name: "Connect GitHub",
    });
    expect(member.getAttribute("href")).toBe("/app/settings?tab=you");
  });

  it("does not ask you to connect when GitHub is connected", async () => {
    fns.getPlanPullRequests.mockResolvedValue(data(STACK, { tokenSource: "user" }));
    renderWithQuery(<PlanPullRequests planId="plan-1" />);
    await screen.findByTestId("pr-row-36");
    expect(screen.queryByTestId("connect-github")).toBeNull();
  });

  it("tells you what your token lacks when it cannot merge, and how to fix it", async () => {
    fns.getPlanPullRequests.mockResolvedValue(
      data(STACK, { tokenSource: "user", tokenCanMerge: false, canMerge: false }),
    );
    renderWithQuery(<PlanPullRequests planId="plan-1" />);
    expect(
      await screen.findByText(/Your token cannot merge: it needs write access to o\/openbot/),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Reconnect with a token that has it" })).toBeTruthy();
  });

  it("says when the shared server token is the one in use", async () => {
    fns.getPlanPullRequests.mockResolvedValue(data(STACK, { tokenSource: "workspace" }));
    renderWithQuery(<PlanPullRequests planId="plan-1" />);
    expect(await screen.findByText(/Using the shared token this server has/)).toBeTruthy();
  });

  it("does not offer merging to someone who is not an admin", async () => {
    fns.getPlanPullRequests.mockResolvedValue(data(STACK, { isAdmin: false, canMerge: false }));
    renderWithQuery(<PlanPullRequests planId="plan-1" />);
    expect(await screen.findByText(/Only workspace admins can merge/)).toBeTruthy();
    expect((screen.getByTestId("merge-all") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("merge-36")).toBeNull();
  });

  it("merges all in order after showing the dry run, one pull request at a time", async () => {
    fns.getPlanPullRequests.mockResolvedValue(data(STACK));
    const dry = {
      dryRun: true,
      method: "merge",
      warning: null,
      steps: [step(36), step(37), step(38)],
      stoppedAt: null,
      remaining: 3,
    };
    fns.mergePlanPullRequests.mockImplementation(
      async ({ data: input }: { data: Record<string, unknown> }) => {
        if (input.dryRun) return dry;
        const calls = fns.mergePlanPullRequests.mock.calls.filter(([a]) => !a.data.dryRun).length;
        const mergedUpTo = 35 + calls; // 1st real call merges #36, 2nd #37, ...
        return {
          dryRun: false,
          method: "merge",
          warning: null,
          stoppedAt: null,
          remaining: 38 - mergedUpTo,
          steps: [36, 37, 38].map((n) =>
            step(n, {
              outcome: n <= mergedUpTo ? (n === mergedUpTo ? "merged" : "skipped") : "pending",
            }),
          ),
        };
      },
    );
    const user = userEvent.setup();
    renderWithQuery(<PlanPullRequests planId="plan-1" />);

    await user.click(await screen.findByTestId("merge-all"));
    // The dry run is shown before anything is merged.
    expect(await screen.findByTestId("merge-step-37")).toBeTruthy();
    // #37 and #38 sit on branches that will be merged away, so both say they are retargeted first.
    expect(screen.getAllByText(/pointed at master first/)).toHaveLength(2);
    expect(fns.mergePlanPullRequests.mock.calls.every(([a]) => a.data.dryRun)).toBe(true);

    await user.click(screen.getByTestId("confirm-merge"));
    await waitFor(() =>
      expect(screen.getByTestId("merge-step-38").getAttribute("data-outcome")).toMatch(
        /merged|skipped/,
      ),
    );
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(2));

    const real = fns.mergePlanPullRequests.mock.calls
      .filter(([a]) => !a.data.dryRun)
      .map(([a]) => a.data);
    expect(real).toHaveLength(3);
    expect(real.every((d) => d.max === 1 && d.method === "merge")).toBe(true);
    for (const n of [36, 37, 38]) {
      expect(screen.getByTestId(`merge-step-${n}`).getAttribute("data-outcome")).toMatch(
        /merged|skipped/,
      );
    }
  });

  it("stops and says why when a pull request fails", async () => {
    fns.getPlanPullRequests.mockResolvedValue(data(STACK));
    fns.mergePlanPullRequests.mockImplementation(
      async ({ data: input }: { data: Record<string, unknown> }) => {
        if (input.dryRun) {
          return {
            dryRun: true,
            method: "merge",
            warning: null,
            steps: [step(36), step(37), step(38)],
            stoppedAt: null,
            remaining: 3,
          };
        }
        return {
          dryRun: false,
          method: "merge",
          warning: null,
          stoppedAt: 36,
          remaining: 3,
          steps: [
            step(36, {
              outcome: "failed",
              message: "It has merge conflicts with master. Resolve them on GitHub.",
            }),
            step(37, { outcome: "not_reached" }),
            step(38, { outcome: "not_reached" }),
          ],
        };
      },
    );
    const user = userEvent.setup();
    renderWithQuery(<PlanPullRequests planId="plan-1" />);
    await user.click(await screen.findByTestId("merge-all"));
    await user.click(await screen.findByTestId("confirm-merge"));

    await screen.findByText(/It has merge conflicts with master/);
    expect(fns.mergePlanPullRequests.mock.calls.filter(([a]) => !a.data.dryRun)).toHaveLength(1);
  });

  it("only offers to merge up to a blocked pull request, and says where it stops", async () => {
    fns.getPlanPullRequests.mockResolvedValue(data(STACK));
    fns.mergePlanPullRequests.mockResolvedValue({
      dryRun: true,
      method: "merge",
      warning: null,
      stoppedAt: 38,
      remaining: 3,
      steps: [
        step(36),
        step(37),
        step(38, { action: "blocked", outcome: "planned", message: "Has merge conflicts." }),
      ],
    });
    const user = userEvent.setup();
    renderWithQuery(<PlanPullRequests planId="plan-1" />);
    await user.click(await screen.findByTestId("merge-all"));
    expect(await screen.findByText("It will merge 2 and then stop at #38.")).toBeTruthy();
    expect(screen.getByTestId("confirm-merge").textContent).toContain("Merge 2 now");
  });

  it("warns before squashing a stack", async () => {
    fns.getPlanPullRequests.mockResolvedValue(data(STACK));
    fns.mergePlanPullRequests.mockResolvedValue({
      dryRun: true,
      method: "squash",
      warning:
        "Squash merging rewrites each branch's commits, so the pull requests stacked on top of it will conflict.",
      steps: [step(36), step(37), step(38)],
      stoppedAt: null,
      remaining: 3,
    });
    const user = userEvent.setup();
    renderWithQuery(<PlanPullRequests planId="plan-1" />);
    await screen.findByTestId("pr-row-36");
    await user.click(screen.getByRole("button", { name: "Squash" }));
    await user.click(screen.getByTestId("merge-all"));
    expect(await screen.findByText(/Squash merging rewrites/)).toBeTruthy();
    expect(fns.mergePlanPullRequests.mock.calls[0][0].data.method).toBe("squash");
  });
});
