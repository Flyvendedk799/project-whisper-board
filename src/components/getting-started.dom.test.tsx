import { describe, expect, it, beforeEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { GettingStartedGuide } from "@/components/getting-started";

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ workspaceId: "ws-1" }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

afterEach(cleanup);

describe("GettingStartedGuide", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows invite → project → ticket steps when all are incomplete", () => {
    render(
      <GettingStartedGuide
        hasClient={false}
        hasProject={false}
        hasTickets={false}
        loading={false}
      />,
    );
    expect(screen.getByRole("heading", { name: /get your first ticket/i })).toBeInTheDocument();
    expect(screen.getByText("Invite a client")).toBeInTheDocument();
    expect(screen.getByText("Create a project")).toBeInTheDocument();
    expect(screen.getByText("Report a first ticket")).toBeInTheDocument();
  });

  it("hides when every step is done", () => {
    const { container } = render(
      <GettingStartedGuide hasClient hasProject hasTickets firstProjectId="p1" loading={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the report step when a client and project exist but tickets do not", () => {
    render(
      <GettingStartedGuide
        hasClient
        hasProject
        hasTickets={false}
        firstProjectId="p1"
        loading={false}
      />,
    );
    expect(screen.getByText("Report a first ticket")).toBeInTheDocument();
    expect(screen.queryByText("Create a project")).not.toBeInTheDocument();
  });
});
