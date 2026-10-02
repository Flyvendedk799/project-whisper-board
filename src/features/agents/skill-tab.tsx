import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "./code-block";
import { downloadSkill, SKILL_FILE, SKILL_MARKDOWN as skillMarkdown } from "./skill-file";

export function SkillTab() {
  return (
    <div className="space-y-4">
      <div className="rounded-[14px] border bg-card p-4 md:p-5">
        <h2 className="font-display text-xl">The ai-planner skill</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Teaches an agent how to work the board: claim, report progress, ask, commit to the right
          branch, finish. Save it as{" "}
          <code className="text-xs">.agents/skills/ai-planner/SKILL.md</code> in a repository, or in{" "}
          <code className="text-xs">~/.claude/skills/ai-planner/</code> for every project.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <CopyButton text={skillMarkdown} label="Copy skill" />
          <Button type="button" variant="outline" size="sm" onClick={downloadSkill}>
            <Download className="h-3.5 w-3.5" aria-hidden />
            Download {SKILL_FILE}
          </Button>
        </div>
      </div>
      <pre
        aria-label="SKILL.md"
        className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-[14px] border bg-card p-4 text-xs leading-relaxed"
      >
        {skillMarkdown}
      </pre>
    </div>
  );
}
