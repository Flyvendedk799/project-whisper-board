import { useState } from "react";
import { Settings, Github, Key } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PageHeader, StatusPill } from "@/components/app-shell";
import type { PlanWithSections } from "@/data";
import { ApiKeyManager } from "@/features/planner/api-key-manager";
import { PlanSettingsForm } from "@/features/planner/plan-settings-form";

export function PlanHeader({ plan }: { plan: PlanWithSections }) {
  const [apiKeysOpen, setApiKeysOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <PageHeader
        title={plan.title}
        description={plan.description}
        action={
          <div className="flex items-center gap-2">
            {plan.github_repo && (
              <div className="flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground">
                <Github className="h-4 w-4" />
                {plan.github_repo}
              </div>
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
