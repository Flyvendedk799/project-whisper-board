/**
 * @mentions, in the two places text is written.
 *
 * Plain text (planner notes, agent comments over the API) stores a mention as
 *
 *     @[Ada Lovelace](user:7d6f…)
 *
 * so the id survives renames and the text still reads sensibly anywhere it is
 * shown raw (an email, a terminal, an agent's context). Rich text (ticket
 * replies) stores the TipTap node
 *
 *     <span data-type="mention" data-id="7d6f…" data-label="Ada Lovelace">@Ada Lovelace</span>
 *
 * Both carry the profile id, which is what notifications are sent to. Nothing
 * here touches the DOM, so the server, the API and the UI share it.
 */

export interface MentionPerson {
  id: string;
  full_name?: string | null;
  email?: string | null;
}

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

/** `@[label](user:uuid)`. The label may not contain `]` or a newline. */
const TOKEN_SOURCE = `@\\[([^\\]\\n]{1,120})\\]\\(user:(${UUID})\\)`;
const HTML_SOURCE = `data-type=["']mention["'][^>]*?data-id=["'](${UUID})["']|data-id=["'](${UUID})["'][^>]*?data-type=["']mention["']`;

export const MAX_MENTIONS = 20;

/** The name a picker and a chip show for someone. */
export function mentionLabel(person: MentionPerson): string {
  const name = person.full_name?.trim();
  if (name) return name;
  const email = person.email?.trim();
  if (email) return email.split("@")[0] || email;
  return "someone";
}

/** The stored form of a mention in plain text. */
export function mentionToken(person: MentionPerson): string {
  const label =
    mentionLabel(person)
      .replace(/[\]\n]/g, " ")
      .slice(0, 120)
      .trim() || "someone";
  return `@[${label}](user:${person.id})`;
}

/** Every distinct profile id mentioned, in order of first appearance, in plain or rich text. */
export function extractMentionIds(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const found: Array<{ index: number; id: string }> = [];
  for (const match of text.matchAll(new RegExp(TOKEN_SOURCE, "g"))) {
    found.push({ index: match.index ?? 0, id: match[2]!.toLowerCase() });
  }
  for (const match of text.matchAll(new RegExp(HTML_SOURCE, "g"))) {
    found.push({ index: match.index ?? 0, id: (match[1] ?? match[2])!.toLowerCase() });
  }
  found.sort((a, b) => a.index - b.index);
  const ids: string[] = [];
  for (const { id } of found) {
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_MENTIONS) break;
  }
  return ids;
}

export type MentionSegment =
  | { type: "text"; text: string }
  | { type: "mention"; id: string; label: string };

/** Plain text cut into runs of text and mentions, for rendering chips. */
export function splitMentions(text: string): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(new RegExp(TOKEN_SOURCE, "g"))) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ type: "text", text: text.slice(last, index) });
    segments.push({ type: "mention", id: match[2]!.toLowerCase(), label: match[1]! });
    last = index + match[0].length;
  }
  if (last < text.length) segments.push({ type: "text", text: text.slice(last) });
  return segments;
}

/** Mentions shown as `@Name`: for emails, excerpts and the activity feed. */
export function mentionsToPlainText(text: string): string {
  return text.replace(new RegExp(TOKEN_SOURCE, "g"), (_whole, label: string) => `@${label}`);
}

/**
 * What is being typed after an `@`, if the caret sits right after one.
 * The `@` must start the text or follow whitespace or an opening bracket, so an
 * email address never opens the picker.
 */
export function mentionQueryAt(
  text: string,
  caret: number,
): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const match = /(^|[\s([{])@([^\s@[\]()]{0,40})$/.exec(before);
  if (!match) return null;
  const start = before.length - match[2]!.length - 1;
  return { query: match[2]!, start };
}

/** People whose name or email matches what was typed, best matches first. */
export function filterMentionCandidates<T extends MentionPerson>(
  people: readonly T[],
  query: string,
  options: { excludeId?: string | null; limit?: number } = {},
): T[] {
  const q = query.trim().toLowerCase();
  const scored: Array<{ person: T; score: number }> = [];
  for (const person of people) {
    if (options.excludeId && person.id === options.excludeId) continue;
    const name = (person.full_name ?? "").toLowerCase();
    const email = (person.email ?? "").toLowerCase();
    let score: number;
    if (!q) score = 3;
    else if (name.startsWith(q) || name.split(/\s+/).some((part) => part.startsWith(q))) score = 0;
    else if (email.startsWith(q)) score = 1;
    else if (name.includes(q) || email.includes(q)) score = 2;
    else continue;
    scored.push({ person, score });
  }
  scored.sort(
    (a, b) => a.score - b.score || mentionLabel(a.person).localeCompare(mentionLabel(b.person)),
  );
  return scored.slice(0, options.limit ?? 6).map((entry) => entry.person);
}

/**
 * Turns the friendly `@Ada Lovelace` a composer shows into stored tokens, for
 * the people actually picked. Longest names first, so "@Ada Lovelace" wins over
 * "@Ada". A picked person whose `@Name` was deleted again is simply not mentioned.
 */
export function encodeMentions(text: string, picked: readonly MentionPerson[]): string {
  const unique = [...new Map(picked.map((person) => [person.id, person])).values()];
  const byLength = unique
    .map((person) => ({ person, label: mentionLabel(person) }))
    .sort((a, b) => b.label.length - a.label.length);
  let out = text;
  for (const { person, label } of byLength) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Not already inside a token, and not the start of a longer word.
    const pattern = new RegExp(`(^|[^\\[\\w])@${escaped}(?![\\w\\]])`, "g");
    out = out.replace(pattern, (_whole, lead: string) => `${lead}${mentionToken(person)}`);
  }
  return out;
}

/** Only the ids that belong to `allowed`, so nobody can notify a stranger. */
export function allowedMentions(ids: readonly string[], allowed: Iterable<string>): string[] {
  const set = new Set([...allowed].map((id) => id.toLowerCase()));
  return [...new Set(ids.map((id) => id.toLowerCase()))].filter((id) => set.has(id));
}

/**
 * Keyboard handling for a mention picker, shared by both composers. Returns
 * true when the key was used, so the caller stops it reaching the input.
 */
export function mentionKeyDown(
  key: string,
  state: { open: boolean; count: number; active: number },
  actions: { move: (index: number) => void; pick: () => void; close: () => void },
): boolean {
  if (!state.open || state.count === 0) return false;
  switch (key) {
    case "ArrowDown":
      actions.move((state.active + 1) % state.count);
      return true;
    case "ArrowUp":
      actions.move((state.active - 1 + state.count) % state.count);
      return true;
    case "Enter":
    case "Tab":
      actions.pick();
      return true;
    case "Escape":
      actions.close();
      return true;
    default:
      return false;
  }
}
