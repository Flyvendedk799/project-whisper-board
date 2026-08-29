import { describe, expect, it } from "vitest";
import {
  AppError,
  DataError,
  describeError,
  fingerprint,
  isRetryable,
  toUserMessage,
} from "./errors";

const GENERIC = "Something went wrong. Please try again.";

describe("toUserMessage", () => {
  it("shows AppError messages verbatim, because we wrote them", () => {
    expect(toUserMessage(new AppError("ai_parse", "The AI couldn't read that capture."))).toBe(
      "The AI couldn't read that capture.",
    );
  });

  it("never leaks a raw Postgres message", () => {
    const rls = new DataError("quotes.update", {
      message: 'new row violates row-level security policy for table "quotes"',
      code: "42501",
    });
    expect(toUserMessage(rls)).toBe("You don't have access to that.");
    expect(toUserMessage(rls)).not.toContain("row-level security");
  });

  it("maps a named constraint to something specific", () => {
    const timer = new DataError("time_entries.insert", {
      message: 'duplicate key value violates unique constraint "one_running_timer_per_user"',
      code: "23505",
    });
    expect(toUserMessage(timer)).toBe("You already have a timer running. Stop it first.");
  });

  it("falls back to the generic code message when the constraint is unknown", () => {
    const dup = new DataError("x.insert", {
      message: 'duplicate key value violates unique constraint "something_else_key"',
      code: "23505",
    });
    expect(toUserMessage(dup)).toBe("That already exists.");
  });

  it("handles bare Postgrest objects, which are not Error instances", () => {
    expect(toUserMessage({ message: "no rows", code: "PGRST116" })).toBe("We couldn't find that.");
  });

  it("recognises the auth middleware's rejection", () => {
    expect(toUserMessage(new Error("Unauthorized: Invalid token"))).toBe("Please sign in again.");
  });

  it("recognises a dead connection", () => {
    expect(toUserMessage(new TypeError("Failed to fetch"))).toBe(
      "Couldn't reach the server. Check your connection.",
    );
  });

  it("falls back for anything it does not recognise, including non-errors", () => {
    expect(toUserMessage(new Error("kaboom at line 4 of internal.ts"))).toBe(GENERIC);
    expect(toUserMessage(undefined)).toBe(GENERIC);
    expect(toUserMessage("a string")).toBe(GENERIC);
    expect(toUserMessage({ nope: true })).toBe(GENERIC);
  });

  it("accepts a caller-supplied fallback", () => {
    expect(toUserMessage(new Error("boom"), "Could not summarize this thread.")).toBe(
      "Could not summarize this thread.",
    );
  });
});

describe("isRetryable", () => {
  it("does not retry permission, validation or not-found failures", () => {
    expect(isRetryable(new DataError("op", { message: "denied", code: "42501" }))).toBe(false);
    expect(isRetryable(new DataError("op", { message: "dupe", code: "23505" }))).toBe(false);
    expect(isRetryable({ message: "no rows", code: "PGRST116" })).toBe(false);
    expect(isRetryable(new Error("Unauthorized: Invalid token"))).toBe(false);
    expect(isRetryable(new AppError("bad_input", "Pick a project first."))).toBe(false);
  });

  it("does retry timeouts, contention and genuine server faults", () => {
    expect(isRetryable(new DataError("op", { message: "timeout", code: "57014" }))).toBe(true);
    expect(isRetryable(new DataError("op", { message: "deadlock", code: "40P01" }))).toBe(true);
    expect(isRetryable(new AppError("internal", "…", { status: 500 }))).toBe(true);
    expect(isRetryable(new TypeError("Failed to fetch"))).toBe(true);
  });
});

describe("fingerprint", () => {
  it("groups the same failure across different ids and counts", () => {
    const a = new Error("ticket 550e8400-e29b-41d4-a716-446655440000 not found");
    const b = new Error("ticket 6ba7b810-9dad-11d1-80b4-00c04fd430c8 not found");
    expect(fingerprint(a)).toBe(fingerprint(b));

    expect(fingerprint(new Error("3 of 12 uploads failed"))).toBe(
      fingerprint(new Error("7 of 40 uploads failed")),
    );
  });

  it("keeps genuinely different failures apart", () => {
    expect(fingerprint(new Error("upload failed"))).not.toBe(
      fingerprint(new Error("parse failed")),
    );
    expect(fingerprint(new DataError("tickets.list", { message: "x", code: "42501" }))).not.toBe(
      fingerprint(new DataError("tickets.insert", { message: "x", code: "42501" })),
    );
  });

  it("scopes by where it happened", () => {
    const e = new AppError("ai_parse", "…");
    expect(fingerprint(e, "server-fn")).not.toBe(fingerprint(e, "query"));
  });
});

describe("describeError", () => {
  it("keeps the Postgres detail the user never sees", () => {
    const e = new DataError("tickets.update", {
      message: "denied",
      code: "42501",
      details: "Key (id)=(1) is not present",
      hint: "check the policy",
    });
    expect(describeError(e).extra).toMatchObject({
      op: "tickets.update",
      pgCode: "42501",
      details: "Key (id)=(1) is not present",
      hint: "check the policy",
    });
  });

  it("carries AppError context through", () => {
    expect(
      describeError(new AppError("upload", "…", { context: { file: "a.png" } })).extra,
    ).toMatchObject({ code: "upload", file: "a.png" });
  });
});
