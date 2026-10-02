import { describe, expect, it } from "vitest";
import { joinList, projectLosses } from "./project-impact";

const none = {
  tickets: 0,
  milestones: 0,
  meetings: 0,
  updates: 0,
  timeEntries: 0,
  quotes: 0,
  invoices: 0,
  issuedInvoices: 0,
  plans: 0,
};

describe("projectLosses", () => {
  it("is empty for a project with nothing in it", () => {
    expect(projectLosses(none)).toEqual([]);
  });

  it("names only what is there, with the right plural", () => {
    expect(projectLosses({ ...none, tickets: 12, milestones: 1, timeEntries: 1 })).toEqual([
      "12 tickets",
      "1 milestone",
      "1 time entry",
    ]);
  });

  it("does not count plans, which survive the delete", () => {
    expect(projectLosses({ ...none, plans: 4 })).toEqual([]);
  });
});

describe("joinList", () => {
  it("reads as a sentence", () => {
    expect(joinList([])).toBe("");
    expect(joinList(["a"])).toBe("a");
    expect(joinList(["a", "b"])).toBe("a and b");
    expect(joinList(["a", "b", "c"])).toBe("a, b and c");
  });
});
