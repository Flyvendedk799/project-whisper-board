import { describe, expect, it } from "vitest";
import {
  collectTags,
  featuresProgress,
  isValidBranchName,
  isValidColor,
  matchesIdQuery,
  normalizeTag,
  normalizeTags,
  parseColor,
  parseFeatureList,
  questionCounts,
  stepCoverage,
  suggestBranchName,
  workBranchProblem,
  workTargetOf,
} from "./plan-fields";

describe("colours", () => {
  it("accepts design tokens and hex values only", () => {
    expect(isValidColor("var(--chart-2)")).toBe(true);
    expect(isValidColor("#ef4444")).toBe(true);
    expect(isValidColor("#fff")).toBe(true);
    expect(isValidColor("red")).toBe(false);
    expect(isValidColor("url(javascript:alert(1))")).toBe(false);
    expect(isValidColor("#ef4444; background:red")).toBe(false);
    expect(isValidColor(null)).toBe(false);
  });

  it("parseColor clears on null or empty and refuses nonsense", () => {
    expect(parseColor(null)).toBeNull();
    expect(parseColor("")).toBeNull();
    expect(parseColor(" #22c55e ")).toBe("#22c55e");
    expect(parseColor("blue")).toBeUndefined();
    expect(parseColor(5)).toBeUndefined();
  });
});

describe("tags", () => {
  it("normalises to lower-case, hyphenated, without a leading #", () => {
    expect(normalizeTag("#Front End")).toBe("front-end");
    expect(normalizeTag("  Bug!  ")).toBe("bug");
    expect(normalizeTag("###")).toBe("");
    expect(normalizeTag("a".repeat(80))).toHaveLength(32);
  });

  it("dedupes and drops empties", () => {
    expect(normalizeTags(["Bug", "bug", "#bug", "", "UI"])).toEqual(["bug", "ui"]);
    expect(normalizeTags(null)).toEqual([]);
  });

  it("caps how many a thing can carry", () => {
    const many = Array.from({ length: 40 }, (_, i) => `tag${i}`);
    expect(normalizeTags(many)).toHaveLength(20);
  });

  it("collects every tag on a plan, most used first", () => {
    const tags = collectTags({
      sections: [
        { tags: ["backend"], tasks: [{ labels: ["bug", "backend"] }, { labels: ["bug"] }] },
        { tags: [], tasks: [{ labels: ["ui"] }] },
      ],
    });
    expect(tags).toEqual([
      { tag: "backend", count: 2 },
      { tag: "bug", count: 2 },
      { tag: "ui", count: 1 },
    ]);
  });
});

describe("ids", () => {
  const id = "3f2a9c10-aaaa-bbbb-cccc-1234567890ab";
  it("matches the start of an id, from four characters", () => {
    expect(matchesIdQuery(id, "3f2a")).toBe(true);
    expect(matchesIdQuery(id, "T-3f2a9c10")).toBe(true);
    expect(matchesIdQuery(id, "3f2")).toBe(false);
    expect(matchesIdQuery(id, "zzzz")).toBe(false);
    expect(matchesIdQuery(id, "9c10")).toBe(false);
  });
});

describe("parseFeatureList", () => {
  it("turns pasted bullets and numbered lines into features", () => {
    const parsed = parseFeatureList(
      "2.1.1 Must be able to block questions\n- Has to have good security\n* [x] Fast\n3) Accessible\n\n   \n• Works offline",
    );
    expect(parsed.map((p) => p.text)).toEqual([
      "Must be able to block questions",
      "Has to have good security",
      "Fast",
      "Accessible",
      "Works offline",
    ]);
    expect(parsed[2].met).toBe(true);
    expect(parsed[0].met).toBe(false);
  });

  it("keeps a plain line as one feature", () => {
    expect(parseFeatureList("Single line")).toEqual([{ text: "Single line", met: false }]);
  });

  it("ignores blank input", () => {
    expect(parseFeatureList(" \n \n")).toEqual([]);
  });

  it("measures progress", () => {
    expect(featuresProgress([{ met: true }, { met: false }])).toEqual({
      met: 1,
      total: 2,
      percent: 50,
    });
    expect(featuresProgress([]).percent).toBe(0);
  });
});

describe("stepCoverage", () => {
  it("names features without a step and counts loose steps", () => {
    const coverage = stepCoverage(
      [
        { id: "f1", met: false },
        { id: "f2", met: false },
        { id: "f3", met: true },
      ],
      [{ feature_id: "f1" }, { feature_id: null }, {}],
    );
    expect(coverage.covered).toBe(1);
    expect(coverage.uncovered).toEqual(["f2"]);
    expect(coverage.loose).toBe(2);
  });
});

describe("questions", () => {
  it("counts open and blocking", () => {
    expect(
      questionCounts([
        { status: "open", blocking: true },
        { status: "open", blocking: false },
        { status: "answered", blocking: true },
        { status: "dismissed", blocking: false },
      ]),
    ).toEqual({ open: 2, blocking: 1 });
    expect(questionCounts(undefined)).toEqual({ open: 0, blocking: 0 });
  });
});

describe("branches", () => {
  it("accepts ordinary branch names and refuses git's forbidden shapes", () => {
    for (const ok of ["main", "feat/x", "plan/q4-launch", "release-1.2"]) {
      expect(isValidBranchName(ok), ok).toBe(true);
    }
    for (const bad of [
      "",
      "has space",
      "a..b",
      "-lead",
      "/lead",
      "trail/",
      "x.lock",
      "a//b",
      "a~b",
      "a:b",
      "a@{b",
    ]) {
      expect(isValidBranchName(bad), bad).toBe(false);
    }
  });

  it("suggests a branch from a title", () => {
    expect(suggestBranchName("Q4 Launch: payments!")).toBe("plan/q4-launch-payments");
    expect(suggestBranchName("???")).toBe("plan/work");
  });

  it("describes where the work happens", () => {
    expect(workTargetOf({}).summary).toBe("No repository connected.");
    expect(
      workTargetOf({ github_repo: "a/b", github_base: "main", github_work_mode: "base" }),
    ).toMatchObject({ workOn: "main", branch: null });
    expect(
      workTargetOf({
        github_repo: "a/b",
        github_base: "main",
        github_work_mode: "new",
        github_work_branch: "plan/x",
      }),
    ).toMatchObject({ workOn: "plan/x", mode: "new" });
    expect(workTargetOf({ github_repo: "a/b", github_base: "main" }).workOn).toBeNull();
  });

  it("explains why a work branch cannot be saved", () => {
    expect(workBranchProblem(null, "", "main")).toBeNull();
    expect(workBranchProblem("base", "", "main")).toBeNull();
    expect(workBranchProblem("new", "", "main")).toBe("Name the branch.");
    expect(workBranchProblem("new", "bad name", "main")).toMatch(/not a valid branch name/);
    expect(workBranchProblem("new", "main", "main")).toMatch(/different name/);
    expect(workBranchProblem("existing", "main", "main")).toBeNull();
    expect(workBranchProblem("new", "plan/x", "main")).toBeNull();
  });
});
