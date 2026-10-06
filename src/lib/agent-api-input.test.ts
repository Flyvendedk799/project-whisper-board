import { describe, expect, it } from "vitest";
import {
  clampStepDepths,
  isUuid,
  optionalUuid,
  parseAnswerInput,
  parseBlockInput,
  parseFeaturesInput,
  parseFeatureUpdate,
  parseProgressInput,
  parseQuestionFilter,
  parseQuestionInput,
  parseSectionCreate,
  parseSectionUpdate,
  parseStepLines,
  parseStepPatch,
  parseStepsInput,
  mergePlanUpdate,
  parsePlanUpdate,
  parseTaskCreate,
  parseTaskUpdate,
  parseWorkTarget,
} from "./agent-api-input";
import { AppError } from "./errors";

const ID = "3f2b8c1e-5d4a-4c6b-9e1f-0a1b2c3d4e5f";
const ID2 = "9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";

const problem = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return (error as AppError).message;
  }
  throw new Error("expected a validation error");
};

describe("ids", () => {
  it("accepts uuids and nothing else", () => {
    expect(isUuid(ID)).toBe(true);
    expect(isUuid("t-1234")).toBe(false);
    expect(optionalUuid(undefined, "x")).toBeNull();
    expect(optionalUuid("", "x")).toBeNull();
    expect(optionalUuid(ID, "x")).toBe(ID);
    expect(problem(() => optionalUuid("nope", "`agent_id`"))).toMatch(/agent_id/);
  });
});

describe("parseWorkTarget", () => {
  it("is empty when nothing is chosen", () => {
    expect(parseWorkTarget({}, "main")).toEqual({
      github_work_mode: null,
      github_work_branch: null,
    });
  });

  it("keeps a branch for new and existing, drops it for base", () => {
    expect(
      parseWorkTarget({ github_work_mode: "new", github_work_branch: " plan/q4 " }, "main"),
    ).toEqual({ github_work_mode: "new", github_work_branch: "plan/q4" });
    expect(
      parseWorkTarget({ github_work_mode: "base", github_work_branch: "ignored" }, "main"),
    ).toEqual({ github_work_mode: "base", github_work_branch: null });
  });

  it("refuses an unknown mode, a missing or bad branch, and a new branch named like the base", () => {
    expect(problem(() => parseWorkTarget({ github_work_mode: "fork" }, null))).toMatch(
      /github_work_mode/,
    );
    expect(problem(() => parseWorkTarget({ github_work_mode: "new" }, null))).toMatch(
      /Name the branch/,
    );
    expect(
      problem(() => parseWorkTarget({ github_work_mode: "new", github_work_branch: "a b" }, null)),
    ).toMatch(/not a valid branch/);
    expect(
      problem(() =>
        parseWorkTarget({ github_work_mode: "new", github_work_branch: "main" }, "main"),
      ),
    ).toMatch(/different name/);
    expect(problem(() => parseWorkTarget({ github_work_branch: "x" }, null))).toMatch(
      /needs a `github_work_mode`/,
    );
  });
});

