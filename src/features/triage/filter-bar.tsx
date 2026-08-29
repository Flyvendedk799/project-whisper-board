import { useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusPill } from "@/components/app-shell";
import {
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABEL,
  TICKET_STATUSES,
  TICKET_STATUS_LABEL,
  TICKET_TYPES,
  TICKET_TYPE_LABEL,
} from "@/data/enums";
import { isFiltered, type TicketFilters } from "@/data/filters";
import type { PersonRef, ProjectWithOrg } from "@/data/types";

/**
 * Every control here edits the URL, not local state. That means a filtered
 * queue is a link you can send someone, the back button undoes a filter, and a
 * saved view is literally this object — no separate serialisation format.
 */

interface Props {
  filters: TicketFilters;
  onChange: (next: Partial<TicketFilters>) => void;
  projects: ProjectWithOrg[];
  people: PersonRef[];
}

function MultiSelect<T extends string>({
  label,
  values,
  selected,
  labels,
  onChange,
}: {
  label: string;
  values: readonly T[];
  selected: T[] | undefined;
  labels: Record<T, string>;
  onChange: (next: T[] | undefined) => void;
}) {
  const active = selected ?? [];

  const toggle = (value: T) => {
    const next = active.includes(value) ? active.filter((v) => v !== value) : [...active, value];
    onChange(next.length ? next : undefined);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant={active.length ? "secondary" : "outline"} size="sm" className="gap-1.5">
          {label}
          {active.length > 0 && <StatusPill>{active.length}</StatusPill>}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-1">
        <ul role="listbox" aria-label={label} aria-multiselectable="true">
          {values.map((value) => {
            const isSelected = active.includes(value);
            return (
              <li key={value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => toggle(value)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <Check
                    className={`h-3.5 w-3.5 ${isSelected ? "opacity-100" : "opacity-0"}`}
                    aria-hidden="true"
                  />
                  {labels[value]}
                </button>
              </li>
            );
          })}
        </ul>
        {active.length > 0 && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="mt-1 w-full rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
          >
            Clear
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function SingleSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | undefined;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T | undefined) => void;
}) {
  const current = options.find((o) => o.value === value);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant={value ? "secondary" : "outline"} size="sm" className="max-w-44 gap-1.5">
          <span className="truncate">{current ? current.label : label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-72 w-56 overflow-y-auto p-1">
        <ul role="listbox" aria-label={label}>
          {options.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                onClick={() => onChange(option.value === value ? undefined : option.value)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <Check
                  className={`h-3.5 w-3.5 shrink-0 ${option.value === value ? "opacity-100" : "opacity-0"}`}
                  aria-hidden="true"
                />
                <span className="truncate">{option.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function FilterBar({ filters, onChange, projects, people }: Props) {
  const [term, setTerm] = useState(filters.q ?? "");

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    onChange({ q: term.trim() || undefined });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
      <form onSubmit={submitSearch} className="relative min-w-48 flex-1">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search tickets…"
          aria-label="Search tickets"
          data-search-input
          className="h-9 pl-8 pr-8"
        />
        {term && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setTerm("");
              onChange({ q: undefined });
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </form>

      <MultiSelect
        label="Status"
        values={TICKET_STATUSES}
        selected={filters.status}
        labels={TICKET_STATUS_LABEL}
        onChange={(status) => onChange({ status })}
      />
      <MultiSelect
        label="Priority"
        values={TICKET_PRIORITIES}
        selected={filters.priority}
        labels={TICKET_PRIORITY_LABEL}
        onChange={(priority) => onChange({ priority })}
      />
      <MultiSelect
        label="Type"
        values={TICKET_TYPES}
        selected={filters.type}
        labels={TICKET_TYPE_LABEL}
        onChange={(type) => onChange({ type })}
      />

      <SingleSelect
        label="Project"
        value={filters.projectId}
        options={projects.map((p) => ({ value: p.id, label: p.title }))}
        onChange={(projectId) => onChange({ projectId })}
      />

      <SingleSelect
        label="Assignee"
        value={filters.assignee}
        options={[
          { value: "me", label: "Me" },
          { value: "unassigned", label: "Unassigned" },
          ...people.map((p) => ({ value: p.id, label: p.full_name ?? p.email ?? "Unknown" })),
        ]}
        onChange={(assignee) => onChange({ assignee })}
      />

      <SingleSelect
        label="SLA"
        value={filters.sla}
        options={[
          { value: "breached" as const, label: "Overdue" },
          { value: "at_risk" as const, label: "Due soon" },
          { value: "ok" as const, label: "On track" },
        ]}
        onChange={(sla) => onChange({ sla })}
      />

      <SingleSelect
        label="Sort"
        value={filters.sort}
        options={[
          { value: "updated" as const, label: "Recently updated" },
          { value: "sla" as const, label: "Most urgent" },
          { value: "newest" as const, label: "Newest" },
          { value: "oldest" as const, label: "Oldest" },
          { value: "priority" as const, label: "Priority" },
        ]}
        onChange={(sort) => onChange({ sort: sort ?? "updated" })}
      />

      {isFiltered(filters) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setTerm("");
            onChange({
              q: undefined,
              status: undefined,
              priority: undefined,
              type: undefined,
              projectId: undefined,
              assignee: undefined,
              reporter: undefined,
              labels: undefined,
              age: undefined,
              sla: undefined,
              awaiting: undefined,
              sort: "updated",
              view: undefined,
            });
          }}
        >
          Clear all
        </Button>
      )}
    </div>
  );
}
