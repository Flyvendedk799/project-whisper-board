import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/components/auth-provider";
import type { PlanTaskComplexity, PlanTaskPriority, PlanTaskStatus, TaskWithAgent } from "@/data";
import { qk } from "@/data/keys";
import { workspacePeopleQuery } from "@/data/projects";
import { ticketSearchQuery } from "@/data/tickets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { refreshTaskPullRequest } from "@/lib/github.functions";
import { hasLivePullRequest, isOrphanTicketRef } from "@/lib/plan-refs";
import { useServerAction } from "@/lib/use-server-action";
import { cn } from "@/lib/utils";
import {
  PRIORITY_STYLE,
  STATUS_STYLE,
  statusHint,
  TASK_COMPLEXITIES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  timeAgo,
} from "./plan-model";
import type { WorkTarget } from "@/lib/plan-fields";
import { ColorPicker } from "./color-picker";
import { CopyIdButton } from "./copy-id-button";
import { TagEditor } from "./tag-editor";
import type { PlanActions } from "./use-plan-actions";
import { useNarrowViewport } from "./use-narrow-viewport";
import { useSyncedField } from "./use-synced-field";

const PR_TONE: Record<string, string> = {
  open: "text-success",
  draft: "text-muted-foreground",
  merged: "text-chart-5",
  closed: "text-destructive",
};

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 max-md:min-w-0">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {children}
      {hint ? (
        <div className="text-[11px] leading-snug text-muted-foreground max-md:text-xs">{hint}</div>
      ) : null}
    </div>
  );
}

