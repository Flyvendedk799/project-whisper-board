import { useState } from "react";
import {
  AlertTriangle,
  Bookmark,
  Clock,
  Inbox,
  MessageSquareWarning,
  Plus,
  Trash2,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { viewFilters } from "@/data/views";
import type { TicketFilters } from "@/data/filters";
import type { SavedView } from "@/data/types";

/**
 * The built-in views are the six questions the owner actually opens the app to
 * ask. Each one is a filter object, so clicking it does exactly what setting
 * those filters by hand would — there is no separate "smart view" concept.
 */
export interface Counts {
  needsTriage: number;
  unassigned: number;
  awaiting: number;
  breached: number;
  atRisk: number;
  mine: number;
}

const BUILT_IN: Array<{
  id: keyof Counts;
  label: string;
  icon: typeof Inbox;
  filters: Partial<TicketFilters>;
  tone?: "danger";
}> = [
  {
    id: "breached",
    label: "Overdue",
    icon: AlertTriangle,
    filters: { sla: "breached", sort: "sla" },
    tone: "danger",
  },
  {
    id: "needsTriage",
    label: "Needs triage",
    icon: Inbox,
    filters: { status: ["open"], sort: "oldest" },
  },
  {
    id: "awaiting",
    label: "Awaiting first reply",
    icon: MessageSquareWarning,
    filters: { awaiting: true, sort: "oldest" },
  },
  { id: "atRisk", label: "Due soon", icon: Clock, filters: { sla: "at_risk", sort: "sla" } },
  { id: "unassigned", label: "Unassigned", icon: UserRound, filters: { assignee: "unassigned" } },
  { id: "mine", label: "Assigned to me", icon: UserRound, filters: { assignee: "me" } },
];

export function ViewsRail({
  counts,
  views,
  activeViewId,
  currentFilters,
  onApply,
  onSave,
  onDelete,
  canSave,
}: {
  counts?: Counts;
  views: SavedView[];
  activeViewId?: string;
  currentFilters: TicketFilters;
  onApply: (filters: Partial<TicketFilters>, viewId?: string) => void;
  onSave: (name: string) => void;
  onDelete: (viewId: string) => void;
  canSave: boolean;
}) {
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);

  const matchesBuiltIn = (filters: Partial<TicketFilters>) =>
    !activeViewId &&
    Object.entries(filters).every(
      ([key, value]) =>
        JSON.stringify(currentFilters[key as keyof TicketFilters]) === JSON.stringify(value),
    );

  return (
    <nav aria-label="Saved views" className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      <div>
        <h2 className="px-2 pb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Queues
        </h2>
        <ul className="space-y-0.5">
          {BUILT_IN.map((view) => {
            const count = counts?.[view.id] ?? 0;
            const active = matchesBuiltIn(view.filters);
            return (
              <li key={view.id}>
                <button
                  type="button"
                  onClick={() => onApply({ ...emptyish, ...view.filters }, undefined)}
                  aria-current={active ? "true" : undefined}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                    active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
                  }`}
                >
                  <view.icon
                    className={`h-4 w-4 shrink-0 ${
                      view.tone === "danger" && count > 0
                        ? "text-destructive"
                        : "text-muted-foreground"
                    }`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate">{view.label}</span>
                  {count > 0 && (
                    <span
                      className={`shrink-0 text-xs tabular-nums ${
                        view.tone === "danger"
                          ? "font-medium text-destructive"
                          : "text-muted-foreground"
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <div className="flex items-center justify-between px-2 pb-1.5">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Saved
          </h2>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                disabled={!canSave}
                aria-label="Save current filters as a view"
                title={canSave ? "Save these filters" : "Set some filters first"}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!name.trim()) return;
                  onSave(name.trim());
                  setName("");
                  setOpen(false);
                }}
                className="space-y-2"
              >
                <label htmlFor="view-name" className="text-sm font-medium">
                  Name this view
                </label>
                <Input
                  id="view-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Urgent bugs for Acme"
                  autoFocus
                />
                <Button type="submit" size="sm" className="w-full">
                  Save
                </Button>
              </form>
            </PopoverContent>
          </Popover>
        </div>

        {views.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">Filter the queue, then save it here.</p>
        ) : (
          <ul className="space-y-0.5">
            {views.map((view) => (
              <li key={view.id} className="group flex items-center">
                <button
                  type="button"
                  onClick={() => onApply({ ...emptyish, ...viewFilters(view) }, view.id)}
                  aria-current={activeViewId === view.id ? "true" : undefined}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                    activeViewId === view.id
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/60"
                  }`}
                >
                  <Bookmark className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{view.name}</span>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={`Delete view ${view.name}`}
                  onClick={() => onDelete(view.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}

/**
 * Applying a view replaces the filters rather than merging into whatever was
 * already set — otherwise "Overdue" would silently keep the project filter from
 * the view before it and show a different number than the count beside it.
 */
const emptyish: Partial<TicketFilters> = {
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
