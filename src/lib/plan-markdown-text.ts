/**
 * Low-level text helpers shared by the legacy outline parser (`plan-markdown`)
 * and the board-format reader/writer (`plan-markdown-board`). No plan concepts
 * in here, so both can import it without importing each other.
 */

export const MAX_STEP_DEPTH = 3;
export const STEP_TEXT_MAX = 500;

/** Opening or closing line of a fenced code block, at any indentation. */
export const FENCE = /^[ \t]*(?<mark>`{3,}|~{3,})/;

/**
 * Marks every line that sits inside a fenced code block, delimiters included.
 * Those lines are body text and never headings, numbered keys or list items.
 */
export function fencedLines(lines: readonly string[]): boolean[] {
  const mask: boolean[] = [];
  let open: string | null = null;
  for (const line of lines) {
    const mark = line.match(FENCE)?.groups?.mark;
    if (open === null) {
      mask.push(Boolean(mark));
      if (mark) open = mark;
    } else {
      mask.push(true);
      if (mark && mark[0] === open[0] && mark.length >= open.length) open = null;
    }
  }
  return mask;
}

export function blankLine(line: string): boolean {
  return line.trim().length === 0;
}

export function joinBody(lines: string[]): string {
  return lines
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function collapseSpaces(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