/** The right-hand pane of the drawer: status, people, ticket and GitHub. */
export function TaskProperties({
  task,
  planId,
  actions,
  createdBy,
  tagSuggestions = [],
  work,
  variant = "pane",
}: {
  task: TaskWithAgent;
  planId: string;
  actions: PlanActions;
  createdBy?: string | null;
  /** Tags already used on the plan, offered while typing. */
  tagSuggestions?: readonly string[];
  /** Where the plan says work happens, so the branch field can say so. */
  work?: WorkTarget;
  /**
   * "pane" is the desktop sidebar with everything in it. On a phone the drawer
   * splits it: "summary" (status, priority, size, person) sits under the
   * title and "details" (everything else) sits above the notes.
   */
  variant?: "pane" | "summary" | "details";
}) {
  const narrow = useNarrowViewport();
  const { workspaceId } = useAuth();
  const people = useQuery(workspacePeopleQuery(workspaceId));
  const [ticketTerm, setTicketTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(ticketTerm.trim()), 180);
    return () => clearTimeout(id);
  }, [ticketTerm]);
  const tickets = useQuery({
    ...ticketSearchQuery(debounced, workspaceId),
    enabled: Boolean(workspaceId) && debounced.length >= 2,
  });

  const refreshPr = useServerAction(useServerFn(refreshTaskPullRequest), {
    label: "github.refreshPullRequest",
    success: (result) => `PR #${result.number} is ${result.state}`,
    invalidate: [qk.plan(planId)],
  });

  const branch = useSyncedField(task.branch_name ?? "", (value) =>
    actions.patchTask(task, { branchName: value.trim() }, { branch_name: value.trim() || null }),
  );

  const status = (task.status ?? "available") as PlanTaskStatus;
  const hint = statusHint(status);
  const livePr = hasLivePullRequest(task);

  const statusSelect = (
    <Select
      value={status}
      onValueChange={(value) => actions.setStatus(task, value as PlanTaskStatus)}
    >
      <SelectTrigger aria-label="Status" className="h-[38px] bg-card text-[13px]">
        <span className="flex items-center gap-2">
          <span className={cn("h-[9px] w-[9px] rounded-full", STATUS_STYLE[status].dot)} />
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        {TASK_STATUSES.map((value) => (
          <SelectItem key={value} value={value}>
            {STATUS_STYLE[value].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const prioritySelect = (
    <Select
      value={task.priority ?? "medium"}
      onValueChange={(value) =>
        actions.patchTask(
          task,
          { priority: value as PlanTaskPriority },
          { priority: value as PlanTaskPriority },
        )
      }
    >
      <SelectTrigger aria-label="Priority" className="h-[38px] bg-card text-[13px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TASK_PRIORITIES.slice()
          .reverse()
          .map((value) => (
            <SelectItem key={value} value={value}>
              {PRIORITY_STYLE[value].label}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );

  const sizeSelect = (
    <Select
      value={task.complexity ?? "none"}
      onValueChange={(value) => {
        const next = value === "none" ? null : (value as PlanTaskComplexity);
        actions.patchTask(task, { complexity: next }, { complexity: next });
      }}
    >
      <SelectTrigger aria-label="Size" className="h-[38px] bg-card text-[13px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Not sized</SelectItem>
        {TASK_COMPLEXITIES.map((value) => (
          <SelectItem key={value} value={value}>
            {value[0].toUpperCase() + value.slice(1)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const personSelect = (
    <Select
      value={task.assigned_user_id ?? "unassigned"}
      onValueChange={(value) => {
        const id = value === "unassigned" ? null : value;
        actions.patchTask(
          task,
          { assignedUserId: id },
          {
            assigned_user_id: id,
            assigned_user: id
              ? (people.data?.find((p) => p.id === id) ?? task.assigned_user ?? null)
              : null,
          },
        );
      }}
    >
      <SelectTrigger aria-label="Person" className="h-[38px] bg-card text-[13px]">
        <SelectValue placeholder="Unassigned" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="unassigned">Unassigned</SelectItem>
        {task.assigned_user &&
        !(people.data ?? []).some((person) => person.id === task.assigned_user?.id) ? (
          <SelectItem value={task.assigned_user.id}>
            {task.assigned_user.full_name || task.assigned_user.email}
          </SelectItem>
        ) : null}
        {(people.data ?? []).map((person) => (
          <SelectItem key={person.id} value={person.id}>
            {person.full_name || person.email}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const colourField = (
    <Field label="Colour">
      <ColorPicker
        label="Task colour"
        value={task.color}
        onChange={(color) => actions.patchTask(task, { color }, { color })}
      />
    </Field>
  );

  const tagsField = (
    <Field label="Tags">
      <TagEditor
        label="Task tags"
        tags={task.labels ?? []}
        suggestions={tagSuggestions}
        onChange={(labels) => actions.patchTask(task, { labels }, { labels })}
      />
    </Field>
  );

  const agentField = (
    <Field label="Agent" hint="Agents claim tasks themselves through the API.">
      <div className="flex h-[38px] items-center gap-2 rounded-lg border bg-card px-3 text-[13px] max-md:min-h-11 max-md:text-sm">
        <span className={cn("flex-1 truncate", !task.assigned_agent_id && "text-muted-foreground")}>
          {task.assigned_agent_id
            ? (task.assigned_agent?.name ?? "Agent assigned")
            : "No agent yet"}
        </span>
        {task.assigned_agent_id ? (
          <button
            type="button"
            className="text-xs text-primary hover:underline disabled:opacity-50 max-md:-mr-2 max-md:min-h-11 max-md:px-3 max-md:text-sm"
            disabled={actions.release.busy}
            onClick={() => actions.release.fire({ taskId: task.id })}
          >
            Release
          </button>
        ) : null}
      </div>
    </Field>
  );

  const ticketField = (
    <Field label="Ticket">
      <div className="relative flex flex-col gap-2">
        {task.ticket ? (
          <div className="flex items-center gap-2 text-[13px] max-md:text-sm">
            <Link
              to="/app/tickets/$ticketId"
              params={{ ticketId: task.ticket.id }}
              search={{ from: "home" }}
              className="flex-1 leading-snug text-primary hover:underline max-md:min-w-0 max-md:break-words max-md:py-2"
            >
              #{task.ticket.ticket_number} {task.ticket.title}
            </Link>
            <button
              type="button"
              className="text-xs text-muted-foreground underline max-md:min-h-11 max-md:px-3 max-md:text-sm"
              onClick={() =>
                actions.patchTask(task, { ticketId: null }, { ticket_id: null, ticket: null })
              }
            >
              Unlink
            </button>
          </div>
        ) : isOrphanTicketRef(task) ? (
          <>
            <p className="text-xs text-muted-foreground">The linked ticket no longer exists.</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 self-start text-xs"
              onClick={() => actions.patchTask(task, { ticketId: null }, { ticket_id: null })}
            >
              Clear broken link
            </Button>
          </>
        ) : (
          <>
            <Input
              value={ticketTerm}
              onChange={(event) => setTicketTerm(event.target.value)}
              placeholder="Search tickets to link"
              aria-label="Search tickets to link"
              autoComplete="off"
              enterKeyHint="search"
              className="h-9 bg-card text-[13px]"
            />
            {(tickets.data?.length ?? 0) > 0 ? (
              <ul className="absolute left-0 right-0 top-[42px] z-10 max-h-48 overflow-auto rounded-lg border bg-popover p-1 shadow-md max-md:top-[48px] max-md:max-h-64 max-md:overscroll-contain">
                {tickets.data!.slice(0, 5).map((ticket) => (
                  <li key={ticket.id}>
                    <button
                      type="button"
                      className="w-full truncate rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent max-md:min-h-11 max-md:px-3 max-md:text-sm"
                      onClick={() => {
                        actions.patchTask(task, { ticketId: ticket.id });
                        setTicketTerm("");
                      }}
                    >
                      #{ticket.ticket_number} · {ticket.title}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>
    </Field>
  );

  const githubField = (
    <Field label="GitHub">
      <Input
        {...branch.bind}
        onKeyDown={(event) => {
          if (narrow && event.key === "Enter") event.currentTarget.blur();
        }}
        placeholder={work?.workOn ? `Plan branch: ${work.workOn}` : "Branch: feat/…"}
        aria-label="Branch"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        className="h-9 bg-card font-mono text-xs"
      />
      {work?.repo ? (
        <p className="text-[11px] leading-snug text-muted-foreground max-md:text-xs">
          {work.summary} Leave the branch empty to use it.
        </p>
      ) : null}
      <div className="flex items-center gap-2 text-xs max-md:text-sm">
        {livePr ? (
          <a
            href={task.pr_url!}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "flex-1 hover:underline max-md:py-2.5",
              PR_TONE[task.pr_status ?? "open"] ?? PR_TONE.open,
            )}
          >
            PR #{task.pr_number}
            {task.pr_status ? ` · ${task.pr_status}` : ""}
          </a>
        ) : (
          <span className="flex-1 text-muted-foreground">No PR linked yet</span>
        )}
        {livePr ? (
          <button
            type="button"
            className="text-primary hover:underline disabled:opacity-50 max-md:-mr-3 max-md:min-h-11 max-md:px-3"
            disabled={refreshPr.busy}
            onClick={() => refreshPr.fire({ taskId: task.id })}
          >
            {refreshPr.busy ? "Checking…" : "Refresh"}
          </button>
        ) : null}
      </div>
    </Field>
  );

  const footer = (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground max-md:flex-wrap">
      <span className="flex-1 max-md:basis-full">
        Created{createdBy ? ` by ${createdBy}` : ""} · {timeAgo(task.created_at)}
      </span>
      <span className="font-mono">{task.id.slice(0, 8)}</span>
      <CopyIdButton id={task.id} label="task" />
    </div>
  );

  if (variant === "summary") {
    return (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">{statusSelect}</Field>
          <Field label="Priority">{prioritySelect}</Field>
          <Field label="Size">{sizeSelect}</Field>
          <Field label="Person">{personSelect}</Field>
        </div>
        {hint ? <p className="text-xs leading-snug text-muted-foreground">{hint}</p> : null}
      </div>
    );
  }

  if (variant === "details") {
    return (
      <div className="flex flex-col gap-5 rounded-2xl border bg-surface p-4">
        {colourField}
        {tagsField}
        {agentField}
        <div className="h-px bg-border" />
        {ticketField}
        {githubField}
        <div className="h-px bg-border" />
        {footer}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[18px]">
      <Field label="Status" hint={hint || undefined}>
        {statusSelect}
      </Field>

      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Priority">{prioritySelect}</Field>
        <Field label="Size">{sizeSelect}</Field>
      </div>

      {colourField}
      {tagsField}
      {agentField}

      <Field label="Person">{personSelect}</Field>

      <div className="h-px bg-border" />

      {ticketField}
      {githubField}

      <div className="h-px bg-border" />
      {footer}
    </div>
  );
}
