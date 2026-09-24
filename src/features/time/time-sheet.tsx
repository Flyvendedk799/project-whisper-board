import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight, Clock, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/app-shell";
import { QueryState } from "@/components/query-state";
import { useAuth } from "@/components/auth-provider";
import { useServerAction } from "@/lib/use-server-action";
import { deleteTimeEntry, logTime, updateTimeEntry } from "@/lib/time.functions";
import { projectListQuery } from "@/data/projects";
import { formatMinutes, totalMinutes, workspaceTimeQuery } from "@/data/time";
import { qk } from "@/data/keys";
import type { TimeSheetEntry } from "@/data/types";

function startOfWeek(date: Date) {
  const copy = new Date(date);
  const mondayOffset = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - mondayOffset);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function dayKey(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function TimeSheet({ projectId }: { projectId?: string }) {
  const { workspaceId } = useAuth();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const weekEnd = addDays(weekStart, 7);
  const entries = useQuery(
    workspaceTimeQuery(workspaceId, weekStart.toISOString(), weekEnd.toISOString()),
  );
  const [logging, setLogging] = useState(false);
  const [editing, setEditing] = useState<TimeSheetEntry | null>(null);

  const rows = useMemo(
    () => (entries.data ?? []).filter((entry) => !projectId || entry.project_id === projectId),
    [entries.data, projectId],
  );
  const billable = rows.filter((entry) => entry.billable);
  const grouped = useMemo(() => {
    const map = new Map<string, TimeSheetEntry[]>();
    for (const entry of rows) {
      const key = dayKey(entry.started_at);
      map.set(key, [...(map.get(key) ?? []), entry]);
    }
    return [...map.entries()];
  }, [rows]);

  const invalidate = [
    qk.workspaceTime(workspaceId ?? undefined),
    ...(projectId ? [qk.projectTime(projectId)] : []),
    qk.timer(),
  ];

  const remove = useServerAction(useServerFn(deleteTimeEntry), {
    label: "time.delete",
    success: "Entry removed",
    invalidate,
  });

  const rangeLabel = `${weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${addDays(weekStart, 6).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Previous week"
            onClick={() => setWeekStart(addDays(weekStart, -7))}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <div className="min-w-40 text-center text-sm font-medium">{rangeLabel}</div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Next week"
            onClick={() => setWeekStart(addDays(weekStart, 7))}
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setWeekStart(startOfWeek(new Date()))}
          >
            This week
          </Button>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            {formatMinutes(totalMinutes(rows))} logged · {formatMinutes(totalMinutes(billable))}{" "}
            billable
          </span>
          <Button type="button" size="sm" onClick={() => setLogging(true)}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            Log time
          </Button>
        </div>
      </div>

      <QueryState
        query={entries}
        errorTitle="Couldn't load time entries"
        empty={
          <Card>
            <EmptyState
              icon={Clock}
              title="Nothing logged this week"
              description="Start a timer on a ticket, or add time after the fact."
              action={
                <Button type="button" onClick={() => setLogging(true)}>
                  Log time
                </Button>
              }
            />
          </Card>
        }
      >
        {() =>
          rows.length === 0 ? (
            <Card>
              <EmptyState
                icon={Clock}
                title="Nothing logged this week"
                description="Start a timer on a ticket, or add time after the fact."
                action={
                  <Button type="button" onClick={() => setLogging(true)}>
                    Log time
                  </Button>
                }
              />
            </Card>
          ) : (
            <div className="space-y-4">
              {grouped.map(([day, dayEntries]) => (
                <section key={day} className="space-y-2">
                  <h3 className="text-sm font-medium text-muted-foreground">{day}</h3>
                  <ul className="divide-y overflow-hidden rounded-lg border">
                    {dayEntries.map((entry) => (
                      <li
                        key={entry.id}
                        className="flex flex-wrap items-center gap-3 bg-card px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {entry.ticket
                              ? `#${entry.ticket.ticket_number} ${entry.ticket.title}`
                              : (entry.project?.title ?? "Project")}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {entry.user?.full_name ?? entry.user?.email ?? "Someone"}
                            {entry.project && entry.ticket ? ` · ${entry.project.title}` : ""}
                            {entry.note ? ` · ${entry.note}` : ""}
                          </div>
                        </div>
                        <span className="text-sm tabular-nums">
                          {entry.ended_at ? formatMinutes(entry.duration_minutes) : "Running"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {entry.billable ? "Billable" : "Non-billable"}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(entry)}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Delete time entry"
                          disabled={Boolean(entry.invoice_id) || remove.busy}
                          onClick={() => remove.fire({ entryId: entry.id })}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )
        }
      </QueryState>

      <LogTimeDialog
        open={logging}
        projectId={projectId}
        onOpenChange={setLogging}
        invalidate={invalidate}
      />
      <EditTimeDialog
        entry={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        invalidate={invalidate}
      />
    </div>
  );
}

