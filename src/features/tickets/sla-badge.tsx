import { AlertTriangle, Clock } from "lucide-react";
import { StatusPill } from "@/components/app-shell";
import { formatRelative } from "@/lib/utils-format";
import { CLOSED_TICKET_STATUSES, type TicketStatus } from "@/data/enums";

/**
 * Reads `sla_due_at`, which Postgres computed from the SLA policy when the
 * ticket was created and recomputes whenever its priority changes. Doing the
 * arithmetic here instead would mean two clients could disagree about whether
 * something is late.
 */

export type SlaState = "breached" | "at_risk" | "ok" | "closed" | "none";

const AT_RISK_WINDOW_MS = 24 * 60 * 60 * 1000;

export function slaState(
  dueAt: string | null,
  status: TicketStatus,
  now: number = Date.now(),
): SlaState {
  if (CLOSED_TICKET_STATUSES.includes(status)) return "closed";
  if (!dueAt) return "none";
  const due = new Date(dueAt).getTime();
  if (due <= now) return "breached";
  if (due - now <= AT_RISK_WINDOW_MS) return "at_risk";
  return "ok";
}

export function SlaBadge({
  dueAt,
  status,
  showOk = false,
}: {
  dueAt: string | null;
  status: TicketStatus;
  showOk?: boolean;
}) {
  const state = slaState(dueAt, status);
  if (state === "closed" || state === "none") return null;
  if (state === "ok" && !showOk) return null;

  if (state === "breached") {
    return (
      <StatusPill tone="destructive">
        <AlertTriangle className="mr-1 h-3 w-3" aria-hidden="true" />
        Overdue {formatRelative(dueAt)}
      </StatusPill>
    );
  }

  if (state === "at_risk") {
    return (
      <StatusPill tone="warning">
        <Clock className="mr-1 h-3 w-3" aria-hidden="true" />
        Due {formatRelative(dueAt)}
      </StatusPill>
    );
  }

  return <StatusPill tone="default">Due {formatRelative(dueAt)}</StatusPill>;
}
