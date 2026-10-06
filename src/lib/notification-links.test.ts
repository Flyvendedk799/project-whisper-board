import { describe, expect, it } from "vitest";
import { notificationLinkTarget } from "./notification-links";
import { planTaskLink } from "./notify-targets";

const PLAN = "11111111-2222-4333-8444-555555555555";
const TASK = "66666666-7777-4888-8999-000000000000";

describe("notificationLinkTarget", () => {
  it("opens a planner task from the link mentions and assignments use", () => {
    expect(notificationLinkTarget(planTaskLink(PLAN, TASK))).toEqual({
      kind: "plan",
      planId: PLAN,
      task: TASK,
    });
    expect(notificationLinkTarget(`/app/planner/${PLAN}`)).toEqual({ kind: "plan", planId: PLAN });
  });

  it("opens tickets and projects, keeping a project's tab", () => {
    expect(notificationLinkTarget("/app/tickets/t-1")).toEqual({ kind: "ticket", ticketId: "t-1" });
    expect(notificationLinkTarget("/app/projects/p-1?tab=billing")).toEqual({
      kind: "project",
      projectId: "p-1",
      tab: "billing",
    });
  });

  it("falls back to the path for other app pages, and ignores anything outside the app", () => {
    expect(notificationLinkTarget("/app/inbox?x=1")).toEqual({ kind: "app", path: "/app/inbox" });
    expect(notificationLinkTarget("/app/planner")).toEqual({ kind: "app", path: "/app/planner" });
    expect(notificationLinkTarget("https://evil.test/app/tickets/1")).toBeNull();
    expect(notificationLinkTarget("//evil.test/app")).toBeNull();
    expect(notificationLinkTarget(null)).toBeNull();
  });
});
