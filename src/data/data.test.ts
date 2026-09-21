import { describe, expect, it } from "vitest";
import { qk } from "./keys";
import { EMPTY_FILTERS, filterCacheKey, isFiltered, ticketFiltersSchema } from "./filters";
import { TICKET_STATUSES, TICKET_STATUS_LABEL, TICKET_BOARD_ORDER, options } from "./enums";
import { lineItemTotal, outstandingCents, sumLines, withTax } from "./billing";
import { channelEnabled } from "./notifications";
import { elapsedMinutes, formatMinutes, totalMinutes } from "./time";
import { viewFilters } from "./views";
import type { InvoiceWithLines, NotificationPreferences, SavedView } from "./types";

describe("query keys", () => {
  const isPrefixOf = (prefix: readonly unknown[], key: readonly unknown[]) =>
    prefix.every((part, i) => Object.is(part, key[i]));

  it("nests detail keys under the collection, so one invalidate covers both", () => {
    expect(isPrefixOf(qk.tickets(), qk.ticket("t1"))).toBe(true);
    expect(isPrefixOf(qk.projects(), qk.project("p1"))).toBe(true);
  });

  it("nests everything belonging to a ticket under that ticket", () => {
    for (const child of [
      qk.ticketComments("t1"),
      qk.ticketEvents("t1"),
      qk.ticketAttachments("t1"),
      qk.ticketRelations("t1"),
      qk.ticketContext("t1"),
      qk.ticketTime("t1"),
    ]) {
      expect(isPrefixOf(qk.ticket("t1"), child)).toBe(true);
    }
  });

  it("keeps different records apart", () => {
    expect(isPrefixOf(qk.ticket("t1"), qk.ticket("t2"))).toBe(false);
    expect(isPrefixOf(qk.ticketComments("t1"), qk.ticketComments("t2"))).toBe(false);
  });

  it("puts every key under one root, so signing out can clear the lot", () => {
    for (const key of [
      qk.session(),
      qk.ticketList(EMPTY_FILTERS),
      qk.projectList(),
      qk.workspacePeople(),
      qk.notificationCount(),
      qk.savedViews(),
      qk.timer(),
    ]) {
      expect(isPrefixOf(qk.all, key)).toBe(true);
    }
  });
});

describe("ticket filters", () => {
  it("defaults to sorting by most recently touched", () => {
    expect(ticketFiltersSchema.parse({})).toEqual({ sort: "updated" });
  });

  it("rejects a status that is not in the database enum", () => {
    expect(ticketFiltersSchema.safeParse({ status: ["nonsense"] }).success).toBe(false);
    expect(ticketFiltersSchema.safeParse({ status: ["open", "done"] }).success).toBe(true);
  });

  it("accepts the two symbolic assignees as well as a real id", () => {
    for (const assignee of ["me", "unassigned", "550e8400-e29b-41d4-a716-446655440000"]) {
      expect(ticketFiltersSchema.safeParse({ assignee }).success).toBe(true);
    }
    expect(ticketFiltersSchema.safeParse({ assignee: "someone" }).success).toBe(false);
  });

  it("excludes presentation from the cache key, so toggling the board does not refetch", () => {
    const list = ticketFiltersSchema.parse({ status: ["open"], board: false });
    const board = ticketFiltersSchema.parse({ status: ["open"], board: true, view: undefined });
    expect(filterCacheKey(list)).toEqual(filterCacheKey(board));
  });

  it("knows whether anything is actually filtering", () => {
    expect(isFiltered(ticketFiltersSchema.parse({}))).toBe(false);
    expect(isFiltered(ticketFiltersSchema.parse({ board: true }))).toBe(false);
    expect(isFiltered(ticketFiltersSchema.parse({ status: [] }))).toBe(false);
    expect(isFiltered(ticketFiltersSchema.parse({ status: ["open"] }))).toBe(true);
    expect(isFiltered(ticketFiltersSchema.parse({ q: "checkout" }))).toBe(true);
    expect(isFiltered(ticketFiltersSchema.parse({ sort: "sla" }))).toBe(true);
  });
});

