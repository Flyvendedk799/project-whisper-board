import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithQuery } from "@/test/render";
import { ProjectAiPlansTab } from "./project-ai-plans";

const auth = vi.hoisted(() => ({ isAdmin: false, workspaceId: "w1" }));

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ workspaceId: auth.workspaceId, isAdmin: auth.isAdmin }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string;
    params?: { planId?: string };
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={params?.planId ? `${to.replace("$planId", params.planId)}` : to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/data/planner", () => ({
  planListQuery: () => ({
    queryKey: ["plans", "w1", "p1"],
    queryFn: async () => ({
      plans: [
        {
          id: "plan-1",
          title: "Delivery",
          description: "Ship the storefront",
          status: "active",
          section_count: 2,
          task_count: 5,
          done_task_count: 1,
          clients_can_view: true,
        },
      ],
    }),
  }),
}));

afterEach(() => {
  cleanup();
  auth.isAdmin = false;
});

describe("ProjectAiPlansTab", () => {
  it("lets a client open a project plan when it is visible", async () => {
    auth.isAdmin = false;
    renderWithQuery(<ProjectAiPlansTab projectId="p1" />);

    const link = await screen.findByRole("link", { name: /Delivery/i });
    expect(link).toHaveAttribute("href", expect.stringContaining("plan-1"));
    expect(screen.queryByRole("link", { name: /New plan/i })).not.toBeInTheDocument();
  });

  it("keeps create actions admin-only while still listing plans", async () => {
    auth.isAdmin = true;
    renderWithQuery(<ProjectAiPlansTab projectId="p1" />);

    expect(await screen.findByRole("link", { name: /Delivery/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /New plan/i })).toBeInTheDocument();
  });
});
