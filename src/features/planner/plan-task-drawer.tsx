import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bot, GitBranch } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/components/auth-provider";
import { useServerAction } from "@/lib/use-server-action";
import { updateTask } from "@/lib/planner.functions";
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
  const [ticketTerm, setTicketTerm] = useState("");
  const [debouncedTicket, setDebouncedTicket] = useState("");

  useEffect(() => {
    if (!task) return;
    setTitle(task.title ?? "");
    setDescription(task.description ?? "");
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

            <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
              <h4 className="flex items-center gap-2 font-medium">
                <GitBranch className="h-4 w-4" /> GitHub connection
              </h4>
              <div className="text-sm text-muted-foreground">
                {task.branch_name ? `Branch ${task.branch_name}` : "No branch or PR linked."}
              </div>
            </div>

            <div className="mt-8 border-t pt-6">
              <h4 className="mb-4 font-medium">Comments</h4>
              {Array.isArray(commentsQuery.data?.comments) &&
              commentsQuery.data.comments.length > 0 ? (
                <div className="space-y-4">
                  {commentsQuery.data.comments.map((comment) => {
                    const author = comment.author as
                      | { full_name?: string | null }
                      | null
                      | undefined;
                    return (
                      <div key={comment.id} className="rounded-lg border p-3 text-sm">
                        <div className="mb-1 font-medium">{author?.full_name ?? "Someone"}</div>
                        <div>{comment.body}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No comments yet.</div>
              )}
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
