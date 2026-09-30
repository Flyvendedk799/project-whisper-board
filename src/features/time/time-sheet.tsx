import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { EmptyState, PageHeader } from "@/components/app-shell";
import { DIALOG_CONTENT_CLASS, DIALOG_TITLE_CLASS } from "@/components/dialog-styles";
import { TimerCard } from "@/features/time/timer-card";
import { QueryState } from "@/components/query-state";
import { useAuth } from "@/components/auth-provider";
import { useServerAction } from "@/lib/use-server-action";
import { deleteTimeEntry, logTime, updateTimeEntry } from "@/lib/time.functions";
import { projectListQuery } from "@/data/projects";
import { dayLabel, formatMinutes, groupByDay, totalMinutes, workspaceTimeQuery } from "@/data/time";
import { startOfWeek } from "@/data/dashboard";
import { qk } from "@/data/keys";
import type { TimeSheetEntry } from "@/data/types";

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/**
 * The week's time. With `page` it is the whole Time screen — header, timer card,
 * week switcher and entries grouped by day. Without it (a project's Time tab) it
 * is just the week switcher and the entries for that project.
 */
export function TimeSheet({
  projectId,
  page = false,
  initialLogOpen = false,
}: {
  projectId?: string;
  page?: boolean;
  initialLogOpen?: boolean;
}) {
  const { workspaceId } = useAuth();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const weekEnd = addDays(weekStart, 7);
  const entries = useQuery(
    workspaceTimeQuery(workspaceId, weekStart.toISOString(), weekEnd.toISOString()),
  );
  const [logging, setLogging] = useState(initialLogOpen);
  const [editing, setEditing] = useState<TimeSheetEntry | null>(null);

  useEffect(() => {
    if (initialLogOpen) setLogging(true);
  }, [initialLogOpen]);

  const rows = useMemo(
    () => (entries.data ?? []).filter((entry) => !projectId || entry.project_id === projectId),
    [entries.data, projectId],
  );
  const billable = rows.filter((entry) => entry.billable);
  const grouped = useMemo(() => groupByDay(rows), [rows]);

  const invalidate = [
    qk.workspaceTime(workspaceId ?? undefined),
    ...(projectId ? [qk.projectTime(projectId)] : []),
    qk.timer(),
    qk.dashboard(),
  ];

  const remove = useServerAction(useServerFn(deleteTimeEntry), {
    label: "time.delete",
    success: "Entry removed",
    invalidate,
  });

  const isThisWeek = weekStart.getTime() === startOfWeek(new Date()).getTime();
  const rangeLabel = `${weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${addDays(weekStart, 6).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  const summary = `${formatMinutes(totalMinutes(rows))} logged, ${formatMinutes(totalMinutes(billable))} billable`;

  const logButton = (
    <Button type="button" variant="outline" onClick={() => setLogging(true)}>
      Log time
    </Button>
  );

  return (
    <>
      {page && (
        <PageHeader
          title="Time"
          description={`${isThisWeek ? "This week" : rangeLabel} · ${summary}`}
          action={logButton}
        />
      )}

      <div
        className={
          page ? "mx-auto max-w-[1120px] space-y-6 px-4 py-6 md:px-8 md:py-7" : "space-y-4"
        }
      >
        {page && <TimerCard />}

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
            {!isThisWeek && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setWeekStart(startOfWeek(new Date()))}
              >
                This week
              </Button>
            )}
          </div>
          {!page && (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">{summary}</span>
              {logButton}
            </div>
          )}
        </div>

        <QueryState
          query={entries}
          errorTitle="Couldn't load time entries"
          empty={<NothingLogged onLog={() => setLogging(true)} />}
        >
          {() =>
            rows.length === 0 ? (
              <NothingLogged onLog={() => setLogging(true)} />
            ) : (
              <div className="space-y-6">
                {grouped.map((group) => (
                  <section key={group.key} aria-label={dayLabel(group.key)}>
                    <h2 className="mb-2.5 font-display text-[22px] font-normal leading-tight">
                      {dayLabel(group.key)} · {formatMinutes(group.minutes)}
                    </h2>
                    <div className="overflow-hidden rounded-[14px] border bg-card">
                      <div className="flex gap-3 bg-surface px-4 py-2.5 text-xs text-muted-foreground">
                        <span className="min-w-0 flex-[2]">Project</span>
                        <span className="hidden min-w-0 flex-[0.7] sm:block">Ticket</span>
                        <span className="min-w-0 flex-[3]">Note</span>
                        <span className="hidden min-w-0 flex-1 md:block">Who</span>
                        <span className="min-w-0 flex-[0.9] text-right">Time</span>
                        <span className="w-[84px] shrink-0" />
                      </div>
                      <ul>
                        {group.entries.map((entry) => (
                          <li
                            key={entry.id}
                            className="flex items-center gap-3 border-t px-4 py-2.5 text-sm"
                          >
                            <span className="min-w-0 flex-[2] truncate font-medium">
                              {entry.project?.title ?? "Project"}
                            </span>
                            <span className="hidden min-w-0 flex-[0.7] truncate font-mono text-xs text-muted-foreground sm:block">
                              {entry.ticket ? `#${entry.ticket.ticket_number}` : ""}
                            </span>
                            <span className="min-w-0 flex-[3] truncate">
                              {entry.note ?? entry.ticket?.title ?? ""}
                            </span>
                            <span className="hidden min-w-0 flex-1 truncate text-muted-foreground md:block">
                              {entry.user?.full_name ?? entry.user?.email ?? "Someone"}
                            </span>
                            <span className="min-w-0 flex-[0.9] text-right font-mono text-xs tabular-nums">
                              {entry.ended_at ? formatMinutes(entry.duration_minutes) : "Running"}
                              {entry.billable ? "" : " · n/b"}
                            </span>
                            <span className="flex w-[84px] shrink-0 justify-end">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-[13px]"
                                onClick={() => setEditing(entry)}
                              >
                                Edit
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                aria-label="Delete time entry"
                                disabled={Boolean(entry.invoice_id) || remove.busy}
                                onClick={() => remove.fire({ entryId: entry.id })}
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                              </Button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </section>
                ))}
              </div>
            )
          }
        </QueryState>
      </div>

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
    </>
  );
}

function NothingLogged({ onLog }: { onLog: () => void }) {
  return (
    <div className="rounded-[14px] border bg-card">
      <EmptyState
        title="Nothing logged this week"
        description="Start a timer above, or add time after the fact."
        action={
          <Button type="button" onClick={onLog}>
            Log time
          </Button>
        }
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
      <DialogContent className={DIALOG_CONTENT_CLASS}>
        <DialogHeader>
          <DialogTitle className={DIALOG_TITLE_CLASS}>Log time</DialogTitle>
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
            <Label htmlFor="log-note">What did you do?</Label>
            <Input id="log-note" name="note" maxLength={500} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="log-billable">Billable</Label>
            <Switch id="log-billable" checked={billable} onCheckedChange={setBillable} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={log.busy}>
              {log.busy ? "Saving…" : "Log time"}
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
      <DialogContent className={DIALOG_CONTENT_CLASS}>
        <DialogHeader>
          <DialogTitle className={DIALOG_TITLE_CLASS}>Edit time</DialogTitle>
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
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
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
