import { describe, expect, it } from "vitest";
import {
  buildPlatformContext,
  oneLine,
  type CtxTask,
  type PlatformData,
} from "./assistant-context";
import {
  buildAssistantSystemPrompt,
  buildAuditSystemPrompt,
  compactHistory,
  normalizeAssessment,
  parseAuditReply,
  PRESET_IDS,
  PRESETS,
  presetsFor,
  toProviderMessages,
  type AssessFacts,
} from "./assistant-prompts";
import { ACTION_VOCABULARY, parseAssistantReply } from "./assistant-actions";

const task = (n: number, over: Partial<CtxTask> = {}): CtxTask => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  sectionId: "sec-1",
  title: `Task ${n}`,
  status: "available",
  priority: "medium",
  labels: [],
  description: "Do the thing",
  hasAcceptance: false,
  features: { total: 0, met: 0 },
  steps: { total: 0, done: 0 },
  openQuestions: 0,
  blockingQuestions: 0,
  hasAiContext: false,
  dependsOn: 0,
  ...over,
});

const data = (over: Partial<PlatformData> = {}): PlatformData => ({
  today: "2026-10-02",
  person: "Ada",
  plans: [{ title: "Launch", status: "active", projectTitle: "Site", tasks: 10, done: 4 }],
  plan: {
    id: "plan-1",
    title: "Launch",
    status: "active",
    repo: "acme/app",
    base: "main",
    sections: [{ id: "sec-1", title: "Backend", tags: ["api"], goals: "Ship the API" }],
    tasks: [
      task(1, { status: "in_progress", labels: ["api"], features: { total: 3, met: 1 } }),
      task(2, { status: "done" }),
      task(3, { description: "", openQuestions: 1, blockingQuestions: 1 }),
    ],
  },
  task: {
    id: task(1).id,
    description: "Build the endpoint",
    features: [{ id: "feat-1", text: "Rate limited", met: false }],
    steps: [{ id: "step-1", text: "Write handler", done: false, depth: 0, featureId: "feat-1" }],
    questions: [
      { id: "q-1", body: "Which auth?", blocking: true, status: "open" },
      { id: "q-2", body: "Which db?", blocking: false, status: "answered", answer: "Postgres" },
    ],
    comments: [{ author: "Bo", body: "Looks good" }],
  },
  tickets: [{ number: 12, title: "Login broken", priority: "high", status: "open" }],
  ...over,
});

describe("buildPlatformContext", () => {
  it("shows the model short refs for what it may act on, and only those", () => {
    const { text, refs } = buildPlatformContext(data());
    expect(text).toContain('P1 "Launch"');
    expect(text).toContain("repo acme/app (base main)");
    expect(text).toContain('S1 section "Backend"');
    expect(text).toContain("T1 [in_progress|medium]");
    expect(text).toContain("T2 [done]");
    expect(text).toContain("no description");
    expect(text).toContain("F1 [ ] Rate limited");
    expect(text).toContain("Q1 open BLOCKING: Which auth?");
    expect(text).toContain("(answered) Which db? -> Postgres");
    expect(text).toContain("#12");
    expect(refs.resolve("task", "T3")).toBe(task(3).id);
    expect(refs.resolve("feature", "F1")).toBe("feat-1");
    expect(refs.parentOf("feature", "feat-1")).toBe(task(1).id);
    // Answered questions are not offered for answering.
    expect(refs.ids("question")).toEqual(["q-1"]);
  });

  it("gives the open task the same ref in its detail and in the plan", () => {
    const { text } = buildPlatformContext(data());
    expect(text.match(/\bT1\b/g)!.length).toBeGreaterThan(1);
    expect(text).not.toContain("T4");
  });

  it("stays inside the size cap and says what it left out", () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      task(i + 1, { title: `A fairly long task title number ${i}` }),
    );
    const big = data({ plan: { ...data().plan!, tasks: many } });
    const { text, truncated, refs } = buildPlatformContext(big, { maxChars: 6000 });
    expect(text.length).toBeLessThanOrEqual(6000);
    expect(truncated).toBe(true);
    expect(text).toMatch(/… \d+ more lines? not shown/);
    // A task that was cut off has no ref, so it cannot be acted on.
    expect(refs.ids("task").length).toBeLessThan(300);
    expect(refs.resolve("task", "T299")).toBeUndefined();
  });

  it("keeps the open task even when the plan fills the budget", () => {
    const many = Array.from({ length: 300 }, (_, i) => task(i + 2, { title: `Task title ${i}` }));
    const big = data({ plan: { ...data().plan!, tasks: [task(1), ...many] } });
    const { text } = buildPlatformContext(big, { maxChars: 4000 });
    expect(text).toContain("Description: Build the endpoint");
    expect(text).toContain("Q1 open");
  });

  it("works with no plan in view", () => {
    const { text, refs } = buildPlatformContext(data({ plan: null, task: null }));
    expect(text).toContain("## Plans in this workspace");
    expect(text).not.toContain("## Current plan");
    expect(refs.ids("task")).toEqual([]);
  });

  it("adds the detail an audit needs", () => {
    const chat = buildPlatformContext(data()).text;
    const audit = buildPlatformContext(data(), { audit: true }).text;
    expect(chat).not.toContain("no acceptance criteria");
    expect(audit).toContain("no acceptance criteria");
  });

  it("flattens and cuts text for one-line use", () => {
    expect(oneLine("a\n  b\tc", 10)).toBe("a b c");
    expect(oneLine("x".repeat(20), 10)).toHaveLength(10);
    expect(oneLine(null, 5)).toBe("");
  });
});

