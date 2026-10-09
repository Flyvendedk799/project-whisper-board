import { describe, expect, it } from "vitest";
import type { PlanWithSections, TaskWithAgent } from "@/data";
import { parsePlanMarkdown, planMarkdownCoverage } from "@/lib/plan-markdown";
import { planToDocument, planToMarkdown } from "./plan-export";

const NOW = new Date("2026-10-02T10:00:00Z");

function task(id: string, title: string, extra: Partial<TaskWithAgent> = {}): TaskWithAgent {
  return {
    acceptance_criteria: null,
    ai_assessed_at: null,
    ai_assessment: null,
    ai_context: null,
    ai_context_at: null,
    blocked_from: null,
    color: null,
    actual_minutes: null,
    assigned_agent_id: null,
    assigned_user_id: null,
    branch_name: null,
    claimed_at: null,
    client_summary: null,
    client_title: null,
    completed_at: null,
    complexity: null,
    context_files: [],
    created_at: "2026-10-01T00:00:00Z",
    depends_on: [],
    description: null,
    estimated_minutes: null,
    id,
    labels: [],
    plan_id: "plan-1",
    position: 1,
    preferred_models: [],
    preferred_providers: [],
    pr_number: null,
    pr_status: null,
    pr_url: null,
    priority: "medium",
    section_id: "sec-1",
    status: "available",
    ticket_id: null,
    title,
    updated_at: "",
    assigned_agent: null,
    ...extra,
  };
}

const AUTH = "11111111-1111-4111-8111-111111111111";
const RESET = "22222222-2222-4222-8222-222222222222";
const SECTION = "33333333-3333-4333-8333-333333333333";
const PLAN = "44444444-4444-4444-8444-444444444444";

/** A plan using every field the board has. */
function richPlan(): PlanWithSections {
  const auth = task(AUTH, "Auth gate", {
    description: "Wire the session middleware.\n\nSee the `auth/` folder.",
    status: "blocked",
    priority: "high",
    complexity: "medium",
    labels: ["auth", "api"],
    color: "#3b82f6",
    client_title: "Tryggere login",
    client_summary: "Man bliver nu logget ind på en sikker måde.",
    acceptance_criteria: "Expired sessions redirect to sign-in.",
    ai_context: "Uses `requireSupabaseAuth`.\n\n```ts\nconst x = 1;\n```",
    assigned_user: { id: "u1", full_name: "Ana Ruiz", email: "ana@example.com", avatar_url: null },
    features: [
      { id: "f1", text: "Sign in with email", met: true, position: 1 },
      { id: "f2", text: "Sessions refresh silently", met: false, position: 2 },
    ] as TaskWithAgent["features"],
    steps: [
      { id: "s1", text: "Write middleware", done: true, depth: 0, position: 1, feature_id: "f1" },
      { id: "s2", text: "Cookie refresh", done: false, depth: 1, position: 2, feature_id: "f2" },
      { id: "s3", text: "Docs", done: false, depth: 0, position: 3, feature_id: null },
    ] as TaskWithAgent["steps"],
    questions: [
      {
        id: "q1",
        body: "Which identity provider do we use?",
        blocking: true,
        status: "open",
        answer: null,
        created_at: "2026-10-01T01:00:00Z",
      },
      {
        id: "q2",
        body: "Do we need SSO?",
        blocking: false,
        status: "answered",
        answer: "Not for v1.\nRevisit in Q1.",
        created_at: "2026-10-01T02:00:00Z",
      },
      {
        id: "q3",
        body: "Support IE11?",
        blocking: false,
        status: "dismissed",
        answer: null,
        created_at: "2026-10-01T03:00:00Z",
      },
    ] as TaskWithAgent["questions"],
  });
  const reset = task(RESET, "Password reset", { position: 2, status: "done" });
  return {
    id: PLAN,
    title: "Q4 Launch",
    description: "Ship the new sign-in.",
    status: "active",
    github_repo: "acme/app",
    github_base: "main",
    github_work_mode: "new",
    github_work_branch: "plan/q4-launch",
    sections: [
      {
        id: SECTION,
        plan_id: PLAN,
        title: "Foundations",
        description: "Everything else stands on this.",
        goals: "Sign-in works end to end.",
        intentions: "Keep it boring.",
        client_summary: "Vi har bygget loginsiden.",
        tags: ["infra", "security"],
        color: "var(--chart-3)",
        position: 1,
        created_at: "",
        tasks: [reset, auth],
      },
    ],
  } as unknown as PlanWithSections;
}

