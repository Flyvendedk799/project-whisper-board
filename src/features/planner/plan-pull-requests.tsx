import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, GitMerge, GitPullRequest, Loader2, RefreshCw } from "lucide-react";
import { QueryState } from "@/components/query-state";
import { Segmented, StatusPill, type Tone } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { planPullsQuery } from "@/data/planner";
import type { MergeMethod, StackEntry, StackStatus } from "@/lib/pr-stack";
import { cn } from "@/lib/utils";
import { PlanMergeDialog } from "./plan-merge-dialog";

const STATUS: Record<StackStatus, { label: string; tone: Tone }> = {
  merged: { label: "Merged", tone: "info" },
  ready: { label: "Ready to merge", tone: "success" },
  waiting: { label: "Waiting for the one above", tone: "default" },
  blocked: { label: "Blocked", tone: "destructive" },
  closed: { label: "Closed, not merged", tone: "destructive" },
  unknown: { label: "Unknown", tone: "warning" },
};

/**
 * The plan's pull requests, in the order they have to be merged, with what is in the way of each,
 * and a way to merge them (all, in order, or the next one) without leaving the plan.
 */
export function PlanPullRequests({ planId }: { planId: string }) {
  const query = useQuery(planPullsQuery(planId));
  const [method, setMethod] = useState<MergeMethod>("merge");
  const [dialog, setDialog] = useState<{ only: string | null } | null>(null);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 py-5 md:px-8 md:pb-10"
      data-testid="plan-pull-requests"
    >
      <QueryState
        query={query}
        errorTitle="Couldn't load the pull requests"
        pending={
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading pull requests from
            GitHub…
          </div>
        }
      >
        {(data) => {
          const pending = data.stack.filter((e) => e.status !== "merged");
          const mergedCount = data.stack.length - pending.length;
          const next = pending[0];
          const base = data.repo
            ? data.baseBranches[data.repo]
            : Object.values(data.baseBranches)[0];

          if (data.stack.length === 0) {
            return (
              <div className="py-12 text-center">
                <GitPullRequest
                  className="mx-auto mb-3 h-7 w-7 text-muted-foreground"
                  aria-hidden
                />
                <h3 className="font-display text-2xl">No pull requests yet</h3>
                <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
                  When a task is completed with a pull request link, it shows up here, in the order
                  it has to be merged.
                </p>
              </div>
            );
          }

          return (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-2xl leading-tight">Pull requests</h2>
                  <p className="text-sm text-muted-foreground">
                    {data.repo ? <span className="font-mono text-[13px]">{data.repo}</span> : null}
                    {base ? (
                      <>
                        {data.repo ? " · " : ""}merges into{" "}
                        <span className="font-mono text-[13px]">{base}</span>
                      </>
                    ) : null}
                    {" · "}
                    {mergedCount} of {data.stack.length} merged
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void query.refetch()}
                  disabled={query.isFetching}
                  aria-label="Refresh from GitHub"
                >
                  <RefreshCw className={cn(query.isFetching && "animate-spin")} aria-hidden />
                  Refresh
                </Button>
                <Segmented<MergeMethod>
                  label="Merge method"
                  value={method}
                  onChange={setMethod}
                  options={[
                    { value: "merge", label: "Merge commit" },
                    { value: "squash", label: "Squash" },
                    { value: "rebase", label: "Rebase" },
                  ]}
                />
                <Button
                  onClick={() => setDialog({ only: null })}
                  disabled={!data.canMerge || pending.length === 0}
                  data-testid="merge-all"
                >
                  <GitMerge aria-hidden />
                  Merge all in order{pending.length > 0 ? ` (${pending.length})` : ""}
                </Button>
              </div>

              {!data.configured ? (
                <p className="rounded-lg bg-warning/15 p-3 text-sm" role="status">
                  GitHub is not connected on this deployment, so the state of these pull requests
                  cannot be read and nothing can be merged from here. Open each one on GitHub, in
                  the order shown.
                </p>
              ) : !data.isAdmin ? (
                <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground" role="status">
                  Only workspace admins can merge from here. You can still follow the order and open
                  each pull request on GitHub.
                </p>
              ) : !data.tokenCanMerge ? (
                <p className="rounded-lg bg-warning/15 p-3 text-sm" role="status">
                  The GitHub token on this deployment cannot write to the repository, so it cannot
                  merge. Open each pull request on GitHub, in the order shown.
                </p>
              ) : null}

              <ol className="flex flex-col" aria-label="Pull requests in merge order">
                {data.stack.map((entry, index) => (
                  <PullRow
                    key={entry.key}
                    entry={entry}
                    last={index === data.stack.length - 1}
                    parentNumber={
                      entry.parent
                        ? (data.stack.find((e) => e.key === entry.parent)?.number ?? null)
                        : null
                    }
                    canMerge={data.canMerge && entry.key === next?.key && entry.status === "ready"}
                    onMerge={() => setDialog({ only: entry.key })}
                  />
                ))}
              </ol>

              <PlanMergeDialog
                planId={planId}
                open={dialog !== null}
                onOpenChange={(open) => !open && setDialog(null)}
                method={method}
                only={dialog?.only ?? null}
              />
            </>
          );
        }}
      </QueryState>
    </div>
  );
}

/** One step: its place in the order on a rail, what it is, and what is in its way. */
function PullRow({
  entry,
  last,
  parentNumber,
  canMerge,
  onMerge,
}: {
  entry: StackEntry;
  last: boolean;
  parentNumber: number | null;
  canMerge: boolean;
  onMerge: () => void;
}) {
  const status = STATUS[entry.status];
  const info = entry.info;
  const done = entry.status === "merged";

  return (
    <li className="flex gap-3" data-testid={`pr-row-${entry.number}`} data-status={entry.status}>
      <div className="flex flex-col items-center" aria-hidden>
        <span
          className={cn(
            "grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-medium",
            done ? "border-info bg-info/15 text-info" : "bg-card",
          )}
        >
          {entry.order}
        </span>
        {last ? null : <span className="w-px flex-1 bg-border" />}
      </div>

      <div className={cn("min-w-0 flex-1 pb-4", last && "pb-0")}>
        <div className="rounded-xl border bg-card p-3.5">
          <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-snug">
                {entry.tasks.map((t) => t.title).join(" · ")}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
                >
                  #{entry.number}
                  <ExternalLink className="h-3 w-3" aria-label="Open on GitHub" />
                </a>
                {info ? (
                  <span className="font-mono text-[11px]">
                    {info.base} ← {info.head}
                  </span>
                ) : null}
                {parentNumber ? <span>stacked on #{parentNumber}</span> : null}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <StatusPill tone={status.tone}>{status.label}</StatusPill>
              {info && info.state === "open" && !info.merged ? (
                <>
                  {info.draft ? <StatusPill>Draft</StatusPill> : null}
                  {info.checks === "success" ? (
                    <StatusPill tone="success">Checks pass</StatusPill>
                  ) : null}
                  {info.checks === "failure" ? (
                    <StatusPill tone="destructive">Checks failing</StatusPill>
                  ) : null}
                  {info.checks === "pending" ? (
                    <StatusPill tone="warning">Checks running</StatusPill>
                  ) : null}
                </>
              ) : null}
              {canMerge ? (
                <Button size="sm" onClick={onMerge} data-testid={`merge-${entry.number}`}>
                  <GitMerge aria-hidden />
                  Merge
                </Button>
              ) : null}
            </div>
          </div>

          {entry.problems.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-0.5 text-xs text-destructive">
              {entry.problems.map((problem) => (
                <li key={problem.code}>{problem.message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </li>
  );
}
