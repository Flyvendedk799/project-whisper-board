import { describe, expect, it, vi, afterEach } from "vitest";
import { formatCents, formatDate, formatRelative, initials } from "./utils-format";

describe("formatCents", () => {
  it("renders cents as currency", () => {
    expect(formatCents(125_000)).toBe("$1,250.00");
    expect(formatCents(1, "EUR")).toBe("€0.01");
  });

  it("renders an em dash for absent amounts, but not for zero", () => {
    expect(formatCents(null)).toBe("—");
    expect(formatCents(undefined)).toBe("—");
    expect(formatCents(0)).toBe("$0.00");
  });
});

describe("formatDate", () => {
  it("formats an ISO string", () => {
    expect(formatDate("2026-03-09T12:00:00.000Z")).toBe("Mar 9, 2026");
  });

  it("renders an em dash for absent dates", () => {
    expect(formatDate(null)).toBe("—");
  });
});

describe("formatRelative", () => {
  afterEach(() => vi.useRealTimers());

  const at = (iso: string) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-09T12:00:00.000Z"));
    return formatRelative(iso);
  };

  it("steps through minutes, hours and days", () => {
    expect(at("2026-03-09T11:59:40.000Z")).toBe("just now");
    expect(at("2026-03-09T11:15:00.000Z")).toBe("45m ago");
    expect(at("2026-03-09T04:00:00.000Z")).toBe("8h ago");
    expect(at("2026-03-06T12:00:00.000Z")).toBe("3d ago");
  });

  it("falls back to an absolute date beyond a week", () => {
    expect(at("2026-01-02T12:00:00.000Z")).toBe("Jan 2, 2026");
  });

  it("returns an empty string rather than a dash, so it can sit inline", () => {
    expect(formatRelative(null)).toBe("");
  });
});

describe("initials", () => {
  it("takes the first letter of the first two words", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("Ada Byron King Lovelace")).toBe("AB");
    expect(initials("cher")).toBe("C");
  });

  it("falls back when there is no name", () => {
    expect(initials(null)).toBe("??");
    expect(initials("")).toBe("??");
  });
});
