import { forwardRef, useEffect, useState } from "react";
import { Check, ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
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
  labelOptions?: Array<{ name: string; color: string }>;
  /** Phone only: controls that sit beside the search box (e.g. the layout toggle). */
  mobileActions?: React.ReactNode;
  /** Phone only: a row under the search box that scrolls away (e.g. queue chips). */
  mobileRow?: React.ReactNode;
}

const SLA_OPTIONS: Array<{ value: NonNullable<TicketFilters["sla"]>; label: string }> = [
  { value: "breached", label: "Overdue" },
  { value: "at_risk", label: "Due soon" },
  { value: "ok", label: "On track" },
];

const SLA_LABEL: Record<NonNullable<TicketFilters["sla"]>, string> = {
  breached: "Overdue",
  at_risk: "Due soon",
  ok: "On track",
};

const SORT_OPTIONS: Array<{ value: NonNullable<TicketFilters["sort"]>; label: string }> = [
  { value: "updated", label: "Recently updated" },
  { value: "sla", label: "Most urgent" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "priority", label: "Priority" },
];

const CLEARED: Partial<TicketFilters> = {
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
};

/** How many filters are set, for the badge on the phone's Filters button. */
function activeFilterCount(filters: TicketFilters): number {
  const single = [
    filters.projectId,
    filters.assignee,
    filters.reporter,
    filters.age,
    filters.sla,
    filters.awaiting,
  ].filter((value) => value !== undefined).length;
  const multi = [filters.status, filters.priority, filters.type, filters.labels].filter(
    (value) => value && value.length > 0,
  ).length;
  return single + multi + (filters.sort !== "updated" ? 1 : 0);
}

/** The dropdown button the design uses: muted label, then the current choice. */
const FilterTrigger = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    current: string;
    active: boolean;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function FilterTrigger({ label, current, active, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={`flex h-[34px] max-w-56 items-center gap-1.5 rounded-lg border px-3 text-[13px] transition-colors ${
        active ? "border-primary bg-accent" : "bg-card hover:bg-muted"
      }`}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{current}</span>
      <ChevronDown className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
    </button>
  );
});

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
        <FilterTrigger
          label={label}
          active={active.length > 0}
          current={
            active.length === 0
              ? "Any"
              : active.length <= 2
                ? active.map((v) => labels[v]).join(", ")
                : `${active.length} selected`
          }
        />
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
        <FilterTrigger
          label={label}
          active={Boolean(value)}
          current={current ? current.label : "Any"}
        />
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