describe("presets", () => {
  it("has a complete definition for every id", () => {
    for (const id of PRESET_IDS) {
      const preset = PRESETS[id];
      expect(preset.id).toBe(id);
      expect(preset.label).toBeTruthy();
      expect(preset.instruction.length).toBeGreaterThan(40);
      expect(preset.message({ plan: "P", task: "T" })).toBeTruthy();
    }
  });

  it("offers task presets only with a task in view", () => {
    const ids = (view: { plan: boolean; task: boolean }) => presetsFor(view).map((p) => p.id);
    expect(ids({ plan: true, task: false })).not.toContain("write_features");
    expect(ids({ plan: true, task: true })).toContain("write_features");
    expect(ids({ plan: true, task: true })).toContain("audit_plan");
    expect(ids({ plan: false, task: true })).toEqual([
      "review_task",
      "write_features",
      "break_into_steps",
      "draft_questions",
    ]);
    expect(ids({ plan: false, task: false })).toEqual([]);
  });

  it("names the subject in what the person is shown saying", () => {
    expect(PRESETS.write_features.message({ task: "Login" })).toContain('"Login"');
    expect(PRESETS.audit_plan.message({})).toBe("Audit the plan.");
  });
});

describe("the assistant prompt", () => {
  it("carries the rules, the vocabulary, the preset and the context", () => {
    const prompt = buildAssistantSystemPrompt({
      context: "CTX-BODY",
      preset: "draft_questions",
      truncated: true,
    });
    expect(prompt).toContain(ACTION_VOCABULARY);
    expect(prompt).toContain(PRESETS.draft_questions.instruction);
    expect(prompt).toContain("CTX-BODY");
    expect(prompt).toContain("left out");
    expect(prompt).toContain("never make up");
    expect(buildAssistantSystemPrompt({ context: "x" })).not.toContain("preset workflow");
  });

  it("sends earlier answers back in the shape they were asked for", () => {
    const messages = toProviderMessages("SYS", [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "again" },
    ]);
    expect(messages[0]).toEqual({ role: "system", content: "SYS" });
    expect(JSON.parse(messages[2].content)).toEqual({ reply: "hello", actions: [] });
    expect(messages).toHaveLength(4);
  });

  it("hands the provider a clean conversation", () => {
    expect(
      compactHistory([
        { role: "assistant", content: "stray" },
        { role: "user", content: "first" },
        { role: "user", content: "second" },
        { role: "assistant", content: "  " },
        { role: "assistant", content: "answer" },
        { role: "user", content: "third" },
      ]),
    ).toEqual([
      { role: "user", content: "first\n\nsecond" },
      { role: "assistant", content: "answer" },
      { role: "user", content: "third" },
    ]);
    const long = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `m${i}`,
    }));
    const kept = compactHistory(long, 6);
    expect(kept.length).toBeLessThanOrEqual(6);
    expect(kept[0].role).toBe("user");
    expect(kept[kept.length - 1].content).toBe("m29");
  });

  it("round-trips a model reply through the context it was given", () => {
    const { refs } = buildPlatformContext(data());
    const reply = parseAssistantReply(
      JSON.stringify({
        reply: "Added.",
        actions: [
          { type: "add_features", taskId: "T3", items: ["Handles errors"] },
          { type: "answer_question", questionId: "Q1", answer: "OAuth" },
          { type: "update_task", taskId: "T40", status: "done" },
        ],
      }),
      refs,
    );
    expect(reply.actions).toHaveLength(2);
    expect(reply.dropped).toBe(1);
  });
});

