import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useAuth } from "@/components/auth-provider";
import { useServerAction } from "@/lib/use-server-action";
import { createPlanFromTickets } from "@/lib/planner.functions";
import { qk } from "@/data/keys";

export function CreatePlanFromTicketsDialog({
  open,
  onOpenChange,
  ticketIds,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticketIds: string[];
  onCreated?: () => void;
}) {
  const { workspaceId } = useAuth();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const create = useServerAction(useServerFn(createPlanFromTickets), {
    label: "plans.createFromTickets",
    success: (result) => `${result.count} tickets added to a new plan`,
    invalidate: [qk.plans()],
    onSuccess: (result) => {
      onOpenChange(false);
      onCreated?.();
      setTitle("");
      void navigate({ to: "/app/planner/$planId", params: { planId: result.id }, search: {} });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create plan from tickets</DialogTitle>
          <DialogDescription>
            {ticketIds.length} selected ticket{ticketIds.length === 1 ? "" : "s"}. Tickets from
            different projects become sections in one plan.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!workspaceId || !title.trim()) return;
            create.fire({ workspaceId, title: title.trim(), ticketIds });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="selected-plan-title">Plan title</Label>
            <Input
              id="selected-plan-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              required
              placeholder="What should this work deliver?"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={create.busy || !workspaceId || !ticketIds.length || !title.trim()}
            >
              {create.busy ? "Creating…" : "Create plan"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