export function FilterBar({
  filters,
  onChange,
  projects,
  people,
  labelOptions = [],
  mobileActions,
  mobileRow,
}: Props) {
  const [term, setTerm] = useState(filters.q ?? "");

  // The URL is the source of truth: a view click or "Clear" resets the box.
  useEffect(() => setTerm(filters.q ?? ""), [filters.q]);

  // Search as you type, but not on every keystroke.
  useEffect(() => {
    const next = term.trim() || undefined;
    if (next === filters.q) return;
    const id = setTimeout(() => onChange({ q: next }), 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    onChange({ q: term.trim() || undefined });
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b bg-surface px-6 py-3 max-md:hidden">
        <form onSubmit={submitSearch} className="relative w-full min-w-48 sm:w-56">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search title or #number"
            aria-label="Search tickets"
            data-search-input
            className="h-[34px] rounded-lg bg-card pl-8 pr-8 text-[13px]"
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

        {labelOptions.length > 0 && (
          <MultiSelect
            label="Label"
            values={labelOptions.map((label) => label.name)}
            selected={filters.labels}
            labels={Object.fromEntries(labelOptions.map((label) => [label.name, label.name]))}
            onChange={(labels) => onChange({ labels })}
          />
        )}

        <SingleSelect
          label="SLA"
          value={filters.sla}
          options={SLA_OPTIONS}
          onChange={(sla) => onChange({ sla })}
        />

        <SingleSelect
          label="Sort"
          value={filters.sort}
          options={SORT_OPTIONS}
          onChange={(sort) => onChange({ sort: sort ?? "updated" })}
        />

        {isFiltered(filters) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-[34px] px-2 text-primary hover:text-primary"
            onClick={() => {
              setTerm("");
              onChange(CLEARED);
            }}
          >
            Clear
          </Button>
        )}
      </div>

      <MobileFilters
        filters={filters}
        onChange={onChange}
        projects={projects}
        people={people}
        labelOptions={labelOptions}
        term={term}
        setTerm={setTerm}
        onSubmit={submitSearch}
        actions={mobileActions}
      />
      {mobileRow}
    </>
  );
}

/**
 * Phone layout: one pinned row — search box, a Filters button with a count, and
 * whatever the page adds (layout toggle) — and every filter inside a bottom
 * sheet as large tappable chips, instead of a wall of dropdowns.
 */
function MobileFilters({
  filters,
  onChange,
  projects,
  people,
  labelOptions,
  term,
  setTerm,
  onSubmit,
  actions,
}: Omit<Props, "mobileActions" | "mobileRow"> & {
  labelOptions: Array<{ name: string; color: string }>;
  term: string;
  setTerm: (term: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  actions?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const count = activeFilterCount(filters);

  return (
    <div className="sticky top-[var(--mobile-topbar-h)] z-20 flex h-[3.75rem] items-center gap-2 border-b bg-background/95 px-4 backdrop-blur md:hidden">
      <form onSubmit={onSubmit} role="search" className="relative min-w-0 flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search title or #number"
          aria-label="Search tickets"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          className="rounded-lg bg-card pl-9 pr-11"
        />
        {term && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setTerm("");
              onChange({ q: undefined });
            }}
            className="absolute right-0 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center text-muted-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </form>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            aria-label={count ? `Filters, ${count} active` : "Filters"}
            className={`relative shrink-0 gap-1.5 px-3 ${count ? "border-primary bg-accent" : "bg-card"}`}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            <span className="text-sm">Filters</span>
            {count > 0 && (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-semibold tabular-nums text-primary-foreground">
                {count}
              </span>
            )}
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="flex flex-col gap-0 overflow-hidden p-0">
          <SheetHeader className="border-b px-5 pb-3 pt-9 text-left">
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription className="sr-only">
              Narrow the queue. Changes apply straight away.
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-4">
            <ChipGroup
              label="Status"
              values={TICKET_STATUSES}
              selected={filters.status}
              labels={TICKET_STATUS_LABEL}
              onChange={(status) => onChange({ status })}
            />
            <ChipGroup
              label="Priority"
              values={TICKET_PRIORITIES}
              selected={filters.priority}
              labels={TICKET_PRIORITY_LABEL}
              onChange={(priority) => onChange({ priority })}
            />
            <ChipGroup
              label="Type"
              values={TICKET_TYPES}
              selected={filters.type}
              labels={TICKET_TYPE_LABEL}
              onChange={(type) => onChange({ type })}
            />
            <ChipGroup
              label="SLA"
              single
              values={SLA_OPTIONS.map((o) => o.value)}
              selected={filters.sla ? [filters.sla] : undefined}
              labels={SLA_LABEL}
              onChange={(next) => onChange({ sla: next?.[0] })}
            />
            {labelOptions.length > 0 && (
              <ChipGroup
                label="Label"
                values={labelOptions.map((label) => label.name)}
                selected={filters.labels}
                labels={Object.fromEntries(labelOptions.map((label) => [label.name, label.name]))}
                onChange={(labels) => onChange({ labels })}
              />
            )}

            <NativeSelect
              label="Project"
              value={filters.projectId}
              options={projects.map((p) => ({ value: p.id, label: p.title }))}
              onChange={(projectId) => onChange({ projectId })}
            />
            <NativeSelect
              label="Assignee"
              value={filters.assignee}
              options={[
                { value: "me", label: "Me" },
                { value: "unassigned", label: "Unassigned" },
                ...people.map((p) => ({
                  value: p.id,
                  label: p.full_name ?? p.email ?? "Unknown",
                })),
              ]}
              onChange={(assignee) => onChange({ assignee })}
            />
            <NativeSelect
              label="Sort by"
              value={filters.sort}
              options={SORT_OPTIONS}
              anyLabel={null}
              onChange={(sort) => onChange({ sort: sort ?? "updated" })}
            />
          </div>

          <div className="flex gap-3 border-t bg-background px-5 pb-[calc(0.75rem+var(--safe-bottom))] pt-3">
            <Button
              variant="outline"
              className="flex-1"
              disabled={!isFiltered(filters)}
              onClick={() => {
                setTerm("");
                onChange(CLEARED);
              }}
            >
              Clear all
            </Button>
            <Button className="flex-1" onClick={() => setOpen(false)}>
              Show results
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {actions}
    </div>
  );
}

function ChipGroup<T extends string>({
  label,
  values,
  selected,
  labels,
  onChange,
  single = false,
}: {
  label: string;
  values: readonly T[];
  selected: T[] | undefined;
  labels: Record<T, string>;
  onChange: (next: T[] | undefined) => void;
  single?: boolean;
}) {
  const active = selected ?? [];

  const toggle = (value: T) => {
    const isOn = active.includes(value);
    const next = single
      ? isOn
        ? []
        : [value]
      : isOn
        ? active.filter((v) => v !== value)
        : [...active, value];
    onChange(next.length ? next : undefined);
  };

  return (
    <fieldset>
      <legend className="mb-2 text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </legend>
      <div className="flex flex-wrap gap-2">
        {values.map((value) => {
          const on = active.includes(value);
          return (
            <button
              key={value}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(value)}
              className={`flex h-10 max-w-full items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors ${
                on ? "border-primary bg-accent font-medium" : "bg-card"
              }`}
            >
              {on && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
              <span className="truncate">{labels[value]}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** A long list (every project, every person) is better in the OS's own picker. */
function NativeSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  anyLabel = "Any",
}: {
  label: string;
  value: T | undefined;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T | undefined) => void;
  anyLabel?: string | null;
}) {
  const id = `filter-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-2 block text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground"
      >
        {label}
      </label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange((e.target.value || undefined) as T | undefined)}
        className="h-11 w-full rounded-lg border bg-card px-3 text-base"
      >
        {anyLabel !== null && <option value="">{anyLabel}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
