import { describe, expect, it } from "vitest";
import {
  hasLivePullRequest,
  isOrphanPullRequestRef,
  isOrphanTicketRef,
  scrubCommentIfUnlinked,
  scrubStalePlanRefs,
} from "./plan-refs";

describe("isOrphanTicketRef", () => {
  it("is true when ticket_id has no joined ticket", () => {
    expect(isOrphanTicketRef({ ticket_id: "abc", ticket: null })).toBe(true);
    expect(isOrphanTicketRef({ ticket_id: "abc", ticket: undefined })).toBe(true);
  });

  it("is false when linked or unset", () => {
    expect(isOrphanTicketRef({ ticket_id: "abc", ticket: { id: "abc" } })).toBe(false);
    expect(isOrphanTicketRef({ ticket_id: null, ticket: null })).toBe(false);
    expect(isOrphanTicketRef({})).toBe(false);
  });
});

describe("pull request liveness", () => {
  it("requires a URL for a live PR", () => {
    expect(hasLivePullRequest({ pr_number: 13, pr_url: null })).toBe(false);
    expect(hasLivePullRequest({ pr_number: 13, pr_url: "https://github.com/o/r/pull/13" })).toBe(
      true,
    );
  });

  it("flags number-without-url as orphan", () => {
    expect(isOrphanPullRequestRef({ pr_number: 13, pr_url: null })).toBe(true);
    expect(
      isOrphanPullRequestRef({ pr_number: 13, pr_url: "https://github.com/o/r/pull/13" }),
    ).toBe(false);
  });
});

describe("scrubStalePlanRefs", () => {
  it("removes ticket and PR citations", () => {
    expect(scrubStalePlanRefs("Resolves ticket #1.")).toBe("");
    expect(scrubStalePlanRefs("See PR #13")).toBe("See");
    expect(scrubStalePlanRefs("From ticket #1 (feature).\n\nShip it.")).toBe("Ship it.");
  });

  it("leaves unrelated text alone", () => {
    expect(scrubStalePlanRefs("No links here.")).toBe("No links here.");
  });
});

describe("scrubCommentIfUnlinked", () => {
  it("scrubs when there is no live ticket or PR", () => {
    expect(
      scrubCommentIfUnlinked("Resolves ticket #1. PR #13 merged.", {
        ticket_id: "gone",
        ticket: null,
        pr_url: null,
      }),
    ).toBe("merged.");
  });

  it("keeps citations when a ticket is linked", () => {
    const body = "Closes ticket #4.";
    expect(
      scrubCommentIfUnlinked(body, {
        ticket_id: "t",
        ticket: { id: "t" },
        pr_url: null,
      }),
    ).toBe(body);
  });
});