describe("parsePlanUpdate / mergePlanUpdate", () => {
  const empty = {
    github_repo: null,
    github_base: null,
    github_work_mode: null,
    github_work_branch: null,
  };

  it("updates description freely", () => {
    expect(parsePlanUpdate({ description: " Blueprint " })).toEqual({ description: "Blueprint" });
    expect(mergePlanUpdate(empty, { description: "Blueprint" })).toEqual({
      description: "Blueprint",
    });
    expect(mergePlanUpdate(empty, { description: null })).toEqual({ description: null });
  });

  it("fills github_repo only when missing", () => {
    expect(parsePlanUpdate({ github_repo: "Acme/App" })).toEqual({ github_repo: "Acme/App" });
    expect(mergePlanUpdate(empty, { github_repo: "Acme/App" })).toEqual({
      github_repo: "Acme/App",
    });
    expect(
      problem(() =>
        mergePlanUpdate({ ...empty, github_repo: "acme/app" }, { github_repo: "Acme/App" }),
      ),
    ).toMatch(/already set/);
    // Same value is a no-op for that field; with nothing else it is "nothing to change".
    expect(
      problem(() =>
        mergePlanUpdate({ ...empty, github_repo: "Acme/App" }, { github_repo: "Acme/App" }),
      ),
    ).toMatch(/Nothing to change/);
  });

  it("fills work_target when mode is missing", () => {
    expect(
      mergePlanUpdate(
        { ...empty, github_base: "main" },
        { github_work_mode: "new", github_work_branch: "feat/x" },
      ),
    ).toEqual({ github_work_mode: "new", github_work_branch: "feat/x" });
    expect(
      problem(() =>
        mergePlanUpdate(
          { ...empty, github_work_mode: "base", github_base: "main" },
          { github_work_mode: "new", github_work_branch: "feat/x" },
        ),
      ),
    ).toMatch(/already set/);
  });

  it("refuses an empty body and a bad repo", () => {
    expect(problem(() => parsePlanUpdate({}))).toMatch(/at least one/);
    expect(problem(() => parsePlanUpdate({ github_repo: "not-a-repo" }))).toMatch(/owner\/name/);
  });
});

describe("sections", () => {
  it("normalises tags and checks the colour", () => {
    const section = parseSectionCreate({
      title: " Auth ",
      goals: "Ship login",
      tags: ["Front End", "#api", "api"],
      color: "#3b82f6",
    });
    expect(section).toEqual({
      title: "Auth",
      goals: "Ship login",
      tags: ["front-end", "api"],
      color: "#3b82f6",
    });
    expect(problem(() => parseSectionCreate({ title: "x", color: "blue" }))).toMatch(/hex value/);
    expect(parseSectionCreate({ title: "x", color: "var(--chart-2)" }).color).toBe(
      "var(--chart-2)",
    );
  });

  it("needs a title to create and something to change on update", () => {
    expect(problem(() => parseSectionCreate({ goals: "x" }))).toMatch(/title/);
    expect(problem(() => parseSectionUpdate({}))).toMatch(/at least one/);
    expect(parseSectionUpdate({ color: null, goals: "" })).toEqual({ color: null, goals: null });
  });

  it("holds titles and text to the lengths the screen allows", () => {
    expect(problem(() => parseSectionCreate({ title: "x".repeat(101) }))).toMatch(/100/);
    expect(problem(() => parseSectionUpdate({ goals: "x".repeat(5001) }))).toMatch(/5000/);
  });
});

describe("tasks", () => {
  const base = { section_id: ID, title: "Build login" };

  it("creates with defaults, tags, colour, features and criteria", () => {
    const task = parseTaskCreate({
      ...base,
      priority: "high",
      complexity: "small",
      tags: ["Auth", "auth", "Back End"],
      color: "#22c55e",
      features: ["Sign in", " ", "Sign out"],
      acceptance_criteria: "Works on mobile\nHas tests",
      depends_on: [ID2, ID2],
    });
    expect(task.sectionId).toBe(ID);
    expect(task.status).toBe("available");
    expect(task.features).toEqual(["Sign in", "Sign out"]);
    expect(task.dependsOn).toEqual([ID2]);
    expect(task.fields).toMatchObject({
      title: "Build login",
      priority: "high",
      complexity: "small",
      labels: ["auth", "back-end"],
      color: "#22c55e",
      acceptance_criteria: "Works on mobile\nHas tests",
    });
  });

  it("accepts labels as an alias for tags and a comma string", () => {
    expect(parseTaskCreate({ ...base, labels: ["A"] }).fields.labels).toEqual(["a"]);
    expect(parseTaskCreate({ ...base, tags: "one, two" }).fields.labels).toEqual(["one", "two"]);
  });

  it("refuses what the screen would", () => {
    expect(problem(() => parseTaskCreate({ section_id: ID }))).toMatch(/title/);
    expect(problem(() => parseTaskCreate({ title: "x" }))).toMatch(/section_id/);
    expect(problem(() => parseTaskCreate({ ...base, priority: "urgent" }))).toMatch(/priority/);
    expect(problem(() => parseTaskCreate({ ...base, complexity: "huge" }))).toMatch(/complexity/);
    expect(problem(() => parseTaskCreate({ ...base, color: "#zzz" }))).toMatch(/hex value/);
    expect(problem(() => parseTaskCreate({ ...base, status: "done" }))).toMatch(
      /backlog, available/,
    );
    expect(problem(() => parseTaskCreate({ ...base, depends_on: ["x"] }))).toMatch(/depends_on/);
    expect(problem(() => parseTaskCreate({ ...base, tags: [1] }))).toMatch(/tags/);
    expect(problem(() => parseTaskCreate({ ...base, title: "x".repeat(201) }))).toMatch(/200/);
  });

  it("updates only what is sent and can clear colour and complexity", () => {
    expect(parseTaskUpdate({ color: null, complexity: null, branch_name: "feat/login" })).toEqual({
      color: null,
      complexity: null,
      branch_name: "feat/login",
    });
    expect(parseTaskUpdate({ acceptance_criteria: [] })).toEqual({ acceptance_criteria: null });
    expect(problem(() => parseTaskUpdate({}))).toMatch(/at least one/);
    expect(problem(() => parseTaskUpdate({ branch_name: "bad branch" }))).toMatch(/valid branch/);
  });
});