describe("planToMarkdown", () => {
  it("lays the board out as readable Markdown", () => {
    expect(planToMarkdown(richPlan(), NOW)).toMatchInlineSnapshot(`
      "<!-- boared:plan-export v1 -->

      # Q4 Launch

      > **Status:** Active · **Repo:** \`acme/app\` · **Base:** \`main\` · **Branch:** \`plan/q4-launch\` (new branch)
      >
      > **Plan ID:** \`44444444-4444-4444-8444-444444444444\` · **Exported:** 2026-10-02

      Ship the new sign-in.

      ## Foundations

      > **Tags:** \`infra\` \`security\` · **Colour:** \`var(--chart-3)\` · **ID:** \`33333333-3333-4333-8333-333333333333\`

      Everything else stands on this.

      **Goals**

      Sign-in works end to end.

      **Intentions**

      Keep it boring.

      **Client summary**

      Vi har bygget loginsiden.

      ### Auth gate

      > **Status:** Blocked · **Priority:** High · **Size:** Medium · **Tags:** \`auth\` \`api\` · **Assignee:** Ana Ruiz · **Colour:** Blue \`#3b82f6\` · **ID:** \`11111111-1111-4111-8111-111111111111\`

      Wire the session middleware.

      See the \`auth/\` folder.

      **Client title**

      Tryggere login

      **Client summary**

      Man bliver nu logget ind på en sikker måde.

      **Features**

      1. [x] Sign in with email
      2. [ ] Sessions refresh silently

      **Sub-steps**

      - [x] Write middleware → feature 1
        - [ ] Cookie refresh → feature 2
      - [ ] Docs

      **Acceptance**

      Expired sessions redirect to sign-in.

      <details>
      <summary>Technical context</summary>

      Uses \`requireSupabaseAuth\`.

      \`\`\`ts
      const x = 1;
      \`\`\`

      </details>

      **Questions**

      - **Open · blocking** — Which identity provider do we use?
      - **Answered** — Do we need SSO?
        > **Answer:** Not for v1.
        > Revisit in Q1.
      - **Dismissed** — Support IE11?

      ### Password reset

      > **Status:** Done · **Priority:** Medium · **ID:** \`22222222-2222-4222-8222-222222222222\`
      "
    `);
  });

  it("leaves out parts a task does not have", () => {
    const plan = richPlan();
    plan.sections[0].tasks = [task(RESET, "Password reset")];
    plan.sections[0].tags = [];
    plan.sections[0].goals = null;
    plan.sections[0].intentions = null;
    plan.sections[0].client_summary = null;
    const md = planToMarkdown(plan, NOW);
    expect(md).not.toMatch(
      /\*\*(Features|Sub-steps|Acceptance|Questions|Goals|Intentions|Client summary)\*\*/,
    );
    expect(md).not.toContain("<details>");
  });

  it("writes the client summary and reads it back", () => {
    const md = planToMarkdown(richPlan(), NOW);
    expect(md).toContain("**Client summary**\n\nVi har bygget loginsiden.");
    const parsed = parsePlanMarkdown(md);
    expect(parsed.sections[0].clientSummary).toBe("Vi har bygget loginsiden.");
  });

  it("writes a task's client title and summary and leaves them out when empty", () => {
    const doc = planToDocument(richPlan(), NOW);
    expect(doc.sections[0].tasks.find((entry) => entry.id === AUTH)).toMatchObject({
      clientTitle: "Tryggere login",
      clientSummary: "Man bliver nu logget ind på en sikker måde.",
    });
    const reset = doc.sections[0].tasks.find((entry) => entry.id === RESET)!;
    expect(reset).not.toHaveProperty("clientTitle");
    expect(reset).not.toHaveProperty("clientSummary");
  });

  it("reads back into the same document", () => {
    const plan = richPlan();
    const md = planToMarkdown(plan, NOW);
    const parsed = parsePlanMarkdown(md);
    const { structural: _structural, format, ...rest } = parsed;
    expect(format).toBe("board");
    expect(rest).toEqual(planToDocument(plan, NOW));
    expect(planMarkdownCoverage(md, parsed).missing).toEqual([]);
  });
});
