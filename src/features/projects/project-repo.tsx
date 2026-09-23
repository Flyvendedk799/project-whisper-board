import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GitHubRepoField } from "@/features/github/repo-field";
import { useServerAction } from "@/lib/use-server-action";
import { setProjectRepository } from "@/lib/github.functions";
import { repoWebUrl } from "@/lib/github-url";
import { qk } from "@/data/keys";

export function ProjectRepoControl({
  projectId,
  repo,
  branch,
}: {
  projectId: string;
  repo: string | null;
  branch: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [githubRepo, setGithubRepo] = useState(repo ?? "");
  const [githubBranch, setGithubBranch] = useState(branch ?? "");
  const href = repo ? repoWebUrl(repo) : null;

  const save = useServerAction(useServerFn(setProjectRepository), {
    label: "projects.setRepository",
    success: "Repository saved",
    invalidate: [qk.project(projectId), qk.projects()],
    onSuccess: () => setOpen(false),
  });

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Github className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
          {repo}
          {branch ? <span className="text-muted-foreground"> · {branch}</span> : null}
        </a>
      ) : (
        <span className="text-muted-foreground">No repository yet</span>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2"
        onClick={() => {
          setGithubRepo(repo ?? "");
          setGithubBranch(branch ?? "");
          setOpen(true);
        }}
      >
        {repo ? "Change" : "Connect"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Project repository</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              save.fire({
                projectId,
                githubRepo: githubRepo.trim() || null,
                githubDefaultBranch: githubBranch.trim() || null,
              });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="project-repo">Repository</Label>
              <GitHubRepoField id="project-repo" value={githubRepo} onChange={setGithubRepo} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-branch">Default branch</Label>
              <Input
                id="project-branch"
                value={githubBranch}
                onChange={(event) => setGithubBranch(event.target.value)}
                placeholder="main"
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={save.busy}>
                {save.busy ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
