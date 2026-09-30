import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/components/auth-provider";
import { useServerAction } from "@/lib/use-server-action";
import { startTimer, stopTimer } from "@/lib/time.functions";
import { projectListQuery } from "@/data/projects";
import { formatClock, formatMinutes, runningTimerQuery } from "@/data/time";
import { qk } from "@/data/keys";

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="font-mono text-lg tabular-nums">
      {formatClock(now - new Date(since).getTime())}
    </span>
  );
}

const DARK_BUTTON =
  "h-9 shrink-0 rounded-lg bg-foreground px-[18px] text-[13px] text-background transition-opacity hover:opacity-90 disabled:opacity-50";

/**
 * The timer card: what is running and for how long, or a way to start one
 * against a project. Starting is optional-ticket on purpose — most time is not
 * tied to one ticket, and a timer you cannot start without one does not get used.
 */
export function TimerCard() {
  const { user, workspaceId } = useAuth();
  const running = useQuery({
    ...runningTimerQuery(user?.id ?? ""),
    enabled: Boolean(user),
  });
  const projects = useQuery(projectListQuery(workspaceId));
  const [projectId, setProjectId] = useState("");
  const [note, setNote] = useState("");

  const invalidate = [qk.timer(), qk.workspaceTime(workspaceId ?? undefined), qk.tickets()];

  const start = useServerAction(useServerFn(startTimer), {
    label: "time.start",
    success: "Timer started",
    invalidate,
    onSuccess: () => setNote(""),
  });
  const stop = useServerAction(useServerFn(stopTimer), {
    label: "time.stop",
    success: (result) =>
      result.minutes ? `Stopped, ${formatMinutes(result.minutes)} logged` : "Timer stopped",
    invalidate,
  });

  const active = (projects.data ?? []).filter((project) => project.status !== "archived");
  const entry = running.data;
  const runningProject = entry ? projects.data?.find((p) => p.id === entry.project_id) : undefined;

  return (
    <div className="flex flex-wrap items-center gap-3.5 rounded-[14px] border bg-card px-5 py-4">
      <span
        className={`h-[9px] w-[9px] shrink-0 rounded-full ${entry ? "animate-pulse bg-success" : "bg-muted-foreground/40"}`}
        aria-hidden="true"
      />

      {entry ? (
        <>
          <div className="min-w-0 flex-1" role="status" aria-live="polite">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="text-sm">
                Timer running · started{" "}
                {new Date(entry.started_at).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <Elapsed since={entry.started_at} />
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {entry.ticket ? (
                <Link
                  to="/app/tickets/$ticketId"
                  params={{ ticketId: entry.ticket.id }}
                  className="underline underline-offset-2"
                >
                  #{entry.ticket.ticket_number} {entry.ticket.title}
                </Link>
              ) : null}
              {entry.ticket && runningProject ? " · " : ""}
              {runningProject?.title}
              {entry.note ? ` · ${entry.note}` : ""}
            </div>
          </div>
          <button
            type="button"
            className={DARK_BUTTON}
            disabled={stop.busy}
            onClick={() => stop.fire({})}
          >
            Stop and log
          </button>
        </>
      ) : (
        <>
          <span className="text-sm">No timer running</span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
            <Select value={projectId || undefined} onValueChange={setProjectId}>
              <SelectTrigger aria-label="Project" className="h-9 w-48 rounded-lg text-[13px]">
                <SelectValue placeholder="Project" />
              </SelectTrigger>
              <SelectContent>
                {active.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              aria-label="What are you working on?"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What are you working on?"
              className="h-9 w-56 rounded-lg text-[13px]"
            />
            <button
              type="button"
              className={DARK_BUTTON}
              disabled={start.busy || !projectId}
              title={projectId ? undefined : "Pick a project first"}
              onClick={() => start.fire({ projectId, note: note.trim() || undefined })}
            >
              Start timer
            </button>
          </div>
        </>
      )}
    </div>
  );
}
