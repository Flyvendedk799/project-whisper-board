import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "./code-block";
import { downloadSkill, SKILL_FILE, SKILL_MARKDOWN as skillMarkdown } from "./skill-file";

/** Where each client looks for a skill that applies to every project. */
const SKILL_LOCATIONS = [
  { client: "Claude Code", path: "~/.claude/skills/ai-planner/SKILL.md" },
  { client: "Codex", path: "~/.agents/skills/ai-planner/SKILL.md" },
  { client: "Cursor", path: "~/.cursor/skills/ai-planner/SKILL.md" },
  { client: "Antigravity", path: "~/.gemini/config/skills/ai-planner/SKILL.md" },
] as const;

export function SkillTab() {
  return (
    <div className="space-y-4">
      <div className="rounded-[14px] border bg-card p-4 md:p-5 max-md:[&_code]:break-all">
        <h2 className="font-display text-xl">The ai-planner skill</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Teaches an agent how to work the board: claim, report progress, ask, commit to the right
          branch, finish. Save it as{" "}
          <code className="text-xs">.agents/skills/ai-planner/SKILL.md</code> in a repository
          (Codex, Cursor and Antigravity read it there), or once for every project:
        </p>
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
          {SKILL_LOCATIONS.map(({ client, path }) => (
            <li key={client}>
              <span className="text-foreground">{client}</span>{" "}
              <code className="text-xs">{path}</code>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2 max-md:flex-col max-md:[&>*]:h-11 max-md:[&>*]:w-full">
          <CopyButton text={skillMarkdown} label="Copy skill" />
          <Button type="button" variant="outline" size="sm" onClick={downloadSkill}>
            <Download className="h-3.5 w-3.5" aria-hidden />
            Download {SKILL_FILE}
          </Button>
        </div>
      </div>
      <pre
        aria-label="SKILL.md"
        className="max-h-[70vh] overflow-auto overscroll-contain max-md:max-h-[60dvh] whitespace-pre-wrap break-words rounded-[14px] border bg-card p-4 text-xs leading-relaxed"
      >
        {skillMarkdown}
      </pre>
    </div>
  );
}
