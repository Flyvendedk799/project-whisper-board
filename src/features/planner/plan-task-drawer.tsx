import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bot, GitBranch, RefreshCw } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/components/auth-provider";
import { useServerAction } from "@/lib/use-server-action";
import { addTaskComment, updateTask } from "@/lib/planner.functions";
import { refreshTaskPullRequest } from "@/lib/github.functions";
import { hasLivePullRequest, isOrphanTicketRef } from "@/lib/plan-refs";
import { planDetailQuery, taskCommentsQuery } from "@/data/planner";
import { ticketSearchQuery } from "@/data/tickets";
import { workspacePeopleQuery } from "@/data/projects";
import { qk } from "@/data/keys";
import type { TaskWithAgent } from "@/data";

export function PlanTaskDrawer({
  taskId,
  planId,
  onClose,
}: {
  taskId: string | null;
  planId: string;
  onClose: () => void;
}) {
  const { workspaceId } = useAuth();
  const planQuery = useQuery(planDetailQuery(planId));
  const commentsQuery = useQuery(taskCommentsQuery(taskId || ""));
  const peopleQuery = useQuery(workspacePeopleQuery(workspaceId));

  const task = useMemo(() => {
    if (!taskId || !planQuery.data?.plan) return null;
    const plan = planQuery.data.plan as unknown as {
      sections?: Array<{ tasks?: TaskWithAgent[] }>;
    };
    for (const section of plan.sections ?? []) {
      const found = (section.tasks ?? []).find((t) => t.id === taskId);
      if (found) return found;
    }
    return null;
  }, [planQuery.data, taskId]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [branchName, setBranchName] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [ticketTerm, setTicketTerm] = useState("");
  const [debouncedTicket, setDebouncedTicket] = useState("");

  useEffect(() => {
    if (!task) return;
    setTitle(task.title ?? "");
    setDescription(task.description ?? "");
    setBranchName(task.branch_name ?? "");
  }, [task]);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedTicket(ticketTerm.trim()), 180);
    return () => clearTimeout(id);
  }, [ticketTerm]);

  const tickets = useQuery({
    ...ticketSearchQuery(debouncedTicket, workspaceId),
    enabled: Boolean(workspaceId) && debouncedTicket.length >= 2,
  });

  const update = useServerAction(useServerFn(updateTask), {
    label: "tasks.update",
    invalidate: [qk.plan(planId), qk.taskComments(taskId || "")],
  });
  const refreshPr = useServerAction(useServerFn(refreshTaskPullRequest), {
    label: "github.refreshPullRequest",
    success: (result) => `PR is ${result.state}`,
    invalidate: [qk.plan(planId)],
  });
  const comment = useServerAction(useServerFn(addTaskComment), {
    label: "comments.add",
    success: "Comment added",
    invalidate: [qk.taskComments(taskId || "")],
    onSuccess: () => setCommentBody(""),
  });

  const handleUpdate = (fields: Record<string, unknown>) => {
    if (!taskId) return;
    update.fire({ taskId, ...fields });
  };

  return (
    <Sheet open={!!taskId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Task details</SheetTitle>
        </SheetHeader>

        {taskId && !task && <p className="mt-6 text-sm text-muted-foreground">Loading task…</p>}

        {task && (
          <div className="mt-6 flex flex-1 flex-col gap-6">
            <div className="-mx-2">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => {
                  if (title.trim() && title !== task.title) handleUpdate({ title: title.trim() });
                }}
                className="border-transparent bg-transparent px-2 text-xl font-semibold shadow-none focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted/50"
                placeholder="Task title"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={task.status ?? "available"}
                  onValueChange={(val) => handleUpdate({ status: val })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="available">Available</SelectItem>
                    <SelectItem value="claimed">Claimed</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="in_review">In Review</SelectItem>
                    <SelectItem value="done">Done</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select
                  value={task.priority ?? "medium"}
                  onValueChange={(val) => handleUpdate({ priority: val })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => {
                  if (description !== (task.description ?? "")) {
                    handleUpdate({ description });
                  }
                }}
                className="min-h-[120px] bg-muted/30 font-mono text-sm leading-relaxed"
                placeholder="Markdown supported… Add details for the agent or developer."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Agent assignee</Label>
                <div className="flex h-10 items-center gap-2 rounded-md border bg-muted/30 px-3 text-sm">
                  {task.assigned_agent_id ? (
                    <>
                      <Bot className="h-4 w-4 text-primary" />
                      <span>{task.assigned_agent?.name ?? "Agent assigned"}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">No agent</span>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Human assignee</Label>
                <Select
                  value={task.assigned_user?.id || "unassigned"}
                  onValueChange={(val) =>
                    handleUpdate({
                      assignedUserId: val === "unassigned" ? null : val,
                    })
                  }
                >
                  <SelectTrigger className="bg-muted/30">
                    <SelectValue placeholder="Select a user" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {peopleQuery.data?.map((person) => (
                      <SelectItem key={person.id} value={person.id}>
                        {person.full_name || person.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                <h4 className="font-medium text-sm">Ticket link</h4>
                {task.ticket ? (
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <Link
                      to="/app/tickets/$ticketId"
                      params={{ ticketId: task.ticket.id }}
                      className="underline underline-offset-2 truncate"
                    >
                      #{task.ticket.ticket_number}: {task.ticket.title}
                    </Link>
                    <ButtonLikeUnlink
                      onClick={() => handleUpdate({ ticketId: null })}
                      busy={update.busy}
                    />
                  </div>
                ) : isOrphanTicketRef(task) ? (
                  <div className="space-y-2 text-sm">
                    <p className="text-muted-foreground text-xs">Linked ticket is gone.</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={update.busy}
                      onClick={() => handleUpdate({ ticketId: null })}
                    >
                      Clear broken link
                    </Button>
                  </div>
                ) : (
                  <div className="relative">
                    <Input
                      placeholder="Search tickets…"
                      value={ticketTerm}
                      onChange={(e) => setTicketTerm(e.target.value)}
                      className="h-8 text-xs bg-background"
                    />
                    {(tickets.data?.length ?? 0) > 0 && (
                      <ul className="max-h-40 space-y-1 overflow-auto bg-background border rounded-md p-1 shadow-sm absolute top-full left-0 mt-1 z-10 w-full">
                        {tickets.data!.map((ticket) => (
                          <li key={ticket.id}>
                            <button
                              type="button"
                              className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent truncate"
                              onClick={() => {
                                handleUpdate({ ticketId: ticket.id });
                                setTicketTerm("");
                              }}
                            >
                              #{ticket.ticket_number} · {ticket.title}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                <h4 className="flex items-center gap-2 font-medium text-sm">
                  <GitBranch className="h-3.5 w-3.5" /> GitHub
                </h4>
                <div className="space-y-1.5">
                  <Input
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    onBlur={() => {
                      if (branchName !== (task.branch_name ?? "")) {
                        handleUpdate({ branchName: branchName.trim() || undefined });
                      }
                    }}
                    className="h-8 text-xs bg-background"
                    placeholder="Branch: feature/…"
                  />
                </div>
                {hasLivePullRequest(task) ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <a
                      href={task.pr_url!}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      PR #{task.pr_number}
                      {task.pr_status ? ` · ${task.pr_status}` : ""}
                    </a>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      disabled={refreshPr.busy}
                      onClick={() => refreshPr.fire({ taskId: task.id })}
                    >
                      <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
                      Refresh
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No PR linked yet.</p>
                )}
              </div>
            </div>

            <div className="mt-8 border-t pt-6">
              <h4 className="mb-4 font-medium">Activity & Comments</h4>
              {Array.isArray(commentsQuery.data?.comments) &&
              commentsQuery.data.comments.length > 0 ? (
                <div className="mb-6 space-y-4">
                  {commentsQuery.data.comments.map((entry) => {
                    const author = entry.author as { full_name?: string | null } | null | undefined;
                    const agent = entry.agent as { name?: string | null } | null | undefined;
                    const isAgent = Boolean(agent);
                    const name = agent?.name ?? author?.full_name ?? "Someone";

                    return (
                      <div
                        key={entry.id}
                        className={`flex gap-3 text-sm ${isAgent ? "flex-row-reverse" : ""}`}
                      >
                        <div
                          className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${isAgent ? "bg-primary/20 text-primary" : "bg-muted"}`}
                        >
                          {isAgent ? <Bot className="h-4 w-4" /> : name.charAt(0)}
                        </div>
                        <div
                          className={`flex max-w-[85%] flex-col gap-1 ${isAgent ? "items-end" : "items-start"}`}
                        >
                          <div className="text-xs font-medium text-muted-foreground">{name}</div>
                          <div
                            className={`rounded-2xl px-4 py-2 text-left ${isAgent ? "bg-primary/10 rounded-tr-sm" : "bg-muted rounded-tl-sm"}`}
                          >
                            <div className="whitespace-pre-wrap leading-relaxed">{entry.body}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mb-6 text-sm text-muted-foreground">
                  No comments or agent activity yet.
                </div>
              )}
              <form
                className="flex items-start gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!taskId || !commentBody.trim()) return;
                  comment.fire({ taskId, body: commentBody.trim() });
                }}
              >
                <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                  U
                </div>
                <div className="flex-1 space-y-2">
                  <Textarea
                    value={commentBody}
                    onChange={(e) => setCommentBody(e.target.value)}
                    placeholder="Leave a note for agents or teammates…"
                    className="min-h-[80px] resize-y bg-background"
                  />
                  <div className="flex justify-end">
                    <Button type="submit" size="sm" disabled={comment.busy || !commentBody.trim()}>
                      {comment.busy ? "Posting…" : "Add comment"}
                    </Button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ButtonLikeUnlink({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      className="text-xs text-muted-foreground underline"
      disabled={busy}
      onClick={onClick}
    >
      Unlink
    </button>
  );
}
