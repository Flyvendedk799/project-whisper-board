import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QueryState } from "@/components/query-state";
import { useAuth } from "@/components/auth-provider";
import { planPatchesQuery } from "@/data/planner";
import { qk } from "@/data/keys";
import { useServerAction } from "@/lib/use-server-action";
import { deliverPlanPatches, registerPlanPatch } from "@/lib/plan-patches.functions";
import { formatDate } from "@/lib/utils-format";
import type { PlanWithSections } from "@/data/types";

export function PlanPatches({ plan }: { plan: PlanWithSections }) {
  const { isAdmin } = useAuth();
  const query = useQuery(planPatchesQuery(plan.id));
  const [branch, setBranch] = useState("");
  const [sha, setSha] = useState("");
  const [worktree, setWorktree] = useState("");
  const [bundle, setBundle] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [strategy, setStrategy] = useState<"direct" | "pr" | null>(null);
  const [prTitle, setPrTitle] = useState("");
  const register = useServerAction(useServerFn(registerPlanPatch), {
    label: "patches.register",
    invalidate: [qk.planPatches(plan.id)],
    success: (result) => (result.created ? "Patch registered" : "Commit already registered"),
    onSuccess: () => setSha(""),
  });
  const deliver = useServerAction(useServerFn(deliverPlanPatches), {
    label: "patches.deliver",
    invalidate: [qk.planPatches(plan.id), qk.planPulls(plan.id)],
    success: (result) =>
      result.strategy === "direct"
        ? `${result.count} patch${result.count === 1 ? "" : "es"} applied to ${plan.github_base || "the repository base"}`
        : `Pull request opened for ${result.count} patch${result.count === 1 ? "" : "es"}`,
    onSuccess: () => {
      setSelected(new Set());
      setStrategy(null);
    },
  });
  const rows = query.data ?? [];
  const ready = rows.filter((row) => row.status === "registered");
  const chosen = ready.filter((row) => selected.has(row.id));
  const tooLargeForDirect =
    chosen.reduce((n, row) => n + row.file_count, 0) > 5 ||
    chosen.reduce((n, row) => n + row.additions + row.deletions, 0) > 200;
  const bundles = [...new Set(ready.map((row) => row.bundle_name).filter(Boolean))];

  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-auto px-4 py-5 md:px-8 md:pb-10">
      <div>
        <h2 className="font-display text-2xl">Patches</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Register commits from a branch or worktree, group them into a bundle, then deliver the
          full branch as a pull request or a safe fast-forward to{" "}
          {plan.github_base || "the repository base"}.
        </p>
      </div>
      {isAdmin && (
        <form
          className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            register.fire({
              planId: plan.id,
              branch,
              commitSha: sha,
              worktreeLabel: worktree,
              bundleName: bundle,
            });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="patch-branch">Source branch</Label>
            <Input
              id="patch-branch"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              required
              placeholder="fix/ticket-123"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="patch-sha">Commit SHA</Label>
            <Input
              id="patch-sha"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              value={sha}
              onChange={(event) => setSha(event.target.value)}
              required
              pattern="[a-fA-F0-9]{40}"
              placeholder="40-character SHA"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="patch-worktree">Worktree label</Label>
            <Input
              id="patch-worktree"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={worktree}
              onChange={(event) => setWorktree(event.target.value)}
              placeholder="Local worktree"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="patch-bundle">Bundle name</Label>
            <Input
              id="patch-bundle"
              value={bundle}
              onChange={(event) => setBundle(event.target.value)}
              placeholder="Optional group"
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-4 max-md:[&>button]:w-full">
            <Button
              type="submit"
              disabled={register.busy || !branch || !/^[a-f\d]{40}$/i.test(sha)}
            >
              {register.busy ? "Checking GitHub…" : "Register commit"}
            </Button>
          </div>
        </form>
      )}
      <QueryState query={query} errorTitle="Couldn't load patches">
        {() =>
          rows.length === 0 ? (
            <p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
              No patches registered yet.
            </p>
          ) : (
            <>
              {isAdmin && (
                <div className="flex flex-wrap items-center gap-2 max-md:[&>button]:flex-1">
                  <span className="text-sm text-muted-foreground max-md:w-full">
                    {chosen.length} selected
                  </span>
                  {bundles.map((name) => (
                    <Button
                      key={name}
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setSelected(
                          new Set(
                            ready.filter((row) => row.bundle_name === name).map((row) => row.id),
                          ),
                        )
                      }
                    >
                      Select {name}
                    </Button>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!chosen.length || tooLargeForDirect}
                    onClick={() => setStrategy("direct")}
                  >
                    Review direct delivery
                  </Button>
                  <Button size="sm" disabled={!chosen.length} onClick={() => setStrategy("pr")}>
                    Open pull request
                  </Button>
                  {tooLargeForDirect && (
                    <span className="text-xs text-muted-foreground">
                      Larger bundles use a pull request.
                    </span>
                  )}
                </div>
              )}
              <ul className="space-y-2">
                {rows.map((row) => (
                  <li key={row.id} className="flex items-start gap-3 rounded-xl border bg-card p-4">
                    {isAdmin && row.status === "registered" && (
                      <input
                        type="checkbox"
                        className="max-md:box-content max-md:h-5 max-md:w-5 max-md:shrink-0 max-md:-m-3 max-md:p-3"
                        aria-label={`Select ${row.summary}`}
                        checked={selected.has(row.id)}
                        onChange={(event) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(row.id);
                            else next.delete(row.id);
                            return next;
                          })
                        }
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-medium max-md:break-words">{row.summary}</div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground max-md:break-all">
                        <span className="font-mono">{row.commit_sha.slice(0, 10)}</span>
                        <span>{row.branch}</span>
                        {row.worktree_label && <span>Worktree: {row.worktree_label}</span>}
                        {row.bundle_name && <span>Bundle: {row.bundle_name}</span>}
                        <span>
                          {row.file_count} files · +{row.additions} / -{row.deletions}
                        </span>
                        <span>{formatDate(row.created_at)}</span>
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {row.status === "pr_open" && row.pr_url ? (
                        <a
                          href={row.pr_url}
                          target="_blank"
                          rel="noreferrer"
                          className="underline max-md:-my-3 max-md:inline-block max-md:py-3"
                        >
                          Pull request
                        </a>
                      ) : row.status === "applied" ? (
                        "Applied"
                      ) : (
                        "Ready"
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )
        }
      </QueryState>
      <Dialog open={strategy !== null} onOpenChange={(open) => !open && setStrategy(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {strategy === "direct" ? "Deliver directly" : "Open pull request"}
            </DialogTitle>
            <DialogDescription>
              {chosen.length} selected commit{chosen.length === 1 ? "" : "s"} from one branch into{" "}
              {plan.github_base || "the repository base"}.
              {strategy === "direct"
                ? " The branch must fast-forward the base, and every commit on it must be selected. GitHub branch protection still applies."
                : " Every commit on the branch must be registered and selected."}
            </DialogDescription>
          </DialogHeader>
          {strategy === "pr" && (
            <div className="space-y-1">
              <Label htmlFor="patch-pr-title">Pull request title</Label>
              <Input
                id="patch-pr-title"
                value={prTitle}
                onChange={(event) => setPrTitle(event.target.value)}
                placeholder="Describe this bundle"
              />
            </div>
          )}
          <div className="flex justify-end gap-2 max-md:flex-col-reverse max-md:[&>button]:w-full">
            <Button variant="outline" onClick={() => setStrategy(null)}>
              Cancel
            </Button>
            <Button
              disabled={deliver.busy || !chosen.length}
              onClick={() =>
                strategy &&
                deliver.fire({
                  planId: plan.id,
                  patchIds: chosen.map((row) => row.id),
                  strategy,
                  title: prTitle || undefined,
                })
              }
            >
              {deliver.busy ? "Checking…" : strategy === "direct" ? "Fast-forward base" : "Open PR"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
