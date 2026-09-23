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
import { type PlanStatus, type PlanWithSections } from "@/data";

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
    invalidate: [qk.plan(plan.id), qk.planList()],
    onSuccess: () => {
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    save.fire({
      planId: plan.id,
      title,
      description: description || undefined,
      status,
      projectId: projectId || undefined,
      githubRepo: githubRepo.trim() || null,
      githubBase: githubBase.trim() || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 py-4">
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="status">Status</Label>
        <Select value={status} onValueChange={(value) => setStatus(value as PlanStatus)}>
          <SelectTrigger id="status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="project">Linked Project</Label>
        <Select
          value={projectId ?? "none"}
          onValueChange={(val) => setProjectId(val === "none" ? null : val)}
        >
          <SelectTrigger id="project">
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

      <div className="space-y-2">
        <Label htmlFor="githubRepo">GitHub Repository</Label>
        <GitHubRepoField id="githubRepo" value={githubRepo} onChange={setGithubRepo} />
        {selectedProject?.github_repo && selectedProject.github_repo !== githubRepo && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => {
              setGithubRepo(selectedProject.github_repo ?? "");
              if (!githubBase && selectedProject.github_default_branch) {
                setGithubBase(selectedProject.github_default_branch);
              }
            }}
          >
            Use project repository ({selectedProject.github_repo})
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="githubBase">GitHub Base Branch</Label>
        <Input
          id="githubBase"
          placeholder="main"
          value={githubBase}
          onChange={(e) => setGithubBase(e.target.value)}
        />
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button variant="outline" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.busy}>
          {save.busy ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </form>
  );
}
