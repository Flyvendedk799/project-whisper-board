import { describe, expect, it } from "vitest";
import { mergeComingUp, parseDashboardSummary, startOfWeek, type ComingUpItem } from "./dashboard";
import { parseQueueCounts } from "./tickets";
import { dayLabel, formatClock, groupByDay, localDayKey } from "./time";

describe("parseDashboardSummary", () => {
  it("reads the RPC payload", () => {
    expect(
      parseDashboardSummary({
        outstanding: [{ currency: "DKK", cents: 5100000, invoices: 2, overdue: 1 }],
        weekMinutes: 385,
        weekBillableMinutes: 305,
      }),
    ).toEqual({
      outstanding: [{ currency: "DKK", cents: 5100000, invoices: 2, overdue: 1 }],
      weekMinutes: 385,
      weekBillableMinutes: 305,
    });
  });

  it("degrades to zeros on anything unexpected", () => {
    for (const bad of [null, undefined, "x", [], { outstanding: "no", weekMinutes: "NaN" }]) {
      expect(parseDashboardSummary(bad)).toEqual({
        outstanding: [],
        weekMinutes: 0,
        weekBillableMinutes: 0,
      });
    }
  });

  it("drops malformed currency rows and clamps negatives", () => {
    const parsed = parseDashboardSummary({
      outstanding: [{ cents: 5 }, null, { currency: "USD", cents: -4, invoices: 1 }],
    });
    expect(parsed.outstanding).toEqual([{ currency: "USD", cents: 0, invoices: 1, overdue: 0 }]);
  });
});

describe("parseQueueCounts", () => {
  it("returns every key, defaulting missing or bad ones to 0", () => {
    expect(parseQueueCounts({ allOpen: 12, needsTriage: "3", mine: -1, breached: null })).toEqual({
      allOpen: 12,
      needsTriage: 3,
      unassigned: 0,
      awaiting: 0,
      breached: 0,
      atRisk: 0,
      mine: 0,
      closed: 0,
    });
  });

  it("survives a non-object", () => {
    expect(parseQueueCounts(null).allOpen).toBe(0);
    expect(parseQueueCounts([1, 2]).needsTriage).toBe(0);
  });
});

describe("mergeComingUp", () => {
  const item = (over: Partial<ComingUpItem>): ComingUpItem => ({
    id: "x",
    kind: "meeting",
    title: "t",
    at: "2026-10-01T10:00:00.000Z",
    projectId: "p",
    projectTitle: null,
    overdue: false,
    ...over,
  });

  it("orders meetings and milestones together, soonest first", () => {
    const merged = mergeComingUp([
      item({ id: "late", at: "2026-10-09T10:00:00.000Z" }),
      item({ id: "ms", kind: "milestone", at: "2026-10-03" }),
      item({ id: "early", at: "2026-10-01T10:00:00.000Z" }),
    ]);
    expect(merged.map((i) => i.id)).toEqual(["early", "ms", "late"]);
  });

  it("puts overdue milestones first and respects the limit", () => {
    const merged = mergeComingUp(
      [
        item({ id: "m", at: "2026-10-05T10:00:00.000Z" }),
        item({ id: "over", kind: "milestone", at: "2026-09-01", overdue: true }),
      ],
      1,
    );
    expect(merged.map((i) => i.id)).toEqual(["over"]);
  });
});

describe("startOfWeek", () => {
  it("lands on Monday at midnight", () => {
    const wed = new Date(2026, 8, 30, 15, 20); // Wed 30 Sep 2026
    const monday = startOfWeek(wed);
    expect(monday.getDay()).toBe(1);
    expect(monday.getHours()).toBe(0);
    expect(monday.getDate()).toBe(28);
  });

  it("treats Sunday as the end of the week, not the start", () => {
    expect(startOfWeek(new Date(2026, 9, 4)).getDate()).toBe(28);
  });
});

describe("time grouping", () => {
  const entry = (started_at: string, duration_minutes: number | null) => ({
    started_at,
    duration_minutes,
  });

  it("groups by local day, newest day first, with totals", () => {
    const a = new Date(2026, 8, 30, 9).toISOString();
    const b = new Date(2026, 8, 30, 14).toISOString();
    const c = new Date(2026, 8, 29, 10).toISOString();
    const groups = groupByDay([entry(c, 120), entry(a, 95), entry(b, null)]);
    expect(groups.map((g) => g.key)).toEqual(["2026-09-30", "2026-09-29"]);
    expect(groups[0].minutes).toBe(95);
    expect(groups[0].entries).toHaveLength(2);
    expect(groups[1].minutes).toBe(120);
  });

  it("labels today and yesterday", () => {
    const now = new Date(2026, 8, 30, 12);
    expect(dayLabel(localDayKey(now), now)).toBe("Today");
    expect(dayLabel("2026-09-29", now)).toBe("Yesterday");
    expect(dayLabel("2026-09-21", now)).not.toMatch(/Today|Yesterday/);
  });

  it("formats a running clock", () => {
    expect(formatClock(0)).toBe("0:00:00");
    expect(formatClock(61_000)).toBe("0:01:01");
    expect(formatClock(3_725_000)).toBe("1:02:05");
    expect(formatClock(-5)).toBe("0:00:00");
  });
});