function LogTimeDialog({
  open,
  projectId,
  onOpenChange,
  invalidate,
}: {
  open: boolean;
  projectId?: string;
  onOpenChange: (open: boolean) => void;
  invalidate: readonly (readonly unknown[])[];
}) {
  const { workspaceId } = useAuth();
  const projects = useQuery({ ...projectListQuery(workspaceId), enabled: open && !projectId });
  const [chosenProject, setChosenProject] = useState(projectId ?? "");
  const [billable, setBillable] = useState(true);

  const log = useServerAction(useServerFn(logTime), {
    label: "time.log",
    success: (result) => `Logged ${formatMinutes(result.minutes)}`,
    invalidate,
    onSuccess: () => onOpenChange(false),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log time</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const targetProject = projectId || chosenProject;
            const minutes = Number(form.get("minutes"));
            const date = String(form.get("date") || "");
            if (!targetProject || !minutes) return;
            const endedAt = date ? new Date(`${date}T18:00:00`).toISOString() : undefined;
            void log.run({
              projectId: targetProject,
              minutes,
              note: String(form.get("note") || "") || undefined,
              billable,
              endedAt,
            });
          }}
        >
          {!projectId && (
            <div className="space-y-1.5">
              <Label>Project</Label>
              <Select value={chosenProject || undefined} onValueChange={setChosenProject}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a project" />
                </SelectTrigger>
                <SelectContent>
                  {(projects.data ?? [])
                    .filter((project) => project.status !== "archived")
                    .map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.title}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="log-minutes">Minutes</Label>
              <Input id="log-minutes" name="minutes" type="number" min={1} max={1440} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="log-date">Date</Label>
              <Input
                id="log-date"
                name="date"
                type="date"
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="log-note">Note</Label>
            <Input id="log-note" name="note" maxLength={500} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="log-billable">Billable</Label>
            <Switch id="log-billable" checked={billable} onCheckedChange={setBillable} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={log.busy}>
              {log.busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditTimeDialog({
  entry,
  onOpenChange,
  invalidate,
}: {
  entry: TimeSheetEntry | null;
  onOpenChange: (open: boolean) => void;
  invalidate: readonly (readonly unknown[])[];
}) {
  const [billable, setBillable] = useState(true);

  useEffect(() => {
    if (entry) setBillable(entry.billable);
  }, [entry]);

  const save = useServerAction(useServerFn(updateTimeEntry), {
    label: "time.update",
    success: "Entry updated",
    invalidate,
    onSuccess: () => onOpenChange(false),
  });

  return (
    <Dialog open={Boolean(entry)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit time</DialogTitle>
        </DialogHeader>
        {entry && (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const minutes = Number(form.get("minutes"));
              save.fire({
                entryId: entry.id,
                note: String(form.get("note") || "") || null,
                billable,
                ...(entry.ended_at && minutes ? { minutes } : {}),
              });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="edit-minutes">Minutes</Label>
              <Input
                id="edit-minutes"
                name="minutes"
                type="number"
                min={1}
                max={1440}
                defaultValue={entry.duration_minutes ?? ""}
                disabled={!entry.ended_at}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-note">Note</Label>
              <Input id="edit-note" name="note" defaultValue={entry.note ?? ""} maxLength={500} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="edit-billable">Billable</Label>
              <Switch id="edit-billable" checked={billable} onCheckedChange={setBillable} />
            </div>
            {entry.invoice_id && (
              <p className="text-sm text-muted-foreground">
                This entry is already on an invoice and can&rsquo;t be changed.
              </p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={save.busy || Boolean(entry.invoice_id)}>
                Save
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
