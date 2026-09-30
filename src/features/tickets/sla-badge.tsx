import { AlertTriangle, Clock } from "lucide-react";
import { StatusPill } from "@/components/app-shell";
import type { TicketStatus } from "@/data/enums";
import { slaLabel } from "./sla-state";

/**
 * Reads `sla_due_at`, which Postgres computed from the SLA policy when the
 * ticket was created and recomputes whenever its priority changes. Doing the
 * arithmetic here instead would mean two clients could disagree about whether
 * something is late.
 */

export function SlaBadge({
  dueAt,
  status,
  showOk = false,
}: {
  dueAt: string | null;
  status: TicketStatus;
  showOk?: boolean;
}) {
  const label = slaLabel(dueAt, status, Date.now(), showOk);
  if (!label) return null;

  return (
    <StatusPill
      tone={
        label.state === "breached"
          ? "destructive"
          : label.state === "at_risk"
            ? "warning"
            : "success"
      }
    >
      {label.state === "breached" ? (
        <AlertTriangle className="mr-1 h-3 w-3" aria-hidden="true" />
      ) : label.state === "at_risk" ? (
        <Clock className="mr-1 h-3 w-3" aria-hidden="true" />
      ) : null}
      {label.text}
    </StatusPill>
  );
}
