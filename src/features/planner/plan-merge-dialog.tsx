import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowRightLeft,
  Check,
  CircleDashed,
  GitMerge,
  Loader2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { qk } from "@/data/keys";
import { toUserMessage } from "@/lib/errors";
import { mergePlanPullRequests } from "@/lib/plan-pulls.functions";
import type { MergeMethod } from "@/lib/pr-stack";
import { cn } from "@/lib/utils";
import { DIALOG_CONTENT, DIALOG_TITLE } from "./plan-dialogs";

type Result = Awaited<ReturnType<typeof mergePlanPullRequests>>;
type Step = Result["steps"][number];

/** Live state of one step while the run is going. */
type Progress = { outcome: Step["outcome"]; message?: string };

type Phase = "planning" | "review" | "running" | "finished" | "error";

const METHOD_LABEL: Record<MergeMethod, string> = {
  merge: "merge commit",
  squash: "squash",
  rebase: "rebase",
};

/**
 * Confirm and run a merge. It first asks the server for a dry run, shows exactly what would happen
 * (order, which branches get retargeted, what blocks), and only then merges, one pull request at a
 * time so every step shows as it lands. It stops at the first failure and says why.
 *
 * `only` merges just that pull request (it has to be the next in line).
 */
export function PlanMergeDialog({
  planId,
  open,
  onOpenChange,
  method,
  only,
}: {
  planId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  method: MergeMethod;
  only?: string | null;
}) {
  const merge = useServerFn(mergePlanPullRequests);
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>("planning");
  const [plan, setPlan] = useState<Result | null>(null);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.planPulls(planId) }),
      queryClient.invalidateQueries({ queryKey: qk.plan(planId) }),
      queryClient.invalidateQueries({ queryKey: qk.planEvents(planId) }),
    ]);

  // Each time it opens: ask what would happen.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase("planning");
    setPlan(null);
    setProgress({});
    setError(null);
    merge({ data: { planId, method, dryRun: true } })
      .then((result) => {
        if (cancelled) return;
        setPlan(result);
        setPhase("review");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(toUserMessage(err, "Could not work out the merge plan."));
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
    // The plan is read once per opening; method and `only` do not change while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, planId]);

  const visible = (plan?.steps ?? []).filter(
    (step) => step.action !== "already_merged" && (!only || step.key === only),
  );
  // What a run would actually do now: the steps before the first one that is held back.
  const doable = (() => {
    const out: Step[] = [];
    for (const step of visible) {
      if (step.action === "blocked" || step.action === "not_reached") break;
      out.push(step);
    }
    return only ? out.slice(0, 1) : out;
  })();
  const blockedAt = visible.find((s) => s.action === "blocked");

  const run = async () => {
    if (running.current) return;
    running.current = true;
    setPhase("running");
    let stopped = false;
    try {
      // One pull request per call, so progress shows as it happens and no request outlives its time.
      for (let i = 0; i < doable.length + 2 && !stopped; i++) {
        const result = await merge({
          data: { planId, method, ...(only ? { only } : { max: 1 }) },
        });
        setProgress((prev) => {
          const next = { ...prev };
          for (const step of result.steps) {
            if (
              step.outcome === "merged" ||
              step.outcome === "skipped" ||
              step.outcome === "failed"
            ) {
              if (step.action !== "already_merged") {
                next[step.key] = { outcome: step.outcome, message: step.message };
              }
            }
          }
          return next;
        });
        if (result.steps.some((s) => s.outcome === "failed")) stopped = true;
        const left = result.steps.some((s) => s.outcome === "pending");
        if (only || !left) break;
      }
      await refresh();
      setPhase("finished");
    } catch (err) {
      setError(toUserMessage(err, "The merge stopped unexpectedly."));
      await refresh();
      setPhase("error");
    } finally {
      running.current = false;
    }
  };

  const mergedCount = Object.values(progress).filter((p) => p.outcome === "merged").length;
  const failed = Object.entries(progress).find(([, p]) => p.outcome === "failed");

  useEffect(() => {
    if (phase !== "finished") return;
    if (failed) toast.error("The merge stopped. See the dialog for why.");
    else if (mergedCount > 0) {
      toast.success(`Merged ${mergedCount} pull request${mergedCount === 1 ? "" : "s"}`);
    }
  }, [phase, failed, mergedCount]);

  return (
    <Dialog open={open} onOpenChange={(next) => !(phase === "running") && onOpenChange(next)}>
      <DialogContent className={cn("max-h-[90vh] max-w-[620px] overflow-auto", DIALOG_CONTENT)}>
        <DialogHeader>
          <DialogTitle className={DIALOG_TITLE}>
            {only ? "Merge pull request" : "Merge all in order"}
          </DialogTitle>
          <DialogDescription>
            {phase === "planning"
              ? "Working out what this would do…"
              : phase === "review"
                ? `Nothing has been changed yet. Merging by ${METHOD_LABEL[method]}.`
                : phase === "running"
                  ? "Merging. Keep this open until it finishes."
                  : null}
          </DialogDescription>
        </DialogHeader>

        {phase === "planning" ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading the pull requests from
            GitHub…
          </div>
        ) : null}

        {phase === "error" ? (
          <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {plan?.warning ? (
          <p className="flex gap-2 rounded-lg bg-warning/15 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
            {plan.warning}
          </p>
        ) : null}

        {plan && phase !== "planning" ? (
          <ol className="flex flex-col gap-2" aria-label="Merge steps">
            {visible.map((step) => (
              <StepRow
                key={step.key}
                step={step}
                progress={progress[step.key]}
                running={phase === "running"}
              />
            ))}
            {visible.length === 0 ? (
              <li className="text-sm text-muted-foreground">Nothing is left to merge.</li>
            ) : null}
          </ol>
        ) : null}

        {phase === "review" && blockedAt ? (
          <p className="text-sm text-muted-foreground">
            {doable.length > 0
              ? `It will merge ${doable.length} and then stop at #${blockedAt.number}.`
              : `Nothing can be merged yet: #${blockedAt.number} has to be sorted out first.`}
          </p>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-2">
          {phase === "review" ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={run} disabled={doable.length === 0} data-testid="confirm-merge">
                <GitMerge aria-hidden />
                {only
                  ? "Merge"
                  : doable.length === visible.length
                    ? `Merge ${doable.length} in order`
                    : `Merge ${doable.length} now`}
              </Button>
            </>
          ) : phase === "running" ? (
            <Button disabled>
              <Loader2 className="animate-spin" aria-hidden /> Merging…
            </Button>
          ) : (
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StepRow({
  step,
  progress,
  running,
}: {
  step: Step;
  progress?: Progress;
  running: boolean;
}) {
  const outcome = progress?.outcome;
  const waiting = step.action === "blocked" || step.action === "not_reached";
  const message = progress?.message ?? step.message;

  let icon = <CircleDashed className="h-4 w-4 text-muted-foreground" aria-hidden />;
  let label = "Waiting";
  if (outcome === "merged" || outcome === "skipped") {
    icon = <Check className="h-4 w-4 text-success" aria-hidden />;
    label = outcome === "merged" ? "Merged" : "Already merged";
  } else if (outcome === "failed" || step.action === "blocked") {
    icon = <X className="h-4 w-4 text-destructive" aria-hidden />;
    label = outcome === "failed" ? "Failed" : "Blocked";
  } else if (step.action === "not_reached") {
    label = "Not reached";
  } else if (running) {
    icon = <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />;
    label = "Waiting for its turn";
  } else if (step.action === "retarget_and_merge") {
    icon = <ArrowRightLeft className="h-4 w-4 text-info" aria-hidden />;
    label = "Retarget, then merge";
  } else if (!waiting) {
    icon = <GitMerge className="h-4 w-4 text-primary" aria-hidden />;
    label = "Merge";
  }

  return (
    <li
      className="flex items-start gap-3 rounded-lg border bg-card p-3"
      data-testid={`merge-step-${step.number}`}
      data-outcome={outcome ?? step.action}
    >
      <span className="mt-0.5">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          #{step.number}{" "}
          <span className="font-normal text-muted-foreground">
            {step.tasks.map((t) => t.title).join(" · ")}
          </span>
        </p>
        <p className="text-xs text-muted-foreground">
          {label}
          {step.action === "retarget_and_merge" && step.retargetTo && !outcome
            ? `: it is based on a branch that will be merged away, so it is pointed at ${step.retargetTo} first`
            : null}
        </p>
        {message && (outcome === "failed" || waiting) ? (
          <p className="mt-1 text-xs text-destructive">{message}</p>
        ) : null}
      </div>
    </li>
  );
}