describe("questions", () => {
  it("parses a question, defaulting to non-blocking", () => {
    expect(parseQuestionInput({ body: " Which provider? " })).toEqual({
      body: "Which provider?",
      blocking: false,
      agentId: null,
    });
    expect(parseQuestionInput({ body: "x", blocking: true, agent_id: ID }).blocking).toBe(true);
    expect(parseQuestionInput({ body: "x", blocking: "yes" }).blocking).toBe(false);
  });

  it("refuses an empty or oversized question and a bad agent id", () => {
    expect(problem(() => parseQuestionInput({ body: "  " }))).toMatch(/required/);
    expect(problem(() => parseQuestionInput({ body: "x".repeat(2001) }))).toMatch(/2000/);
    expect(problem(() => parseQuestionInput({ body: "x", agent_id: "me" }))).toMatch(/agent_id/);
  });

  it("parses answers and filters", () => {
    expect(parseAnswerInput({ answer: "Use Supabase", agent_id: ID })).toEqual({
      answer: "Use Supabase",
      agentId: ID,
    });
    expect(problem(() => parseAnswerInput({}))).toMatch(/answer/);
    expect(parseQuestionFilter(null, "open")).toBe("open");
    expect(parseQuestionFilter("all", "open")).toBe("all");
    expect(problem(() => parseQuestionFilter("closed", "open"))).toMatch(/status/);
  });

  it("turns a block reason into a bounded question", () => {
    expect(parseBlockInput({ reason: "  Need the API key  " }).reason).toBe("Need the API key");
    expect(parseBlockInput({}).reason).toBeNull();
    expect(parseBlockInput({ reason: "x".repeat(3000) }).reason).toHaveLength(2000);
  });
});

describe("features", () => {
  it("reads items and pasted bullet lists", () => {
    const { features } = parseFeaturesInput({
      text: "- Sign in\n2. Sign out\n[x] Remember me",
      items: ["Reset password"],
    });
    expect(features).toEqual([
      { text: "Sign in", met: false },
      { text: "Sign out", met: false },
      { text: "Remember me", met: true },
      { text: "Reset password", met: false },
    ]);
  });

  it("needs at least one and refuses a flood", () => {
    expect(problem(() => parseFeaturesInput({ text: "  \n " }))).toMatch(/at least one/);
    expect(problem(() => parseFeaturesInput({ items: [1] }))).toMatch(/items/);
    const many = Array.from({ length: 51 }, (_, i) => `feature ${i}`);
    expect(problem(() => parseFeaturesInput({ items: many }))).toMatch(/At most 50/);
  });

  it("updates met and text", () => {
    expect(parseFeatureUpdate({ met: true })).toEqual({ met: true });
    expect(parseFeatureUpdate({ text: "  new   words " })).toEqual({ text: "new words" });
    expect(problem(() => parseFeatureUpdate({ met: "true" }))).toMatch(/true or false/);
    expect(problem(() => parseFeatureUpdate({}))).toMatch(/met/);
  });
});

