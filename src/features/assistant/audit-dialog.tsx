import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusPill, type Tone } from "@/components/status-pill";
import { qk } from "@/data/keys";
import { auditPlan } from "@/lib/ai-planner.functions";
import { captureError } from "@/lib/providers";
import { toUserMessage } from "@/lib/errors";
import type { AuditFinding, AuditSeverity } from "@/lib/assistant-prompts";
import { useActionExecutor } from "./use-action-executor";

/**
 * Audit plan. The AI reads the plan and lists what would make it better; each
 * finding says what it would change. "Improve for me" then asks for a
 * confirmation that lists every single change before anything is applied.
 */

const SEVERITY_TONE: Record<AuditSeverity, Tone> = {
  high: "destructive",
  medium: "warning",
  low: "default",
};

type Phase = "review" | "confirm" | "applying" | "done";

type Step = {
  key: string;
  summary: string;
  status: "waiting" | "applying" | "applied" | "failed";
  error?: string;
};

export function AuditDialog({
  planId,
  planTitle,
  open,
  onOpenChange,
}: {
  planId: string;
  planTitle?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88dvh] max-w-2xl flex-col gap-3 overflow-hidden">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            Audit{planTitle ? `: ${planTitle}` : " plan"}
          </DialogTitle>
          <DialogDescription>
            The AI reads the whole plan and lists what would make it clearer to start from. Nothing
            changes until you confirm.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so every opening is a fresh audit. */}
        {open && <AuditBody planId={planId} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function AuditBody({ planId, onClose }: { planId: string; onClose: () => void }) {
  const executor = useActionExecutor();
  const audit = useQuery({
    queryKey: [...qk.all, "plan-audit", planId],
    queryFn: () => auditPlan({ data: { planId } }),
    retry: false,
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const [phase, setPhase] = useState<Phase>("review");
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);

  if (audit.isPending || audit.isFetching) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Reading the plan… this can take a minute.
      </div>
    );
  }

  if (audit.isError) {
    return (
      <div className="space-y-3 py-4">
        <p className="flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {toUserMessage(audit.error, "The audit couldn't run. Try again.")}
        </p>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void audit.refetch()}>
            Try again
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  const { summary, findings } = audit.data;
  const chosen = selected ?? new Set(findings.filter((f) => f.fix.length > 0).map((f) => f.id));
  const picked = findings.filter((finding) => chosen.has(finding.id) && finding.fix.length > 0);
  const changes = picked.flatMap((finding) =>
    finding.fix.map((action, index) => ({
      key: `${finding.id}:${index}`,
      finding,
      action,
      summary: finding.fixSummary[index] ?? action.type,
    })),
  );

  const toggle = (id: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  const apply = async () => {
    setPhase("applying");
    const state: Step[] = changes.map((change) => ({
      key: change.key,
      summary: change.summary,
      status: "waiting",
    }));
    setSteps([...state]);
    for (const [index, change] of changes.entries()) {
      state[index] = { ...state[index], status: "applying" };
      setSteps([...state]);
      try {
        await executor.execute(change.action);
        state[index] = { ...state[index], status: "applied" };
      } catch (error) {
        captureError(error, { scope: "assistant", label: `audit.apply.${change.action.type}` });
        state[index] = {
          ...state[index],
          status: "failed",
          error: toUserMessage(error, "That change couldn't be made."),
        };
      }
      setSteps([...state]);
    }
    await executor.refresh(planId);
    setPhase("done");
  };

  if (phase === "confirm") {
    return (
      <>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          <p className="text-sm">
            These {changes.length} change{changes.length === 1 ? "" : "s"} will be made to the plan.
            Nothing is deleted, and nothing outside this list is touched.
          </p>
          <ol className="space-y-1.5 text-sm">
            {changes.map((change, index) => (
              <li key={change.key} className="flex gap-2 rounded-lg border px-3 py-2">
                <span className="w-5 shrink-0 text-muted-foreground tabular-nums">
                  {index + 1}.
                </span>
                <span className="min-w-0 break-words">{change.summary}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          <Button variant="ghost" onClick={() => setPhase("review")}>
            Back
          </Button>
          <Button onClick={() => void apply()}>
            Apply {changes.length} change{changes.length === 1 ? "" : "s"}
          </Button>
        </div>
      </>
    );
  }

  if (phase === "applying" || phase === "done") {
    const failed = steps.filter((step) => step.status === "failed").length;
    const applied = steps.filter((step) => step.status === "applied").length;
    return (
      <>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          {phase === "done" && (
            <p className="text-sm font-medium">
              {failed === 0
                ? `Done: all ${applied} changes were applied.`
                : `Applied ${applied} of ${steps.length} changes; ${failed} didn't go through.`}
            </p>
          )}
          <ul className="space-y-1.5 text-sm" aria-live="polite">
            {steps.map((step) => (
              <li key={step.key} className="flex gap-2 rounded-lg border px-3 py-2">
                <span className="mt-0.5 shrink-0">
                  {step.status === "applied" && (
                    <Check className="h-4 w-4 text-success" aria-label="Applied" />
                  )}
                  {step.status === "applying" && (
                    <Loader2 className="h-4 w-4 animate-spin" aria-label="Applying" />
                  )}
                  {step.status === "failed" && (
                    <AlertTriangle className="h-4 w-4 text-destructive" aria-label="Failed" />
                  )}
                  {step.status === "waiting" && (
                    <span className="block h-4 w-4 rounded-full border" aria-label="Waiting" />
                  )}
                </span>
                <span className="min-w-0 break-words">
                  {step.summary}
                  {step.error && (
                    <span className="block text-xs text-destructive">{step.error}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex justify-end border-t pt-3">
          <Button onClick={onClose} disabled={phase === "applying"}>
            Close
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        <p className="text-sm">{summary}</p>
        {findings.length === 0 ? (
          <p className="rounded-lg border px-3 py-6 text-center text-sm text-muted-foreground">
            No problems found. The plan looks ready to work from.
          </p>
        ) : (
          <ul className="space-y-2">
            {findings.map((finding) => (
              <FindingRow
                key={finding.id}
                finding={finding}
                checked={chosen.has(finding.id)}
                onCheckedChange={(on) => toggle(finding.id, on)}
              />
            ))}
          </ul>
        )}
        {audit.data.truncated && (
          <p className="text-xs text-muted-foreground">
            This plan is large, so the audit looked at the first part of it.
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <Button variant="ghost" size="sm" onClick={() => void audit.refetch()}>
          Run again
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button disabled={changes.length === 0} onClick={() => setPhase("confirm")}>
            <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Improve for me{changes.length > 0 ? ` (${changes.length})` : ""}
          </Button>
        </div>
      </div>
    </>
  );
}

function FindingRow({
  finding,
  checked,
  onCheckedChange,
}: {
  finding: AuditFinding;
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
}) {
  const fixable = finding.fix.length > 0;
  return (
    <li className="flex gap-3 rounded-lg border p-3">
      <Checkbox
        checked={fixable && checked}
        disabled={!fixable}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        aria-label={`Fix: ${finding.title}`}
        className="mt-1"
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={SEVERITY_TONE[finding.severity]}>{finding.severity}</StatusPill>
          <span className="text-sm font-medium">{finding.title}</span>
        </div>
        {finding.detail && <p className="text-sm text-muted-foreground">{finding.detail}</p>}
        {fixable ? (
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
            {finding.fixSummary.map((line, index) => (
              <li key={index} className="break-words">
                {line}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">Needs your judgement: no automatic fix.</p>
        )}
      </div>
    </li>
  );
}
