import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Square, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth-provider";
import { useServerAction } from "@/lib/use-server-action";
import { stopTimer } from "@/lib/time.functions";
import { elapsedMinutes, formatMinutes, runningTimerQuery } from "@/data/time";
import { qk } from "@/data/keys";

/**
 * A running timer you cannot see is a running timer you forget to stop, and an
 * hour later you have to reconstruct where it went. This sits above everything
 * and does not go away until you stop it.
 */
export function RunningTimerBar() {
  const { user, isAdmin } = useAuth();
  const stop = useServerAction(useServerFn(stopTimer), {
    label: "time.stop",
    success: (result) =>
      result.minutes ? `Logged ${formatMinutes(result.minutes)}` : "Timer stopped",
    invalidate: [qk.timer(), qk.tickets(), qk.projects()],
  });

  const { data: running } = useQuery({
    ...runningTimerQuery(user?.id ?? ""),
    enabled: Boolean(user && isAdmin),
  });

  // Re-render once a minute so the elapsed time is not stale for an hour.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [running]);

  if (!running) return null;

  const elapsed = formatMinutes(elapsedMinutes(running.started_at));

  return (
    <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2">
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 rounded-full border bg-card px-4 py-2 shadow-lg"
      >
        <Timer className="h-4 w-4 shrink-0 animate-pulse text-primary" aria-hidden="true" />
        <div className="min-w-0 text-sm">
          <span className="font-medium tabular-nums">{elapsed}</span>
          {running.ticket && (
            <>
              <span className="mx-1.5 text-muted-foreground">on</span>
              <Link
                to="/app/tickets/$ticketId"
                params={{ ticketId: running.ticket.id }}
                className="underline underline-offset-2"
              >
                #{running.ticket.ticket_number}
                {running.ticket.title ? ` · ${running.ticket.title}` : ""}
              </Link>
            </>
          )}
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={stop.busy}
          onClick={() => stop.fire({})}
          className="h-7"
        >
          <Square className="mr-1 h-3 w-3" aria-hidden="true" />
          Stop
        </Button>
      </div>
    </div>
  );
}
