export type CardFace = {
  headline: string;
  detail: string;
};

export type BoardLayout = "columns" | "outline";

export const OUTLINE_SECTION_THRESHOLD = 7;

const HEADLINE_LIMIT = 80;
const MIN_SENTENCE = 16;
const MIN_WORD_CUT = 24;

export function plainTitle(title: string): string {
  return title
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function cardFace(title: string): CardFace {
  const text = plainTitle(title);
  if (text.length <= HEADLINE_LIMIT) return { headline: text, detail: "" };

  const sentence = /[.!?](?=\s|$)/g;
  let match: RegExpExecArray | null;
  while ((match = sentence.exec(text))) {
    if (match.index >= MIN_SENTENCE && match.index < HEADLINE_LIMIT) {
      return {
        headline: text.slice(0, match.index + 1),
        detail: text.slice(match.index + 1).trim(),
      };
    }
    if (match.index >= HEADLINE_LIMIT) break;
  }

  const window = text.slice(0, HEADLINE_LIMIT);
  const space = window.lastIndexOf(" ");
  const cut = space >= MIN_WORD_CUT ? space : HEADLINE_LIMIT;
  return {
    headline: text.slice(0, cut).trimEnd(),
    detail: text.slice(cut).trim(),
  };
}

export function defaultBoardLayout(sectionCount: number): BoardLayout {
  return sectionCount >= OUTLINE_SECTION_THRESHOLD ? "outline" : "columns";
}

type OutlineCountNode = { children: readonly OutlineCountNode[] };

export function nestedOutlineCount(nodes: readonly OutlineCountNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count += 1 + nestedOutlineCount(node.children);
  }
  return count;
}

export function collapseEmptySections(taskCounts: number[]): boolean {
  let filled = false;
  let empty = false;
  for (const count of taskCounts) {
    if (count > 0) filled = true;
    else empty = true;
  }
  return filled && empty;
}
