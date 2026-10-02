import { downloadText } from "./download";
// The skill as it sits in the repository, so the pages cannot drift from it.
import skillMarkdown from "../../../.agents/skills/ai-planner/SKILL.md?raw";

export const SKILL_FILE = "SKILL.md";
export const SKILL_MARKDOWN: string = skillMarkdown;

/** Saves the skill as `SKILL.md`, from the public page's header and from the Skill tab alike. */
export function downloadSkill() {
  downloadText(SKILL_FILE, SKILL_MARKDOWN, "text/markdown");
}
