import { agentGuideText, WORKFLOW_RULES } from "../../mcp/agent-guide";
import { CodeBlock, CopyButton } from "./code-block";

const PROGRESS_EXAMPLE = `POST /api/planner/tasks/:task_id/progress
{
  "agent_id": "…",
  "status": "in_progress",
  "steps_done": ["<step id>"],
  "features_met": ["<feature id>"],
  "note": ""            // empty: no comment is posted
}`;

/** The rules agents follow, as the MCP server sends them. */
export function WorkflowTab() {
  return (
    <div className="space-y-5">
      <div className="rounded-[14px] border bg-card p-4 md:p-5">
        <h2 className="font-display text-xl">How an agent works a task</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          These rules are sent to every agent as the MCP server&rsquo;s instructions and by the{" "}
          <code className="text-xs">agent_guide</code> tool, and the skill repeats them. They keep
          the board honest: you see who has what, what is done, and what is waiting on you.
        </p>
        <div className="mt-3">
          <CopyButton text={agentGuideText()} label="Copy as text" />
        </div>
      </div>

      <ol className="space-y-2">
        {WORKFLOW_RULES.map((rule, index) => (
          <li key={rule.id} className="flex gap-3 rounded-[14px] border bg-card p-4">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-sm font-medium text-primary">
              {index + 1}
            </span>
            <div className="min-w-0">
              <h3 className="font-medium">{rule.title}</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">{rule.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <section className="space-y-2">
        <h2 className="font-display text-xl">One call for progress</h2>
        <p className="text-sm text-muted-foreground">
          <code className="text-xs">report_progress</code> updates the status, ticks steps and marks
          features met in one request. It posts a comment only when{" "}
          <code className="text-xs">note</code> is not empty, so routine updates stay out of the
          discussion.
        </p>
        <CodeBlock code={PROGRESS_EXAMPLE} caption="Progress request" />
      </section>
    </div>
  );
}
