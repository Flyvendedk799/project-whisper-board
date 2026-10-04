import { useState } from "react";
import { Check, Trash2, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABEL,
  TICKET_STATUSES,
  TICKET_STATUS_LABEL,
  type TicketPriority,
  type TicketStatus,
} from "@/data/enums";
import type { PersonRef } from "@/data/types";

/**
 * Appears only when something is selected; Escape clears the selection. On a
 * phone it is a single row pinned above the tab bar: the count and a clear
 * button, then the actions in a row that scrolls sideways. Each menu opens as a
 * bottom sheet with full-height rows instead of a small popover.
 */
export function BulkBar({
  count,
  busy,
  people,
  viewerId,
  onStatus,
  onPriority,
  onAssignee,
  onDelete,
  onCreatePlan,
  onClear,
}: {
  count: number;
  busy: boolean;
  people: PersonRef[];
  /** Enables the one-click "Assign to me". */
  viewerId?: string;
  onStatus: (status: TicketStatus) => void;
  onPriority: (priority: TicketPriority) => void;
  onAssignee: (assigneeId: string | null) => void;
  /** Asks to delete the selection; the caller owns the confirmation. */
  onDelete: () => void;
  onCreatePlan: () => void;
  onClear: () => void;
}) {
  if (count === 0) return null;

  return (
    <div
      role="toolbar"
      aria-label={`${count} tickets selected`}
      className="flex flex-wrap items-center gap-2 border-b bg-accent px-6 py-2.5 text-[13px] max-md:fixed max-md:inset-x-0 max-md:bottom-[calc(var(--mobile-tabbar-h)+var(--mobile-timer-h,0rem))] max-md:z-30 max-md:flex-nowrap max-md:gap-1 max-md:border-b-0 max-md:border-t max-md:bg-card max-md:px-2 max-md:py-1.5 max-md:shadow-[0_-4px_16px_rgba(0,0,0,0.08)]"
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={onClear}
        aria-label="Clear selection"
        className="hidden shrink-0 max-md:inline-flex"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
      <span className="font-medium max-md:min-w-[5.5rem] max-md:shrink-0 max-md:pr-1">
        {count} selected
      </span>

      <div className="contents max-md:no-scrollbar max-md:flex max-md:min-w-0 max-md:flex-1 max-md:items-center max-md:gap-2 max-md:overflow-x-auto max-md:overscroll-x-contain max-md:pr-2">
        <Menu label="Status" disabled={busy}>
          {TICKET_STATUSES.map((status) => (
            <MenuItem key={status} onSelect={() => onStatus(status)}>
              {TICKET_STATUS_LABEL[status]}
            </MenuItem>
          ))}
        </Menu>

        <Menu label="Priority" disabled={busy}>
          {TICKET_PRIORITIES.map((priority) => (
            <MenuItem key={priority} onSelect={() => onPriority(priority)}>
              {TICKET_PRIORITY_LABEL[priority]}
            </MenuItem>
          ))}
        </Menu>

        <Menu label="Assignee" disabled={busy} icon={<User className="h-3.5 w-3.5" />}>
          <MenuItem onSelect={() => onAssignee(null)}>Unassign</MenuItem>
          {people.map((person) => (
            <MenuItem key={person.id} onSelect={() => onAssignee(person.id)}>
              {person.full_name ?? person.email}
            </MenuItem>
          ))}
        </Menu>

        {viewerId && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 rounded-full bg-card px-3 text-xs max-md:shrink-0 max-md:px-4 max-md:text-[13px]"
            disabled={busy}
            onClick={() => onAssignee(viewerId)}
          >
            Assign to me
          </Button>
        )}

        <Button
          variant="outline"
          size="sm"
          className="h-7 rounded-full bg-card px-3 text-xs max-md:shrink-0 max-md:px-4 max-md:text-[13px]"
          disabled={busy}
          onClick={onCreatePlan}
        >
          Create plan
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-7 rounded-full bg-card px-3 text-xs text-destructive hover:text-destructive max-md:shrink-0 max-md:px-4 max-md:text-[13px]"
          disabled={busy}
          onClick={onDelete}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Delete
        </Button>
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={onClear}
        className="ml-auto h-7 text-xs max-md:hidden"
      >
        <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
        Clear selection
      </Button>
    </div>
  );
}

function Menu({
  label,
  disabled,
  icon,
  children,
}: {
  label: string;
  disabled: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);

  const trigger = (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled}
      className="h-7 rounded-full bg-card px-3 text-xs max-md:shrink-0 max-md:px-4 max-md:text-[13px]"
    >
      {icon}
      <span className={icon ? "ml-1.5" : ""}>{label}</span>
    </Button>
  );

  if (isMobile) {
    return (
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="bottom" className="px-0 pt-9">
          <SheetHeader className="px-5 text-left">
            <SheetTitle>{label}</SheetTitle>
          </SheetHeader>
          <ul
            className="mt-2 max-h-[60dvh] overflow-y-auto overscroll-contain"
            onClick={() => setSheetOpen(false)}
          >
            {children}
          </ul>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="max-h-72 w-48 overflow-y-auto p-1">
        <ul>{children}</ul>
      </PopoverContent>
    </Popover>
  );
}

function MenuItem({ onSelect, children }: { onSelect: () => void; children: React.ReactNode }) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent max-md:h-12 max-md:rounded-none max-md:px-5 max-md:text-[15px]"
      >
        <Check className="h-3.5 w-3.5 opacity-0" aria-hidden="true" />
        <span className="truncate">{children}</span>
      </button>
    </li>
  );
}
