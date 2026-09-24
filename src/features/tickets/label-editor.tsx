import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/components/auth-provider";
import { useDataMutation, useServerAction } from "@/lib/use-server-action";
import { updateTicket } from "@/lib/tickets.functions";
import { upsertWorkspaceLabel } from "@/data/mutations";
import { workspaceLabelsQuery } from "@/data/labels";
import { qk } from "@/data/keys";
import type { TicketDetail } from "@/data/types";

export function LabelEditor({ ticket }: { ticket: TicketDetail }) {
  const { workspaceId } = useAuth();
  const labels = useQuery(workspaceLabelsQuery(workspaceId));
  const [value, setValue] = useState("");
  const palette = labels.data ?? [];

  const update = useServerAction(useServerFn(updateTicket), {
    label: "tickets.labels",
    invalidate: [qk.ticket(ticket.id), qk.tickets()],
  });
  const remember = useDataMutation("workspace_labels.upsert", upsertWorkspaceLabel, {
    invalidate: [qk.labels(workspaceId ?? undefined)],
  });

  const apply = (next: string[]) => {
    update.fire({ ticketId: ticket.id, labels: next });
  };

  const add = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed || !workspaceId) return;
    const existing = palette.find((label) => label.name.toLowerCase() === trimmed.toLowerCase());
    const name = existing?.name ?? trimmed.slice(0, 40);
    if (!ticket.labels.includes(name)) apply([...ticket.labels, name]);
    if (!existing) {
      remember.fire({ workspaceId, name, color: "#64748b" });
    }
    setValue("");
  };

  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-medium">Labels</h2>
      <div className="flex flex-wrap gap-1.5">
        {ticket.labels.length === 0 && <p className="text-xs text-muted-foreground">None yet.</p>}
        {ticket.labels.map((label) => {
          const known = palette.find((row) => row.name === label);
          return (
            <span
              key={label}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: known?.color ?? "#64748b" }}
                aria-hidden
              />
              {label}
              <button
                type="button"
                aria-label={`Remove ${label}`}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => apply(ticket.labels.filter((item) => item !== label))}
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          );
        })}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          add(value);
        }}
      >
        <Input
          value={value}
          list="workspace-label-options"
          aria-label="Add a label"
          placeholder="Add a label"
          onChange={(event) => setValue(event.target.value)}
        />
        <datalist id="workspace-label-options">
          {palette
            .filter((label) => !ticket.labels.includes(label.name))
            .map((label) => (
              <option key={label.id} value={label.name} />
            ))}
        </datalist>
        <Button type="submit" size="sm" variant="outline" disabled={update.busy}>
          Add
        </Button>
      </form>
    </Card>
  );
}
