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
import { useServerAction } from "@/lib/use-server-action";
import { qk } from "@/data/keys";
import { updatePlan } from "@/lib/planner.functions";
import { projectListQuery } from "@/data/projects";
import { useAuth } from "@/components/auth-provider";
import { GitHubRepoField } from "@/features/github/repo-field";
import { PLAN_STATUS_LABEL } from "@/data/enums";
import type { PlanStatus, PlanWithSections } from "@/data";
import { cn } from "@/lib/utils";

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

  const projectsQuery = useQuery(projectListQuery(workspaceId));
  const selectedProject = projectsQuery.data?.find((project) => project.id === projectId);

  const save = useServerAction(useServerFn(updatePlan), {
    label: "plans.update",
    success: "Plan settings saved",
    invalidate: [qk.plan(plan.id), qk.planList(), qk.planEvents(plan.id)],
    onSuccess: onClose,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    save.fire({
      planId: plan.id,
      title: title.trim(),
      description,
      status,
      projectId,
      githubRepo: githubRepo.trim() || null,
      githubBase: githubBase.trim() || null,
    });
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
                "h-[30px] rounded-full border px-3 text-xs",
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
          <Input
            id="githubBase"
            placeholder="main"
            value={githubBase}
            onChange={(e) => setGithubBase(e.target.value)}
          />
        </div>
      </div>
      {selectedProject?.github_repo && selectedProject.github_repo !== githubRepo ? (
        <button
          type="button"
          className="self-start text-[13px] text-primary hover:underline"
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

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="outline" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.busy || !title.trim()}>
          {save.busy ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
