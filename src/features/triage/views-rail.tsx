import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { viewFilters } from "@/data/views";
import type { TicketFilters } from "@/data/filters";
import type { QueueCounts } from "@/data/tickets";
import type { SavedView } from "@/data/types";
import { CLEARED_FILTERS, QUEUE_VIEWS, matchesQueueView } from "./queue-views";

export type Counts = QueueCounts;

/**
 * Applying a view replaces the filters rather than merging into whatever was
 * already set — otherwise "Overdue" would silently keep the project filter from
 * the view before it and show a different number than the count beside it.
 */
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

  return (
    <nav aria-label="Saved views" className="flex h-full flex-col gap-5 overflow-y-auto px-3 py-4">
      <div>
        <h2 className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Views
        </h2>
        <ul className="space-y-0.5">
          {QUEUE_VIEWS.map((view) => {
            const count = counts?.[view.id];
            const active = matchesQueueView(currentFilters, view);
            const hot = (view.tone === "danger" || view.tone === "warning") && (count ?? 0) > 0;
            return (
              <li key={view.id}>
                <button
                  type="button"
                  onClick={() =>
                    onApply({ ...CLEARED_FILTERS, ...view.filters, view: undefined }, undefined)
                  }
                  aria-current={active ? "true" : undefined}
                  className={`flex h-[34px] w-full items-center rounded-lg px-2.5 text-left text-[13px] transition-colors ${
                    active ? "bg-accent font-medium" : "hover:bg-muted"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{view.label}</span>
                  {count !== undefined && (
                    <span
                      className={`shrink-0 text-xs tabular-nums ${
                        hot
                          ? view.tone === "danger"
                            ? "font-medium text-destructive"
                            : "font-medium text-warning"
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
        <div className="flex items-center justify-between px-2.5 pb-1.5">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
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
          <p className="px-2.5 text-xs text-muted-foreground">
            Filter the queue, then save it here.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {views.map((view) => (
              <li key={view.id} className="group flex items-center">
                <button
                  type="button"
                  onClick={() => onApply({ ...CLEARED_FILTERS, ...viewFilters(view) }, view.id)}
                  aria-current={activeViewId === view.id ? "true" : undefined}
                  className={`flex h-[34px] min-w-0 flex-1 items-center rounded-lg px-2.5 text-left text-[13px] transition-colors ${
                    activeViewId === view.id ? "bg-accent font-medium" : "hover:bg-muted"
                  }`}
                >
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
