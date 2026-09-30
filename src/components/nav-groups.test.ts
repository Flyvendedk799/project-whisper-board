import { describe, expect, it } from "vitest";
import { buildNavGroups, isNavActive } from "./nav-groups";

describe("buildNavGroups", () => {
  it("gives agency admins the grouped work / business / inbox layout", () => {
    const groups = buildNavGroups({ isAdmin: true, needsTriage: 4, unread: 2 });
    expect(groups.map((g) => g.map((i) => i.label))).toEqual([
      ["Home", "Triage", "Projects", "AI Planner"],
      ["Clients", "Time", "Reports", "Team"],
      ["Inbox", "Settings"],
    ]);
    expect(groups[0][1].badge).toBe(4);
    expect(groups[2][0].badge).toBe(2);
  });

  it("gives clients a short list with My tickets instead of Triage", () => {
    const groups = buildNavGroups({ isAdmin: false, needsTriage: 9, unread: 0 });
    expect(groups.flat().map((i) => i.label)).toEqual([
      "Home",
      "My tickets",
      "Projects",
      "Inbox",
      "Settings",
    ]);
    // A client never sees the agency's triage count.
    expect(groups.flat().some((i) => i.label === "Triage")).toBe(false);
  });

  it("sends Triage to the All open queue", () => {
    const triage = buildNavGroups({ isAdmin: true, needsTriage: 0, unread: 0 })[0][1];
    expect(triage.search).toMatchObject({ sort: "updated" });
    expect(triage.search?.status).toContain("open");
  });
});

describe("isNavActive", () => {
  const [[home, triage]] = buildNavGroups({ isAdmin: true, needsTriage: 0, unread: 0 });
  const [[, myTickets]] = buildNavGroups({ isAdmin: false, needsTriage: 0, unread: 0 });

  it("matches Home exactly", () => {
    expect(isNavActive(home, "/app")).toBe(true);
    expect(isNavActive(home, "/app/triage")).toBe(false);
  });

  it("keeps Triage lit on ticket detail and the report form for admins", () => {
    expect(isNavActive(triage, "/app/triage")).toBe(true);
    expect(isNavActive(triage, "/app/tickets/abc")).toBe(true);
    expect(isNavActive(triage, "/app/report")).toBe(true);
    expect(isNavActive(triage, "/app/projects")).toBe(false);
  });

  it("keeps My tickets lit on ticket detail and the report form for clients", () => {
    expect(isNavActive(myTickets, "/app/tickets")).toBe(true);
    expect(isNavActive(myTickets, "/app/tickets/abc")).toBe(true);
    expect(isNavActive(myTickets, "/app/report")).toBe(true);
  });
});
