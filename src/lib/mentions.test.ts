import { describe, expect, it, vi } from "vitest";
import {
  MAX_MENTIONS,
  allowedMentions,
  encodeMentions,
  extractMentionIds,
  filterMentionCandidates,
  mentionKeyDown,
  mentionLabel,
  mentionQueryAt,
  mentionToken,
  mentionsToPlainText,
  splitMentions,
} from "./mentions";

const ADA = {
  id: "7d6f0c1e-1111-4a2b-8c3d-000000000001",
  full_name: "Ada Lovelace",
  email: "ada@example.com",
};
const ALAN = {
  id: "7d6f0c1e-1111-4a2b-8c3d-000000000002",
  full_name: "Alan Turing",
  email: "alan@example.com",
};
const GRACE = {
  id: "7d6f0c1e-1111-4a2b-8c3d-000000000003",
  full_name: null,
  email: "grace@navy.mil",
};

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("mentionLabel and mentionToken", () => {
  it("prefers the name, then the email's local part", () => {
    expect(mentionLabel(ADA)).toBe("Ada Lovelace");
    expect(mentionLabel(GRACE)).toBe("grace");
    expect(mentionLabel({ id: ADA.id })).toBe("someone");
  });

  it("stores a mention as a token that survives brackets and newlines in a name", () => {
    expect(mentionToken(ADA)).toBe(`@[Ada Lovelace](user:${ADA.id})`);
    expect(mentionToken({ id: ADA.id, full_name: "Ada ]\nL" })).toBe(`@[Ada   L](user:${ADA.id})`);
  });
});

describe("extractMentionIds", () => {
  it("finds plain and rich-text mentions in order, once each, lowercased", () => {
    const text = [
      `<span data-type="mention" data-id="${ALAN.id.toUpperCase()}" data-label="Alan">@Alan</span>`,
      mentionToken(ADA),
      `<span data-id='${ADA.id}' data-type='mention'>@Ada</span>`,
    ].join(" ");
    expect(extractMentionIds(text)).toEqual([ALAN.id, ADA.id]);
  });

  it("ignores anything that is not a mention", () => {
    expect(extractMentionIds(null)).toEqual([]);
    expect(extractMentionIds("mail ada@example.com about @[Ada](user:not-a-uuid)")).toEqual([]);
    expect(extractMentionIds(`<span data-id="${ADA.id}">@Ada</span>`)).toEqual([]);
  });

  it(`stops at ${MAX_MENTIONS} people`, () => {
    const text = Array.from({ length: 30 }, (_, i) => `@[P${i}](user:${uuid(i)})`).join(" ");
    expect(extractMentionIds(text)).toHaveLength(MAX_MENTIONS);
  });
});

describe("splitMentions and mentionsToPlainText", () => {
  const text = `Hi ${mentionToken(ADA)}, see ${mentionToken(ALAN)}`;

  it("cuts text into runs and chips", () => {
    expect(splitMentions(text)).toEqual([
      { type: "text", text: "Hi " },
      { type: "mention", id: ADA.id, label: "Ada Lovelace" },
      { type: "text", text: ", see " },
      { type: "mention", id: ALAN.id, label: "Alan Turing" },
    ]);
    expect(splitMentions("no one")).toEqual([{ type: "text", text: "no one" }]);
  });

  it("reads as @Name in plain text", () => {
    expect(mentionsToPlainText(text)).toBe("Hi @Ada Lovelace, see @Alan Turing");
  });
});

describe("mentionQueryAt", () => {
  it("opens after an @ at the start, after a space or a bracket", () => {
    expect(mentionQueryAt("@ad", 3)).toEqual({ query: "ad", start: 0 });
    expect(mentionQueryAt("hi @", 4)).toEqual({ query: "", start: 3 });
    expect(mentionQueryAt("(@al", 4)).toEqual({ query: "al", start: 1 });
  });

  it("stays closed inside an email address, after a space, or before the caret", () => {
    expect(mentionQueryAt("ada@example", 11)).toBeNull();
    expect(mentionQueryAt("@ada lovelace", 13)).toBeNull();
    expect(mentionQueryAt("@ada and more", 13)).toBeNull();
    expect(mentionQueryAt("@ada and more", 4)).toEqual({ query: "ada", start: 0 });
  });
});