describe("steps", () => {
  it("splits lines, strips markers and reads indentation as depth", () => {
    expect(parseStepLines("- one\n  2. two\n    [x] three\n\n[ ] four")).toEqual([
      { text: "one", depth: 0, done: false },
      { text: "two", depth: 1, done: false },
      { text: "three", depth: 2, done: true },
      { text: "four", depth: 0, done: false },
    ]);
  });

  it("never lets a step jump more than one level", () => {
    const lines = parseStepLines("a\n      b\n  c");
    expect(clampStepDepths(lines, -1).map((line) => line.depth)).toEqual([0, 1, 1]);
    expect(clampStepDepths([{ text: "x", depth: 3, done: false }], 0)[0].depth).toBe(1);
  });

  it("takes text, items and a feature id", () => {
    const input = parseStepsInput({
      text: "write test\nwrite code",
      items: ["review", { text: "ship", depth: 1, done: true }],
      feature_id: ID,
    });
    expect(input.featureId).toBe(ID);
    expect(input.lines.map((line) => line.text)).toEqual([
      "write test",
      "write code",
      "review",
      "ship",
    ]);
    expect(input.lines[3]).toMatchObject({ depth: 1, done: true });
  });

  it("keeps the single-step form: text with depth and done", () => {
    const input = parseStepsInput({ text: "only", depth: 2, done: true });
    expect(input.lines).toEqual([{ text: "only", depth: 2, done: true }]);
  });

  it("refuses nothing to add, bad items and bad feature ids", () => {
    expect(problem(() => parseStepsInput({}))).toMatch(/at least one step/);
    expect(problem(() => parseStepsInput({ items: [3] }))).toMatch(/Each item/);
    expect(problem(() => parseStepsInput({ text: "a", feature_id: "f1" }))).toMatch(/feature_id/);
    expect(problem(() => parseStepsInput({ text: Array(101).fill("a").join("\n") }))).toMatch(
      /At most 100/,
    );
  });

  it("patches done, text and feature link (null unlinks)", () => {
    expect(parseStepPatch({ done: true })).toEqual({ done: true });
    expect(parseStepPatch({ feature_id: null })).toEqual({ feature_id: null });
    expect(parseStepPatch({ text: " a   b " })).toEqual({ text: "a b" });
    expect(problem(() => parseStepPatch({}))).toMatch(/done/);
    expect(problem(() => parseStepPatch({ done: "yes" }))).toMatch(/true or false/);
  });
});

describe("progress", () => {
  it("takes status, ticks and a note", () => {
    expect(
      parseProgressInput({
        agent_id: ID,
        status: "in_progress",
        steps_done: [ID, ID2, ID],
        features_met: [ID2],
        note: "  Chose Supabase auth  ",
      }),
    ).toEqual({
      agentId: ID,
      status: "in_progress",
      note: "Chose Supabase auth",
      stepsDone: [ID, ID2],
      featuresMet: [ID2],
    });
  });

  it("treats an empty note as no note, so no comment is posted", () => {
    const input = parseProgressInput({ status: "in_review", note: "   " });
    expect(input.note).toBeNull();
    expect(parseProgressInput({ steps_done: [ID], note: null }).note).toBeNull();
  });

  it("needs something to do", () => {
    expect(problem(() => parseProgressInput({}))).toMatch(/at least one/);
    expect(problem(() => parseProgressInput({ note: " " }))).toMatch(/at least one/);
  });

  it("sends blocking through a question, not a status", () => {
    expect(problem(() => parseProgressInput({ status: "blocked" }))).toMatch(/question/);
    expect(problem(() => parseProgressInput({ status: "available" }))).toMatch(/status/);
  });

  it("refuses ids that are not ids and notes that are too long", () => {
    expect(problem(() => parseProgressInput({ steps_done: ["one"] }))).toMatch(/steps_done/);
    expect(problem(() => parseProgressInput({ features_met: "x" }))).toMatch(/features_met/);
    expect(problem(() => parseProgressInput({ note: "x".repeat(5001) }))).toMatch(/5000/);
  });
});
