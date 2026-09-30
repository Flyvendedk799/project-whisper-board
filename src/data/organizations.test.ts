import { describe, expect, it } from "vitest";
import { milestoneInvoiceDraft, parseMoneyToCents } from "./billing";
import { peopleByOrganization } from "./projects";

describe("peopleByOrganization", () => {
  const people = [
    { user_id: "a", name: "Ada" },
    { user_id: "b", name: "Bo" },
  ];

  it("groups people under their company", () => {
    const grouped = peopleByOrganization(
      [
        { organization_id: "o1", user_id: "a" },
        { organization_id: "o1", user_id: "b" },
        { organization_id: "o2", user_id: "b" },
      ],
      people,
    );
    expect(grouped.get("o1")?.map((p) => p.name)).toEqual(["Ada", "Bo"]);
    expect(grouped.get("o2")?.map((p) => p.name)).toEqual(["Bo"]);
  });

  it("drops people who are no longer in the workspace", () => {
    const grouped = peopleByOrganization([{ organization_id: "o1", user_id: "gone" }], people);
    expect(grouped.size).toBe(0);
  });
});

describe("parseMoneyToCents", () => {
  it("reads plain, comma and spaced amounts", () => {
    expect(parseMoneyToCents("25000")).toBe(2_500_000);
    expect(parseMoneyToCents("1 250,50")).toBe(125_050);
    expect(parseMoneyToCents("9.5")).toBe(950);
  });

  it("rejects empty, negative and text", () => {
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("-5")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("1.234")).toBeNull();
  });
});

describe("milestoneInvoiceDraft", () => {
  it("drafts one line for the agreed amount", () => {
    expect(
      milestoneInvoiceDraft({ title: "Checkout live", amount_cents: 4_200_000 }, "dkk"),
    ).toEqual({
      description: "Checkout live",
      amountCents: 4_200_000,
      currency: "DKK",
    });
  });

  it("never drafts a negative or missing amount", () => {
    expect(milestoneInvoiceDraft({ title: "x", amount_cents: null }, "").amountCents).toBe(0);
    expect(milestoneInvoiceDraft({ title: "x", amount_cents: -5 }, "usd").amountCents).toBe(0);
    expect(milestoneInvoiceDraft({ title: "x", amount_cents: 1 }, "").currency).toBe("USD");
  });
});
