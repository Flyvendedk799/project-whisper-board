import { describe, expect, it } from "vitest";
import { billingCsvRows, isoWeekNumber, rowsToCsv } from "./reports";

describe("rowsToCsv", () => {
  it("returns nothing for no rows", () => {
    expect(rowsToCsv([])).toBe("");
  });

  it("quotes commas and quotes, and neutralises formulas", () => {
    const csv = rowsToCsv([{ name: 'A, "B"', note: "=SUM(A1)" }]);
    expect(csv).toBe(`name,note\n"A, ""B""",'=SUM(A1)`);
  });

  it("writes null as an empty cell", () => {
    expect(rowsToCsv([{ a: null, b: 1 }])).toBe("a,b\n,1");
  });
});

describe("isoWeekNumber", () => {
  it("matches ISO weeks around the year boundary", () => {
    expect(isoWeekNumber("2026-01-01")).toBe(1);
    expect(isoWeekNumber("2026-09-28")).toBe(40);
    expect(isoWeekNumber("2021-01-03")).toBe(53);
  });
});

describe("billingCsvRows", () => {
  it("converts cents to major units per currency", () => {
    const rows = billingCsvRows([
      {
        currency: "DKK",
        outstandingCents: 5_100_000,
        paidThisMonthCents: 1_800_000,
        aging: { current: 2_100_000, d30: 3_000_000, d60: 0, older: 0 },
      },
    ]);
    expect(rows[0]).toMatchObject({
      currency: "DKK",
      outstanding: "51000.00",
      days_1_30: "30000.00",
    });
  });
});
