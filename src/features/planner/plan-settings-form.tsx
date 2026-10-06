import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useServerAction } from "@/lib/use-server-action";
import { qk } from "@/data/keys";
import { updatePlan } from "@/lib/planner.functions";
import { projectListQuery } from "@/data/projects";
import { useAuth } from "@/components/auth-provider";
import { GitHubRepoField } from "@/features/github/repo-field";
import { useGitHubRepos } from "@/features/github/use-github";
import { BranchField } from "@/features/github/branch-field";
import { createGitHubBranch } from "@/lib/github.functions";
import {
  isWorkMode,
  suggestBranchName,
  WORK_MODE_LABEL,
  workBranchProblem,
  type WorkMode,
} from "@/lib/plan-fields";
import { toast } from "sonner";
import { PLAN_STATUS_LABEL } from "@/data/enums";
import type { PlanStatus, PlanWithSections } from "@/data";
import { cn } from "@/lib/utils";
import { STICKY_ACTIONS } from "./plan-dialogs";

const STATUSES: PlanStatus[] = ["draft", "active", "paused", "completed", "archived"];

/** Title, status, project and repository, in a dialog. */
export function PlanSettingsForm({
  plan,
  onClose,
}: {
  plan: PlanWithSections;
  onClose: () => void;
}) {
  const { workspaceId } = useAuth();
  const [title, setTitle] = useState(plan.title);
  const [description, setDescription] = useState(plan.description ?? "");
  const [status, setStatus] = useState<PlanStatus>(plan.status);
  const [projectId, setProjectId] = useState<string | null>(plan.project_id);
  const [githubRepo, setGithubRepo] = useState(plan.github_repo ?? "");
  const [githubBase, setGithubBase] = useState(plan.github_base ?? "");
  const [workMode, setWorkMode] = useState<WorkMode | null>(
    isWorkMode(plan.github_work_mode) ? plan.github_work_mode : null,
  );
  const [workBranch, setWorkBranch] = useState(plan.github_work_branch ?? "");
  const [clientsCanView, setClientsCanView] = useState(plan.clients_can_view ?? false);
  const [createOnGitHub, setCreateOnGitHub] = useState(true);
  const githubReachable = !useGitHubRepos().isError;

  const projectsQuery = useQuery(projectListQuery(workspaceId));
  const selectedProject = projectsQuery.data?.find((project) => project.id === projectId);

  const save = useServerAction(useServerFn(updatePlan), {
    label: "plans.update",
    success: "Plan settings saved",
    invalidate: [qk.plan(plan.id), qk.planList(), qk.planEvents(plan.id)],
  });
  const makeBranch = useServerAction(useServerFn(createGitHubBranch), {
    label: "github.createBranch",
  });

  const repoSlug = githubRepo.trim();
  const baseName = githubBase.trim();
  const problem = workBranchProblem(workMode, workBranch, baseName);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || problem) return;
    const branch = workMode === "new" || workMode === "existing" ? workBranch.trim() : null;
    try {
      await save.run({
        planId: plan.id,
        title: title.trim(),
        description,
        status,
        projectId,
        githubRepo: repoSlug || null,
        githubBase: baseName || null,
        githubWorkMode: repoSlug ? workMode : null,
        githubWorkBranch: repoSlug ? branch : null,
        clientsCanView,
      });
    } catch {
      return; // The action already told the user why.
    }
    // The settings are saved either way; a branch that could not be made is reported, not fatal.
    if (repoSlug && workMode === "new" && branch && createOnGitHub && githubReachable) {
      try {
        const result = await makeBranch.run({
          repo: repoSlug,
          name: branch,
          from: baseName || "main",
        });
        toast.success(
          result.created ? `Created ${branch} on GitHub` : `${branch} already exists on GitHub`,
        );
      } catch {
        // The action already told the user why; the plan keeps the branch name.
      }
    }
    onClose();
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="plan-title" className="text-xs text-muted-foreground">
          Title
        </Label>
        <Input
          id="plan-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={200}
          enterKeyHint="next"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="plan-description" className="text-xs text-muted-foreground">
          Description
        </Label>
        <Textarea
          id="plan-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-xs font-medium text-muted-foreground">Status</legend>
        <div className="flex flex-wrap gap-1.5">
          {STATUSES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={status === value}
              onClick={() => setStatus(value)}
              className={cn(
                "h-[30px] rounded-full border px-3 text-xs max-md:h-10 max-md:px-3.5 max-md:text-sm",
                status === value ? "border-primary bg-accent" : "bg-card hover:bg-muted/60",
              )}
            >
              {PLAN_STATUS_LABEL[value]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="plan-project" className="text-xs text-muted-foreground">
          Linked project
        </Label>
        <Select
          value={projectId ?? "none"}
          onValueChange={(val) => setProjectId(val === "none" ? null : val)}
        >
          <SelectTrigger id="plan-project">
            <SelectValue placeholder="No linked project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            {projectsQuery.data?.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="githubRepo" className="text-xs text-muted-foreground">
            GitHub repository
          </Label>
          <GitHubRepoField id="githubRepo" value={githubRepo} onChange={setGithubRepo} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="githubBase" className="text-xs text-muted-foreground">
            Base branch
          </Label>
          <BranchField
            id="githubBase"
            ariaLabel="Base branch"
            repo={githubRepo}
            value={githubBase}
            onChange={setGithubBase}
          />
        </div>
      </div>
      {selectedProject?.github_repo && selectedProject.github_repo !== githubRepo ? (
        <button
          type="button"
          className="self-start text-left text-[13px] text-primary hover:underline max-md:-my-2 max-md:py-2.5 max-md:text-sm"
          onClick={() => {
            setGithubRepo(selectedProject.github_repo ?? "");
            if (!githubBase && selectedProject.github_default_branch) {
              setGithubBase(selectedProject.github_default_branch);
            }
          }}
        >
          Use project repository ({selectedProject.github_repo})
        </button>
      ) : null}

      <div className="flex items-start justify-between gap-4 rounded-xl border p-3.5 max-md:min-h-14">
        <div className="min-w-0 space-y-1">
          <Label htmlFor="clients-can-view" className="text-sm font-medium">
            Clients can view this plan
          </Label>
          <p className="text-xs text-muted-foreground">
            Off by default for plans you create as an admin. Turn on so project members with a
            client role can open it. Plans a client creates are visible automatically.
          </p>
        </div>
        <Switch
          id="clients-can-view"
          className="max-md:mt-1"
          checked={clientsCanView}
          onCheckedChange={setClientsCanView}
        />
      </div>

      {repoSlug ? (
        <fieldset className="flex flex-col gap-2.5 rounded-xl border p-3.5">
          <legend className="px-1 text-xs font-medium text-muted-foreground">
            Where the work happens
          </legend>
          <p className="text-xs text-muted-foreground">
            The base branch is what work branches off. The working branch is where people and agents
            commit.
          </p>
          <div role="radiogroup" aria-label="Working branch" className="flex flex-col gap-1.5">
            {(
              [
                [null, "Decide per task", "No shared branch: each task names its own."],
                ["new", WORK_MODE_LABEL.new, `A fresh branch, cut from ${baseName || "the base"}.`],
                [
                  "existing",
                  WORK_MODE_LABEL.existing,
                  "Keep working on a branch that is already there.",
                ],
                [
                  "base",
                  WORK_MODE_LABEL.base,
                  `Commit straight to ${baseName || "main"}. No pull request.`,
                ],
              ] as const
            ).map(([mode, label, hint]) => (
              <label
                key={label}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-[13px] max-md:min-h-14 max-md:py-3 max-md:text-sm",
                  workMode === mode ? "border-primary bg-accent" : "bg-card hover:bg-muted/60",
                )}
              >
                <input
                  type="radio"
                  name="work-mode"
                  checked={workMode === mode}
                  onChange={() => {
                    setWorkMode(mode);
                    if (mode === "new" && !workBranch.trim()) {
                      setWorkBranch(suggestBranchName(title));
                    }
                  }}
                  className="mt-0.5 max-md:h-5 max-md:w-5 max-md:shrink-0"
                />
                <span className="flex flex-col">
                  <span className="font-medium">{label}</span>
                  <span className="text-xs text-muted-foreground">{hint}</span>
                </span>
              </label>
            ))}
          </div>
          {workMode === "new" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="workBranch" className="text-xs text-muted-foreground">
                New branch name
              </Label>
              <Input
                id="workBranch"
                value={workBranch}
                onChange={(e) => setWorkBranch(e.target.value)}
                placeholder="plan/my-plan"
                className="font-mono text-[13px]"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              {githubReachable ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground max-md:min-h-11 max-md:text-sm">
                  <input
                    type="checkbox"
                    className="max-md:h-5 max-md:w-5"
                    checked={createOnGitHub}
                    onChange={(e) => setCreateOnGitHub(e.target.checked)}
                  />
                  Create it on GitHub when I save
                </label>
              ) : null}
            </div>
          ) : null}
          {workMode === "existing" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="workBranchExisting" className="text-xs text-muted-foreground">
                Branch
              </Label>
              <BranchField
                id="workBranchExisting"
                ariaLabel="Working branch"
                repo={githubRepo}
                value={workBranch}
                onChange={setWorkBranch}
                placeholder="Choose a branch"
              />
            </div>
          ) : null}
          {problem && workMode ? (
            <p role="alert" className="text-xs text-destructive">
              {problem}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      <div
        className={cn(
          "flex justify-end gap-2 pt-1 max-md:flex-col-reverse max-md:[&>button]:w-full",
          STICKY_ACTIONS,
        )}
      >
        <Button variant="outline" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={save.busy || makeBranch.busy || !title.trim() || Boolean(problem)}
        >
          {save.busy || makeBranch.busy ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
