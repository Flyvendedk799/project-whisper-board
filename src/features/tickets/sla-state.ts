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

/** "12m", "4h", "2d" — the size of a gap, rounded to its largest unit. */
export function formatGap(ms: number): string {
  const minutes = Math.max(1, Math.round(Math.abs(ms) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** The text of the SLA pill, or null when there is nothing worth saying. */
export function slaLabel(
  dueAt: string | null,
  status: TicketStatus,
  now: number = Date.now(),
  showOk = false,
): { state: SlaState; text: string } | null {
  const state = slaState(dueAt, status, now);
  if (state === "closed" || state === "none" || !dueAt) return null;
  if (state === "ok" && !showOk) return null;
  const gap = new Date(dueAt).getTime() - now;
  return {
    state,
    text:
      state === "breached"
        ? `Overdue ${formatGap(gap)}`
        : state === "ok"
          ? "On track"
          : `Due in ${formatGap(gap)}`,
  };
}
