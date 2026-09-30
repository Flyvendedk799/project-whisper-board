import { describe, expect, it } from "vitest";
import { formatGap, slaLabel, slaState } from "./sla-state";

const NOW = Date.parse("2026-09-30T12:00:00Z");
const at = (ms: number) => new Date(NOW + ms).toISOString();
const H = 3_600_000;

describe("slaState", () => {
  it("is closed for finished tickets and none without a due date", () => {
    expect(slaState(at(-H), "done", NOW)).toBe("closed");
    expect(slaState(null, "open", NOW)).toBe("none");
  });

  it("separates breached, at risk and ok around the 24 hour window", () => {
    expect(slaState(at(-H), "open", NOW)).toBe("breached");
    expect(slaState(at(4 * H), "open", NOW)).toBe("at_risk");
    expect(slaState(at(30 * H), "open", NOW)).toBe("ok");
  });
});

describe("formatGap", () => {
  it("rounds to the largest sensible unit", () => {
    expect(formatGap(30_000)).toBe("1m");
    expect(formatGap(12 * 60_000)).toBe("12m");
    expect(formatGap(-2 * H)).toBe("2h");
    expect(formatGap(47 * H)).toBe("47h");
    expect(formatGap(72 * H)).toBe("3d");
  });
});

describe("slaLabel", () => {
  it("words overdue and upcoming tickets the way the design does", () => {
    expect(slaLabel(at(-2 * H), "open", NOW)).toEqual({ state: "breached", text: "Overdue 2h" });
    expect(slaLabel(at(4 * H), "open", NOW)).toEqual({ state: "at_risk", text: "Due in 4h" });
  });

  it("says nothing for a comfortable deadline unless asked", () => {
    expect(slaLabel(at(72 * H), "open", NOW)).toBeNull();
    expect(slaLabel(at(72 * H), "open", NOW, true)).toEqual({ state: "ok", text: "On track" });
  });

  it("says nothing for closed tickets", () => {
    expect(slaLabel(at(-H), "done", NOW, true)).toBeNull();
  });
});
