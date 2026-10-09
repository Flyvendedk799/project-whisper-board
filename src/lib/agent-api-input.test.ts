import { describe, expect, it } from "vitest";
import {
  clampStepDepths,
  isUuid,
  optionalUuid,
  parseAnswerInput,
  parseAudienceFilter,
  parseAudienceInput,
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
  resolveClientBody,
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

  it("accepts a trimmed client summary and lets update clear it", () => {
    expect(
      parseSectionCreate({ title: "x", client_summary: "  Vi har bygget loginsiden.  " }),
    ).toEqual({ title: "x", client_summary: "Vi har bygget loginsiden." });
    expect(parseSectionUpdate({ client_summary: "Næste skridt er test." })).toEqual({
      client_summary: "Næste skridt er test.",
    });
    expect(parseSectionUpdate({ client_summary: "" })).toEqual({ client_summary: null });
    expect(parseSectionUpdate({ client_summary: null })).toEqual({ client_summary: null });
    expect(problem(() => parseSectionUpdate({ client_summary: 5 }))).toMatch(/must be text/);
    expect(problem(() => parseSectionUpdate({ client_summary: "x".repeat(2001) }))).toMatch(/2000/);
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
    expect(task.features).toEqual([{ text: "Sign in" }, { text: "Sign out" }]);
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

  it("takes a client title and summary, trims them and clears them with an empty string", () => {
    expect(
      parseTaskCreate({
        ...base,
        client_title: "  Shader-forbedringer ",
        client_summary: "  Spillet kører jævnere.  ",
      }).fields,
    ).toMatchObject({
      client_title: "Shader-forbedringer",
      client_summary: "Spillet kører jævnere.",
    });
    expect(parseTaskUpdate({ client_title: "Tryggere login" })).toEqual({
      client_title: "Tryggere login",
    });
    expect(parseTaskUpdate({ client_title: "", client_summary: null })).toEqual({
      client_title: null,
      client_summary: null,
    });
    expect(problem(() => parseTaskUpdate({ client_title: 5 }))).toMatch(/must be text/);
    expect(problem(() => parseTaskUpdate({ client_title: "x".repeat(201) }))).toMatch(/200/);
    expect(problem(() => parseTaskUpdate({ client_summary: "x".repeat(1001) }))).toMatch(/1000/);
  });
});

describe("task features with client text", () => {
  const base = { section_id: ID, title: "Build login" };

  it("takes texts and { text, client_text } entries", () => {
    const task = parseTaskCreate({
      ...base,
      features: [
        "Sign in",
        { text: " Sign out ", client_text: "  Man kan logge ud  " },
        { text: "Remember me", client_text: "" },
        { text: "  " },
      ],
    });
    expect(task.features).toEqual([
      { text: "Sign in" },
      { text: "Sign out", clientText: "Man kan logge ud" },
      { text: "Remember me" },
    ]);
  });

  it("refuses a feature entry that is neither, and a client text over 300", () => {
    expect(problem(() => parseTaskCreate({ ...base, features: [5] }))).toMatch(/features/);
    expect(
      problem(() =>
        parseTaskCreate({ ...base, features: [{ text: "x", client_text: "x".repeat(301) }] }),
      ),
    ).toMatch(/300/);
  });
});

describe("questions", () => {
  it("parses a question, defaulting to non-blocking and to the agency", () => {
    expect(parseQuestionInput({ body: " Which provider? " })).toEqual({
      body: "Which provider?",
      blocking: false,
      agentId: null,
      audience: "agency",
      clientBody: null,
    });
    expect(parseQuestionInput({ body: "x", blocking: true, agent_id: ID }).blocking).toBe(true);
    expect(parseQuestionInput({ body: "x", blocking: "yes" }).blocking).toBe(false);
  });

  it("refuses an empty or oversized question and a bad agent id", () => {
    expect(problem(() => parseQuestionInput({ body: "  " }))).toMatch(/required/);
    expect(problem(() => parseQuestionInput({ body: "x".repeat(2001) }))).toMatch(/2000/);
    expect(problem(() => parseQuestionInput({ body: "x", agent_id: "me" }))).toMatch(/agent_id/);
  });

  it("aims a question at the agent or the client", () => {
    expect(parseQuestionInput({ body: "x", audience: "agent" })).toMatchObject({
      audience: "agent",
      clientBody: null,
    });
    expect(parseQuestionInput({ body: "x", audience: null }).audience).toBe("agency");
    expect(
      parseQuestionInput({
        body: "x",
        audience: "client",
        client_body: "  Hvilken farve vil du have?  ",
      }),
    ).toMatchObject({ audience: "client", clientBody: "Hvilken farve vil du have?" });
    // A wording sent for another audience is kept, so the question can be sent on later.
    expect(
      parseQuestionInput({ body: "x", audience: "agency", client_body: "Hej" }).clientBody,
    ).toBe("Hej");
  });

  it("refuses an unknown audience", () => {
    expect(problem(() => parseQuestionInput({ body: "x", audience: "everyone" }))).toMatch(
      /audience.*agency, agent, client/,
    );
    expect(problem(() => parseQuestionInput({ body: "x", audience: 3 }))).toMatch(/audience/);
  });

  it("needs a Danish client_body to ask the client", () => {
    for (const client_body of [undefined, "", "   ", null]) {
      expect(
        problem(() => parseQuestionInput({ body: "x", audience: "client", client_body })),
      ).toMatch(/client_body.*Danish/);
    }
    expect(
      problem(() =>
        parseQuestionInput({ body: "x", audience: "client", client_body: "y".repeat(2001) }),
      ),
    ).toMatch(/2000/);
  });

  it("re-aims a question: a client wording is required unless it already has one", () => {
    expect(parseAudienceInput({ audience: "client", client_body: " Hej " })).toEqual({
      audience: "client",
      clientBody: "Hej",
    });
    expect(parseAudienceInput({ audience: "agency" })).toEqual({
      audience: "agency",
      clientBody: undefined,
    });
    expect(problem(() => parseAudienceInput({}))).toMatch(/audience.*required/);
    expect(problem(() => parseAudienceInput({ audience: "nobody" }))).toMatch(/audience/);

    expect(resolveClientBody("client", "Nyt spørgsmål", "Gammelt")).toBe("Nyt spørgsmål");
    expect(resolveClientBody("client", undefined, " Gammelt ")).toBe("Gammelt");
    expect(problem(() => resolveClientBody("client", undefined, null))).toMatch(/Danish/);
    expect(problem(() => resolveClientBody("client", null, "Gammelt"))).toMatch(/Danish/);
    // Back to the agency leaves the wording alone unless one is sent.
    expect(resolveClientBody("agency", undefined, "Gammelt")).toBeUndefined();
    expect(resolveClientBody("agent", "Ny", "Gammelt")).toBe("Ny");
  });

  it("filters by audience: one, a comma list or all", () => {
    expect(parseAudienceFilter(null)).toBeNull();
    expect(parseAudienceFilter("all")).toBeNull();
    expect(parseAudienceFilter("client")).toEqual(["client"]);
    expect(parseAudienceFilter("agent, client,agent")).toEqual(["agent", "client"]);
    expect(problem(() => parseAudienceFilter("client,bots"))).toMatch(/audience/);
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
  it("reads { text, client_text } items next to plain ones", () => {
    const { features } = parseFeaturesInput({
      items: [
        "Reset password",
        { text: "[x] Sign in", client_text: "  Man kan logge ind " },
        { text: "Sign out", client_text: "" },
      ],
    });
    expect(features).toEqual([
      { text: "Reset password", met: false },
      { text: "Sign in", met: true, clientText: "Man kan logge ind" },
      { text: "Sign out", met: false },
    ]);
  });

  it("puts a top-level client_text on a single feature only", () => {
    expect(parseFeaturesInput({ text: "Sign in", client_text: "Log ind" }).features).toEqual([
      { text: "Sign in", met: false, clientText: "Log ind" },
    ]);
    expect(problem(() => parseFeaturesInput({ text: "a\nb", client_text: "x" }))).toMatch(
      /single feature/,
    );
    expect(
      problem(() => parseFeaturesInput({ items: [{ text: "a", client_text: "x".repeat(301) }] })),
    ).toMatch(/300/);
  });

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
    expect(problem(() => parseFeaturesInput({ items: [{ client_text: "x" }] }))).toMatch(/items/);
    const many = Array.from({ length: 51 }, (_, i) => `feature ${i}`);
    expect(problem(() => parseFeaturesInput({ items: many }))).toMatch(/At most 50/);
  });

  it("updates met and text", () => {
    expect(parseFeatureUpdate({ met: true })).toEqual({ met: true });
    expect(parseFeatureUpdate({ text: "  new   words " })).toEqual({ text: "new words" });
    expect(problem(() => parseFeatureUpdate({ met: "true" }))).toMatch(/true or false/);
    expect(problem(() => parseFeatureUpdate({}))).toMatch(/met/);
    expect(parseFeatureUpdate({ client_text: "  Man kan logge ind " })).toEqual({
      client_text: "Man kan logge ind",
    });
    expect(parseFeatureUpdate({ client_text: "" })).toEqual({ client_text: null });
    expect(parseFeatureUpdate({ client_text: null, met: true })).toEqual({
      client_text: null,
      met: true,
    });
    expect(problem(() => parseFeatureUpdate({ client_text: 4 }))).toMatch(/must be text/);
    expect(problem(() => parseFeatureUpdate({ client_text: "x".repeat(301) }))).toMatch(/300/);
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

  it("sets the client text of a lone step, or per item", () => {
    expect(parseStepsInput({ text: "only", client_text: " Ny forside " }).lines).toEqual([
      { text: "only", depth: 0, done: false, clientText: "Ny forside" },
    ]);
    const input = parseStepsInput({
      items: ["plain", { text: "shown", client_text: "Vist for kunden" }],
    });
    expect(input.lines[0]).not.toHaveProperty("clientText");
    expect(input.lines[1]).toMatchObject({ text: "shown", clientText: "Vist for kunden" });
  });

  it("refuses one client text for several steps, and a client text that is too long", () => {
    expect(problem(() => parseStepsInput({ items: ["a", "b"], client_text: "x" }))).toMatch(
      /single step/,
    );
    expect(problem(() => parseStepsInput({ text: "a", client_text: "x".repeat(301) }))).toMatch(
      /300/,
    );
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
    expect(parseStepPatch({ client_text: " Ny forside " })).toEqual({ client_text: "Ny forside" });
    expect(parseStepPatch({ client_text: "" })).toEqual({ client_text: null });
    expect(parseStepPatch({ client_text: null })).toEqual({ client_text: null });
    expect(problem(() => parseStepPatch({ client_text: "x".repeat(301) }))).toMatch(/300/);
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
