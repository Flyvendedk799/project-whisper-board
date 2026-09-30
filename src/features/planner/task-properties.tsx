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
import type { PlanActions } from "./use-plan-actions";
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
    <div className="flex flex-col gap-1.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {children}
      {hint ? <div className="text-[11px] leading-snug text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

/** The right-hand pane of the drawer: status, people, ticket and GitHub. */
export function TaskProperties({
  task,
  planId,
  actions,
  createdBy,
}: {
  task: TaskWithAgent;
  planId: string;
  actions: PlanActions;
  createdBy?: string | null;
}) {
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

  return (
    <div className="flex flex-col gap-[18px]">
      <Field label="Status" hint={hint || undefined}>
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
      </Field>

      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Priority">
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
        </Field>
        <Field label="Size">
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
        </Field>
      </div>

      <Field label="Agent" hint="Agents claim tasks themselves through the API.">
        <div className="flex h-[38px] items-center gap-2 rounded-lg border bg-card px-3 text-[13px]">
          <span
            className={cn("flex-1 truncate", !task.assigned_agent_id && "text-muted-foreground")}
          >
            {task.assigned_agent_id
              ? (task.assigned_agent?.name ?? "Agent assigned")
              : "No agent yet"}
          </span>
          {task.assigned_agent_id ? (
            <button
              type="button"
              className="text-xs text-primary hover:underline disabled:opacity-50"
              disabled={actions.release.busy}
              onClick={() => actions.release.fire({ taskId: task.id })}
            >
              Release
            </button>
          ) : null}
        </div>
      </Field>

      <Field label="Person">
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
      </Field>

      <div className="h-px bg-border" />

      <Field label="Ticket">
        <div className="relative flex flex-col gap-2">
          {task.ticket ? (
            <div className="flex items-center gap-2 text-[13px]">
              <Link
                to="/app/tickets/$ticketId"
                params={{ ticketId: task.ticket.id }}
                search={{ from: "home" }}
                className="flex-1 leading-snug text-primary hover:underline"
              >
                #{task.ticket.ticket_number} {task.ticket.title}
              </Link>
              <button
                type="button"
                className="text-xs text-muted-foreground underline"
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
                className="h-9 bg-card text-[13px]"
              />
              {(tickets.data?.length ?? 0) > 0 ? (
                <ul className="absolute left-0 right-0 top-[42px] z-10 max-h-48 overflow-auto rounded-lg border bg-popover p-1 shadow-md">
                  {tickets.data!.slice(0, 5).map((ticket) => (
                    <li key={ticket.id}>
                      <button
                        type="button"
                        className="w-full truncate rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
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

      <Field label="GitHub">
        <Input
          {...branch.bind}
          placeholder="Branch: feat/…"
          aria-label="Branch"
          className="h-9 bg-card font-mono text-xs"
        />
        <div className="flex items-center gap-2 text-xs">
          {livePr ? (
            <a
              href={task.pr_url!}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "flex-1 hover:underline",
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
              className="text-primary hover:underline disabled:opacity-50"
              disabled={refreshPr.busy}
              onClick={() => refreshPr.fire({ taskId: task.id })}
            >
              {refreshPr.busy ? "Checking…" : "Refresh"}
            </button>
          ) : null}
        </div>
      </Field>

      <div className="h-px bg-border" />
      <div className="text-xs text-muted-foreground">
        Created{createdBy ? ` by ${createdBy}` : ""} · {timeAgo(task.created_at)}
      </div>
    </div>
  );
}
