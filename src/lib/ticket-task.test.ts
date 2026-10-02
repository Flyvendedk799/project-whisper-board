import { describe, expect, it } from "vitest";
import {
  linkedTaskRow,
  taskDescriptionFromTicket,
  taskTitleFromTicket,
  ticketPriorityToTask,
} from "./ticket-task";

const base = {
  planId: "plan-1",
  sectionId: "section-1",
  position: 3,
  title: "Checkout button does nothing",
  description: null,
};

describe("linkedTaskRow", () => {
  it("makes the task available, so an agent can claim it", () => {
    expect(linkedTaskRow(base).status).toBe("available");
    expect(linkedTaskRow({ ...base, ticketId: "ticket-1", labels: ["bug"] }).status).toBe(
      "available",
    );
  });

  it("keeps the ticket link, tags and priority only when given", () => {
    expect(linkedTaskRow(base)).toEqual({
      plan_id: "plan-1",
      section_id: "section-1",
      title: "Checkout button does nothing",
      description: null,
      position: 3,
      status: "available",
    });
    expect(
      linkedTaskRow({ ...base, ticketId: "ticket-1", labels: ["bug"], priority: "high" }),
    ).toMatchObject({ ticket_id: "ticket-1", labels: ["bug"], priority: "high" });
  });
});

describe("ticket to task", () => {
  it("maps urgent to critical and leaves the rest", () => {
    expect(ticketPriorityToTask("urgent")).toBe("critical");
    expect(ticketPriorityToTask("low")).toBe("low");
  });

  it("trims and caps the title", () => {
    expect(taskTitleFromTicket("  Fix it  ")).toBe("Fix it");
    expect(taskTitleFromTicket("x".repeat(300))).toHaveLength(200);
  });

  it("opens the description with where it came from", () => {
    expect(
      taskDescriptionFromTicket({
        ticket_number: 7,
        type: "change_request",
        description: " Do X ",
      }),
    ).toBe("From ticket #7 (change request).\n\nDo X");
    expect(taskDescriptionFromTicket({ ticket_number: 7, type: "bug", description: null })).toBe(
      "From ticket #7 (bug).",
    );
  });
});