describe("filterMentionCandidates", () => {
  const people = [ALAN, GRACE, ADA];

  it("ranks name starts over email starts over anywhere", () => {
    expect(filterMentionCandidates(people, "lo").map((p) => p.id)).toEqual([ADA.id]);
    expect(filterMentionCandidates(people, "a").map((p) => p.id)).toEqual([
      ADA.id,
      ALAN.id,
      GRACE.id,
    ]);
    expect(filterMentionCandidates(people, "navy").map((p) => p.id)).toEqual([GRACE.id]);
    expect(filterMentionCandidates(people, "zzz")).toEqual([]);
  });

  it("lists everyone alphabetically for an empty query, without the writer, up to the limit", () => {
    expect(filterMentionCandidates(people, "", { excludeId: ALAN.id }).map((p) => p.id)).toEqual([
      ADA.id,
      GRACE.id,
    ]);
    expect(filterMentionCandidates(people, "", { limit: 1 })).toHaveLength(1);
  });
});

describe("encodeMentions", () => {
  it("turns @Name into tokens for the people picked, longest name first", () => {
    const ada = { id: ADA.id, full_name: "Ada" };
    const full = { id: ALAN.id, full_name: "Ada Lovelace" };
    expect(encodeMentions("@Ada Lovelace and @Ada", [ada, full])).toBe(
      `${mentionToken(full)} and ${mentionToken(ada)}`,
    );
  });

  it("leaves names that were deleted, emails and longer words alone", () => {
    expect(encodeMentions("hello", [ADA])).toBe("hello");
    expect(encodeMentions("x@Ada Lovelace", [ADA])).toBe("x@Ada Lovelace");
    expect(encodeMentions("@Ada Lovelaces", [ADA])).toBe("@Ada Lovelaces");
  });

  it("does not encode a token twice", () => {
    const once = encodeMentions("@Ada Lovelace", [ADA]);
    expect(encodeMentions(once, [ADA])).toBe(once);
  });
});

describe("allowedMentions", () => {
  it("keeps only workspace members, once, case-insensitively", () => {
    expect(allowedMentions([ADA.id.toUpperCase(), ADA.id, ALAN.id], [ADA.id])).toEqual([ADA.id]);
    expect(allowedMentions([ALAN.id], [])).toEqual([]);
  });
});

describe("mentionKeyDown", () => {
  const actions = () => ({ move: vi.fn(), pick: vi.fn(), close: vi.fn() });

  it("wraps around with the arrow keys and picks with Enter or Tab", () => {
    const a = actions();
    const state = { open: true, count: 3, active: 2 };
    expect(mentionKeyDown("ArrowDown", state, a)).toBe(true);
    expect(a.move).toHaveBeenLastCalledWith(0);
    expect(mentionKeyDown("ArrowUp", { ...state, active: 0 }, a)).toBe(true);
    expect(a.move).toHaveBeenLastCalledWith(2);
    expect(mentionKeyDown("Enter", state, a)).toBe(true);
    expect(mentionKeyDown("Tab", state, a)).toBe(true);
    expect(a.pick).toHaveBeenCalledTimes(2);
    expect(mentionKeyDown("Escape", state, a)).toBe(true);
    expect(a.close).toHaveBeenCalledOnce();
  });

  it("lets keys through when the picker is closed, empty, or the key is not its own", () => {
    const a = actions();
    expect(mentionKeyDown("Enter", { open: false, count: 3, active: 0 }, a)).toBe(false);
    expect(mentionKeyDown("Enter", { open: true, count: 0, active: 0 }, a)).toBe(false);
    expect(mentionKeyDown("a", { open: true, count: 3, active: 0 }, a)).toBe(false);
    expect(a.pick).not.toHaveBeenCalled();
  });
});
