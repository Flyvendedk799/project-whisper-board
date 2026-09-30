import { describe, expect, it } from "vitest";
import { ticketFiltersSchema } from "@/data/filters";
import {
  CLEARED_FILTERS,
  QUEUE_VIEWS,
  matchesQueueView,
  queueSearch,
  queueView,
} from "./queue-views";

describe("queue views", () => {
  it("every view's filters are valid route search params", () => {
    for (const view of QUEUE_VIEWS) {
      expect(ticketFiltersSchema.safeParse(queueSearch(view.id)).success).toBe(true);
    }
  });

  it("scopes assignee views to open tickets, like the count beside them", () => {
    expect(queueView("unassigned").filters.status).not.toContain("done");
    expect(queueView("mine").filters.status).not.toContain("wont_fix");
    expect(queueView("closed").filters.status).toEqual(["done", "wont_fix"]);
  });

  it("recognises the active view from the URL, ignoring search text and sort", () => {
    const view = queueView("breached");
    expect(matchesQueueView(ticketFiltersSchema.parse(queueSearch("breached")), view)).toBe(true);
    expect(
      matchesQueueView(ticketFiltersSchema.parse({ ...queueSearch("breached"), q: "pay" }), view),
    ).toBe(true);
    expect(
      matchesQueueView(
        ticketFiltersSchema.parse({ sla: "breached", projectId: undefined, sort: "newest" }),
        view,
      ),
    ).toBe(true);
  });

  it("does not match once another filter is added or a saved view is active", () => {
    const view = queueView("breached");
    const extra = ticketFiltersSchema.parse({
      ...queueSearch("breached"),
      priority: ["urgent"],
    });
    expect(matchesQueueView(extra, view)).toBe(false);
    const saved = ticketFiltersSchema.parse({
      ...queueSearch("breached"),
      view: "7d6c3c1a-0000-4000-8000-000000000000",
    });
    expect(matchesQueueView(saved, view)).toBe(false);
  });

  it("clearing removes every filter field", () => {
    expect(
      Object.values({ ...CLEARED_FILTERS, sort: undefined }).every((v) => v === undefined),
    ).toBe(true);
  });
});
