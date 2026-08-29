import { Check, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABEL,
  TICKET_STATUSES,
  TICKET_STATUS_LABEL,
  type TicketPriority,
  type TicketStatus,
} from "@/data/enums";
import type { PersonRef } from "@/data/types";

/** Appears only when something is selected; Escape clears the selection. */
export function BulkBar({
  count,
  busy,
  people,
  onStatus,
  onPriority,
  onAssignee,
  onClear,
}: {
  count: number;
  busy: boolean;
  people: PersonRef[];
  onStatus: (status: TicketStatus) => void;
  onPriority: (priority: TicketPriority) => void;
  onAssignee: (assigneeId: string | null) => void;
  onClear: () => void;
}) {
  if (count === 0) return null;

  return (
    <div
      role="toolbar"
      aria-label={`${count} tickets selected`}
      className="flex flex-wrap items-center gap-2 border-b bg-accent/40 px-3 py-2"
    >
      <span className="text-sm font-medium">{count} selected</span>

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

      <Button variant="ghost" size="sm" onClick={onClear} className="ml-auto">
        <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
        Clear
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
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          {icon}
          <span className={icon ? "ml-1.5" : ""}>{label}</span>
        </Button>
      </PopoverTrigger>
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
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
      >
        <Check className="h-3.5 w-3.5 opacity-0" aria-hidden="true" />
        <span className="truncate">{children}</span>
      </button>
    </li>
  );
}
