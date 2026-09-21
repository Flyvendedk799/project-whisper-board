import { useState } from "react";
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
import { Bot, GitBranch } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useServerAction } from "@/lib/use-server-action";
import { updateTask } from "@/lib/planner.functions";
import { taskCommentsQuery } from "@/data/planner";
import { qk } from "@/data/keys";
import { workspacePeopleQuery } from "@/data/projects";

export function PlanTaskDrawer({
  taskId,
  planId,
  onClose,
}: {
  taskId: string | null;
  planId: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  // Use a query for comments if taskId is present
  const commentsQuery = useQuery(taskCommentsQuery(taskId || ""));
  const peopleQuery = useQuery(workspacePeopleQuery());

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
          <SheetTitle>Task Details</SheetTitle>
        </SheetHeader>

        {taskId && (
          <div className="mt-6 flex flex-1 flex-col gap-6">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => handleUpdate({ title })}
                placeholder="Task title"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select onValueChange={(val) => handleUpdate({ status: val })}>
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
                <Select onValueChange={(val) => handleUpdate({ priority: val })}>
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
                onBlur={() => handleUpdate({ description })}
                placeholder="Markdown supported..."
                rows={4}
              />
            </div>

            <div className="space-y-2">
              <Label>Acceptance Criteria</Label>
              <Textarea placeholder="List criteria separated by newlines..." rows={3} />
            </div>

            <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
              <h4 className="flex items-center gap-2 font-medium">
                <Bot className="h-4 w-4" /> Agent Assignment
              </h4>
              <div className="text-sm text-muted-foreground">
                {task.assigned_agent_id ? "Agent assigned." : "No agent assigned yet."}
              </div>
            </div>

            <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
              <h4 className="flex items-center gap-2 font-medium">
                Human Assignee
              </h4>
              <Select 
                value={task.assigned_user_id || "unassigned"}
                onValueChange={(val) => 
                  handleUpdate({ 
                    assignedUserId: val === "unassigned" ? null : val 
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a user" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {peopleQuery.data?.map(person => (
                    <SelectItem key={person.id} value={person.id}>
                      {person.full_name || person.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
              <h4 className="flex items-center gap-2 font-medium">
                Ticket Link
              </h4>
              <Input 
                placeholder="Paste Ticket ID..."
                defaultValue={task.ticket_id || ""}
                onBlur={(e) => {
                  const val = e.target.value.trim();
                  if (val !== task.ticket_id) {
                    handleUpdate({ ticketId: val || null });
                  }
                }}
              />
              {task.ticket && (
                <div className="text-sm text-muted-foreground mt-2">
                  Linked to Ticket #{task.ticket.ticket_number}: {task.ticket.title}
                </div>
              )}
            </div>

            <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
              <h4 className="flex items-center gap-2 font-medium">
                <GitBranch className="h-4 w-4" /> GitHub Connection
              </h4>
              <div className="text-sm text-muted-foreground">No branch or PR linked.</div>
            </div>

            <div className="mt-8 border-t pt-6">
              <h4 className="mb-4 font-medium">Comments</h4>
              {commentsQuery.data?.length ? (
                <div className="space-y-4">
                  {commentsQuery.data.map((comment: Record<string, unknown>) => (
                    <div key={comment.id} className="rounded-lg border p-3 text-sm">
                      <div className="mb-1 font-medium">{comment.author_name}</div>
                      <div>{comment.content}</div>
                    </div>
                  ))}
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
