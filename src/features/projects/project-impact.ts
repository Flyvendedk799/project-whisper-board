import type { ProjectDeletionImpact } from "@/lib/projects.functions";

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The things deleting a project removes, in the order a person thinks of them. Empty ones are left out. */
export function projectLosses(impact: ProjectDeletionImpact): string[] {
  const rows: Array<[number, string]> = [
    [impact.tickets, count(impact.tickets, "ticket")],
    [impact.milestones, count(impact.milestones, "milestone")],
    [impact.meetings, count(impact.meetings, "meeting")],
    [impact.updates, count(impact.updates, "update")],
    [impact.timeEntries, count(impact.timeEntries, "time entry", "time entries")],
    [impact.quotes, count(impact.quotes, "quote")],
    [impact.invoices, count(impact.invoices, "draft or void invoice")],
  ];
  return rows.filter(([n]) => n > 0).map(([, text]) => text);
}

/** "a, b and c". */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