describe("enums", () => {
  it("labels every value the database can hold", () => {
    for (const status of TICKET_STATUSES) {
      expect(TICKET_STATUS_LABEL[status]).toBeTruthy();
    }
  });

  it("only puts real statuses on the board", () => {
    for (const status of TICKET_BOARD_ORDER) {
      expect(TICKET_STATUSES).toContain(status);
    }
  });

  it("builds select options in the database's own order", () => {
    expect(options(TICKET_STATUSES, TICKET_STATUS_LABEL)[0]).toEqual({
      value: "open",
      label: "Open",
    });
  });
});

describe("billing arithmetic", () => {
  it("rounds a fractional quantity to whole cents", () => {
    expect(lineItemTotal({ quantity: 1.5, unit_price_cents: 12_345 })).toBe(18_518);
    expect(
      sumLines([
        { quantity: 2, unit_price_cents: 10_000 },
        { quantity: 0.5, unit_price_cents: 9_999 },
      ]),
    ).toBe(25_000);
  });

  it("applies tax in basis points", () => {
    expect(withTax(100_000, 0)).toBe(100_000);
    expect(withTax(100_000, 825)).toBe(108_250);
    expect(withTax(1, 825)).toBe(1);
  });

  it("counts only successful payments toward what is outstanding", () => {
    const invoice = {
      amount_cents: 150_000,
      payments: [
        { amount_cents: 50_000, status: "succeeded" },
        { amount_cents: 90_000, status: "failed" },
        { amount_cents: 10_000, status: "pending" },
      ],
    } as InvoiceWithLines;
    expect(outstandingCents(invoice)).toBe(100_000);
  });

  it("never reports a negative balance on an overpayment", () => {
    const invoice = {
      amount_cents: 100_000,
      payments: [{ amount_cents: 150_000, status: "succeeded" }],
    } as InvoiceWithLines;
    expect(outstandingCents(invoice)).toBe(0);
  });
});

describe("notification preferences", () => {
  const prefs = (channels: unknown) => ({ channels }) as NotificationPreferences;

  it("reads a configured channel", () => {
    const p = prefs({ comment: { in_app: true, email: false } });
    expect(channelEnabled(p, "comment", "in_app")).toBe(true);
    expect(channelEnabled(p, "comment", "email")).toBe(false);
  });

  it("defaults to on for anything the stored row does not mention", () => {
    expect(channelEnabled(prefs({}), "milestone", "email")).toBe(true);
    expect(channelEnabled(prefs({ comment: {} }), "comment", "email")).toBe(true);
    expect(channelEnabled(null, "comment", "email")).toBe(true);
  });

  it("survives a malformed row rather than throwing during a render", () => {
    expect(channelEnabled(prefs("not an object"), "comment", "email")).toBe(true);
    expect(channelEnabled(prefs(["an", "array"]), "comment", "email")).toBe(true);
    expect(channelEnabled(prefs({ comment: null }), "comment", "email")).toBe(true);
  });
});

describe("time", () => {
  it("formats durations the way people say them", () => {
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(165)).toBe("2h 45m");
    expect(formatMinutes(0)).toBe("—");
    expect(formatMinutes(null)).toBe("—");
  });

  it("ignores entries that are still running when totalling", () => {
    expect(totalMinutes([{ duration_minutes: 60 }, { duration_minutes: null }])).toBe(60);
  });

  it("measures a running timer from its start", () => {
    const now = new Date("2026-03-09T12:00:00Z").getTime();
    expect(elapsedMinutes("2026-03-09T11:15:00Z", now)).toBe(45);
  });

  it("never reports negative elapsed time from a clock skew", () => {
    const now = new Date("2026-03-09T12:00:00Z").getTime();
    expect(elapsedMinutes("2026-03-09T12:05:00Z", now)).toBe(0);
  });
});

describe("saved views", () => {
  it("round-trips the filters it stored", () => {
    const view = { filters: { status: ["open"], sort: "sla" } } as unknown as SavedView;
    expect(viewFilters(view)).toEqual({ status: ["open"], sort: "sla" });
  });

  it("falls back to defaults for a view saved by an older version", () => {
    const view = { filters: { status: ["a_status_we_removed"] } } as unknown as SavedView;
    expect(viewFilters(view)).toEqual({ sort: "updated" });
  });
});
