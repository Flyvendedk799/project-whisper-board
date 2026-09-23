import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, FolderKanban, Settings, Github, Key } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PageHeader, StatusPill } from "@/components/app-shell";
import type { PlanWithSections } from "@/data";
import { ApiKeyManager } from "@/features/planner/api-key-manager";
import { ImportTicketsButton } from "@/features/planner/import-tickets-button";
import { PlanSettingsForm } from "@/features/planner/plan-settings-form";
import { repoWebUrl } from "@/lib/github-url";

export function PlanHeader({ plan }: { plan: PlanWithSections }) {
  const [apiKeysOpen, setApiKeysOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2 border-b px-4 py-2 text-sm text-muted-foreground md:px-6 lg:px-8">
        <Button asChild variant="ghost" size="sm" className="-ml-2 h-8 px-2">
          <Link to="/app/planner" search={{ project: plan.project_id ?? undefined }}>
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Plans
          </Link>
        </Button>
        {plan.project && (
          <>
            <span aria-hidden>/</span>
            <Link
              to="/app/projects/$projectId"
              params={{ projectId: plan.project.id }}
              search={{ tab: "plans" }}
              className="inline-flex items-center gap-1.5 truncate hover:text-foreground"
            >
              <FolderKanban className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{plan.project.title}</span>
            </Link>
          </>
        )}
      </div>
      <PageHeader
        title={plan.title}
        description={plan.description}
        action={
          <div className="flex items-center gap-2">
            <ImportTicketsButton planId={plan.id} projectId={plan.project_id} />
            {plan.github_repo && repoWebUrl(plan.github_repo) && (
              <a
                href={repoWebUrl(plan.github_repo)!}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                <Github className="h-4 w-4" />
                {plan.github_repo}
              </a>
            )}
            <StatusPill
              tone={
                plan.status === "completed"
                  ? "success"
                  : plan.status === "active"
                    ? "info"
                    : "default"
              }
            >
              {plan.status || "draft"}
            </StatusPill>

            <Dialog open={apiKeysOpen} onOpenChange={setApiKeysOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Key className="mr-1.5 h-4 w-4" />
                  API Keys
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl">
                <DialogHeader>
                  <DialogTitle>Manage AI Agent API Keys</DialogTitle>
                </DialogHeader>
                <ApiKeyManager />
              </DialogContent>
            </Dialog>

            <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="icon">
                  <Settings className="h-4 w-4" />
                  <span className="sr-only">Settings</span>
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Plan Settings</DialogTitle>
                </DialogHeader>
                <PlanSettingsForm plan={plan} onClose={() => setSettingsOpen(false)} />
              </DialogContent>
            </Dialog>
          </div>
        }
      />
    </>
  );
}
