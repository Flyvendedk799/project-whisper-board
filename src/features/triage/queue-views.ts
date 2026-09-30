import { CLOSED_TICKET_STATUSES, OPEN_TICKET_STATUSES } from "@/data/enums";
import type { TicketFilters } from "@/data/filters";
import type { QueueCounts } from "@/data/tickets";

/**
 * The built-in queues. Each is nothing more than a filter object, so the rail,
 * the home tiles and the sidebar link all send the same search params and the
 * number next to a view is the number of rows you land on.
 */
export type QueueViewId = keyof QueueCounts;

export interface QueueView {
  id: QueueViewId;
  label: string;
  filters: Partial<TicketFilters>;
  tone?: "danger" | "warning";
}

const open = () => [...OPEN_TICKET_STATUSES];

export const QUEUE_VIEWS: readonly QueueView[] = [
  { id: "allOpen", label: "All open", filters: { status: open(), sort: "updated" } },
  {
    id: "needsTriage",
    label: "Needs triage",
    filters: { status: ["open"], assignee: "unassigned", sort: "oldest" },
  },
  {
    id: "breached",
    label: "Overdue",
    filters: { sla: "breached", sort: "sla" },
    tone: "danger",
  },
  { id: "atRisk", label: "Due soon", filters: { sla: "at_risk", sort: "sla" }, tone: "warning" },
  {
    id: "awaiting",
    label: "Awaiting a first reply",
    filters: { awaiting: true, sort: "oldest" },
  },
  {
    id: "mine",
    label: "Assigned to me",
    filters: { assignee: "me", status: open(), sort: "updated" },
  },
  {
    id: "unassigned",
    label: "Unassigned",
    filters: { assignee: "unassigned", status: open(), sort: "updated" },
  },
  {
    id: "closed",
    label: "Closed",
    filters: { status: [...CLOSED_TICKET_STATUSES], sort: "updated" },
  },
];

export function queueView(id: QueueViewId): QueueView {
  return QUEUE_VIEWS.find((v) => v.id === id)!;
}

/** The filters that define a view, with every other field cleared. */
export const CLEARED_FILTERS: Partial<TicketFilters> = {
  q: undefined,
  status: undefined,
  type: undefined,
  priority: undefined,
  projectId: undefined,
  assignee: undefined,
  reporter: undefined,
  labels: undefined,
  age: undefined,
  sla: undefined,
  awaiting: undefined,
  sort: "updated",
};

/** Search params for navigating to a view from anywhere (home tiles, sidebar). */
export function queueSearch(id: QueueViewId): TicketFilters {
  const { sort = "updated", ...rest } = queueView(id).filters;
  return { ...rest, sort } as TicketFilters;
}

/**
 * Whether the current search is exactly this view. Presentation-only keys
 * (`view`, `board`) are ignored, as are `q` and `sort`, so typing in the search box
 * or re-sorting does not make the highlighted queue vanish.
 */
export function matchesQueueView(current: TicketFilters, view: QueueView): boolean {
  if (current.view) return false;
  const expected = { ...CLEARED_FILTERS, ...view.filters };
  return (Object.keys(CLEARED_FILTERS) as Array<keyof TicketFilters>)
    .filter((key) => key !== "q" && key !== "sort")
    .every((key) => JSON.stringify(current[key] ?? null) === JSON.stringify(expected[key] ?? null));
}
