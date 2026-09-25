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
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => {
                  if (title.trim() && title !== task.title) handleUpdate({ title: title.trim() });
                }}
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
                placeholder="Markdown supported…"
                rows={4}
              />
            </div>

            <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
              <h4 className="flex items-center gap-2 font-medium">
                <Bot className="h-4 w-4" /> Agent assignment
              </h4>
              <div className="text-sm text-muted-foreground">
                {task.assigned_agent_id
                  ? (task.assigned_agent?.name ?? "Agent assigned.")
                  : "No agent assigned yet."}
              </div>
            </div>

            <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
              <h4 className="font-medium">Human assignee</h4>
              <Select
                value={task.assigned_user?.id || "unassigned"}
                onValueChange={(val) =>
                  handleUpdate({
                    assignedUserId: val === "unassigned" ? null : val,
                  })
                }
              >
                <SelectTrigger>
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

            <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
              <h4 className="font-medium">Ticket link</h4>
              {task.ticket ? (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <Link
                    to="/app/tickets/$ticketId"
                    params={{ ticketId: task.ticket.id }}
                    className="underline underline-offset-2"
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
                  <p className="text-muted-foreground">
                    This task pointed at a ticket that is gone. Clear the link so it stops looking
                    resolved.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={update.busy}
                    onClick={() => handleUpdate({ ticketId: null })}
                  >
                    Clear broken link
                  </Button>
                </div>
              ) : (
                <>
                  <Input
                    placeholder="Search tickets…"
                    value={ticketTerm}
                    onChange={(e) => setTicketTerm(e.target.value)}
                  />
                  {(tickets.data?.length ?? 0) > 0 && (
                    <ul className="max-h-40 space-y-1 overflow-auto">
                      {tickets.data!.map((ticket) => (
                        <li key={ticket.id}>
                          <button
                            type="button"
                            className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
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
                </>
              )}
            </div>

            <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
              <h4 className="flex items-center gap-2 font-medium">
                <GitBranch className="h-4 w-4" /> GitHub connection
              </h4>
              <div className="space-y-2">
                <Label htmlFor="task-branch">Branch</Label>
                <Input
                  id="task-branch"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  onBlur={() => {
                    if (branchName !== (task.branch_name ?? "")) {
                      handleUpdate({ branchName: branchName.trim() || undefined });
                    }
                  }}
                  placeholder="feature/…"
                />
              </div>
              {hasLivePullRequest(task) ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
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
                    variant="outline"
                    size="sm"
                    className="h-7"
                    disabled={refreshPr.busy}
                    onClick={() => refreshPr.fire({ taskId: task.id })}
                  >
                    <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                    Refresh
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No pull request linked yet.</p>
              )}
            </div>

            <div className="mt-8 border-t pt-6">
              <h4 className="mb-4 font-medium">Comments</h4>
              {Array.isArray(commentsQuery.data?.comments) &&
              commentsQuery.data.comments.length > 0 ? (
                <div className="mb-4 space-y-4">
                  {commentsQuery.data.comments.map((entry) => {
                    const author = entry.author as { full_name?: string | null } | null | undefined;
                    return (
                      <div key={entry.id} className="rounded-lg border p-3 text-sm">
                        <div className="mb-1 font-medium">{author?.full_name ?? "Someone"}</div>
                        <div>{entry.body}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mb-4 text-sm text-muted-foreground">No comments yet.</div>
              )}
              <form
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!taskId || !commentBody.trim()) return;
                  comment.fire({ taskId, body: commentBody.trim() });
                }}
              >
                <Textarea
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  placeholder="Leave a note for agents or teammates…"
                  rows={3}
                />
                <Button type="submit" size="sm" disabled={comment.busy || !commentBody.trim()}>
                  {comment.busy ? "Posting…" : "Add comment"}
                </Button>
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
