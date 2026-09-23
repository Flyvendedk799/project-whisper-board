import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QueryState } from "@/components/query-state";
import { useAuth } from "@/components/auth-provider";
import { useDataMutation } from "@/lib/use-server-action";
import { deleteWorkspaceLabel, upsertWorkspaceLabel } from "@/data/mutations";
import { LABEL_COLORS, workspaceLabelsQuery } from "@/data/labels";
import { qk } from "@/data/keys";

export function LabelsCard() {
  const { workspaceId } = useAuth();
  const labels = useQuery(workspaceLabelsQuery(workspaceId));
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(LABEL_COLORS[0]);
  const [description, setDescription] = useState("");

  const save = useDataMutation("workspace_labels.upsert", upsertWorkspaceLabel, {
    success: "Label saved",
    invalidate: [qk.labels(workspaceId ?? undefined)],
    onSuccess: () => {
      setName("");
      setDescription("");
    },
  });
  const remove = useDataMutation("workspace_labels.delete", deleteWorkspaceLabel, {
    success: "Label removed",
    invalidate: [qk.labels(workspaceId ?? undefined)],
  });

  return (
    <QueryState query={labels} errorTitle="Couldn't load labels">
      {(rows) => (
        <Card className="space-y-4 p-5">
          <div>
            <h2 className="font-display text-xl">Labels</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              A shared palette so tickets don&rsquo;t collect a new spelling of the same word.
              Tickets already using a name keep it if you delete the palette entry.
            </p>
          </div>

          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = name.trim();
              if (!workspaceId || !trimmed) return;
              save.fire({
                workspaceId,
                name: trimmed,
                color,
                description: description.trim() || null,
              });
            }}
          >
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="label-name">Name</Label>
                <Input
                  id="label-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={40}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="label-description">Description</Label>
                <Input
                  id="label-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={200}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {LABEL_COLORS.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  aria-label={`Colour ${swatch}`}
                  aria-pressed={color === swatch}
                  className="h-6 w-6 rounded-full ring-offset-2 ring-offset-background"
                  style={{
                    background: swatch,
                    boxShadow:
                      color === swatch
                        ? "0 0 0 2px var(--background), 0 0 0 4px var(--foreground)"
                        : undefined,
                  }}
                  onClick={() => setColor(swatch)}
                />
              ))}
              <Button type="submit" size="sm" className="ml-auto" disabled={save.busy}>
                Add label
              </Button>
            </div>
          </form>

          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No labels yet.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {rows.map((label) => (
                <li key={label.id} className="flex items-center gap-3 px-3 py-2">
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ background: label.color }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{label.name}</div>
                    {label.description && (
                      <div className="truncate text-xs text-muted-foreground">
                        {label.description}
                      </div>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${label.name}`}
                    disabled={remove.busy}
                    onClick={() => remove.fire({ id: label.id })}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </QueryState>
  );
}