describe("the audit", () => {
  const { refs } = buildPlatformContext(data(), { audit: true });

  it("is described to the model with its caps", () => {
    const prompt = buildAuditSystemPrompt("CTX", false);
    expect(prompt).toContain("at most 12 findings");
    expect(prompt).toContain(ACTION_VOCABULARY);
  });

  it("keeps findings, resolves their pointers and validates every fix", () => {
    const audit = parseAuditReply(
      JSON.stringify({
        summary: "Mostly fine.",
        findings: [
          {
            severity: "low",
            taskId: "T3",
            title: "Vague task",
            detail: "No description.",
            fix: [
              { type: "update_task", taskId: "T3", description: "Write it down." },
              { type: "update_task", taskId: "T99", status: "done" },
            ],
          },
          {
            severity: "HIGH",
            taskId: "T77",
            title: "Blocking question",
            detail: "Nobody answers.",
            fix: "nope",
          },
          { title: "", detail: "dropped: no title" },
          "junk",
        ],
      }),
      refs,
    )!;
    expect(audit.summary).toBe("Mostly fine.");
    expect(audit.findings.map((f) => [f.id, f.severity])).toEqual([
      ["f1", "high"],
      ["f2", "low"],
    ]);
    // An unknown task loses its pointer but not its text.
    expect(audit.findings[0].taskId).toBeUndefined();
    expect(audit.findings[0].fix).toEqual([]);
    expect(audit.findings[1].taskId).toBe(task(3).id);
    expect(audit.findings[1].fix).toHaveLength(1);
    expect(audit.findings[1].fixSummary[0]).toBe('Update task "Task 3": rewrite the description');
  });

  it("defaults an odd severity and refuses non-JSON", () => {
    const audit = parseAuditReply(
      '{"findings":[{"severity":"catastrophic","title":"x","detail":"y"}]}',
      refs,
    )!;
    expect(audit.findings[0].severity).toBe("medium");
    expect(parseAuditReply("I could not audit that.", refs)).toBeNull();
  });

  it("caps the findings", () => {
    const findings = Array.from({ length: 30 }, (_, i) => ({ title: `f${i}`, detail: "d" }));
    expect(parseAuditReply(JSON.stringify({ findings }), refs)!.findings).toHaveLength(12);
  });
});

describe("normalizeAssessment", () => {
  const none: AssessFacts = {
    hasRepo: true,
    hasAiContext: false,
    features: 0,
    steps: 0,
    openQuestions: 0,
  };

  it("keeps valid needs in a fixed order, without duplicates", () => {
    expect(
      normalizeAssessment('{"needs":["steps","Context","context","nonsense"],"note":"Big."}', none),
    ).toEqual({ needs: ["context", "steps"], note: "Big." });
  });

  it("does not ask for what the task already has or cannot get", () => {
    const all = '{"needs":["context","features","steps","questions"],"note":""}';
    expect(normalizeAssessment(all, { ...none, hasRepo: false })!.needs).toEqual([
      "features",
      "steps",
      "questions",
    ]);
    expect(
      normalizeAssessment(all, {
        hasRepo: true,
        hasAiContext: true,
        features: 2,
        steps: 1,
        openQuestions: 1,
      })!.needs,
    ).toEqual([]);
  });

  it("returns null for anything that is not a JSON object", () => {
    expect(normalizeAssessment("looks fine", none)).toBeNull();
    expect(normalizeAssessment("[]", none)).toBeNull();
    expect(normalizeAssessment('{"needs":"context"}', none)).toEqual({ needs: [], note: "" });
  });
});
