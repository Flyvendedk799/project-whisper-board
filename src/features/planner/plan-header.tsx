import { Settings, Github, Key } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, StatusPill } from "@/components/app-shell";
import type { PlanWithSections } from "@/data";

export function PlanHeader({ plan }: { plan: PlanWithSections }) {
  return (
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
          <Button variant="outline" size="sm">
            <Key className="mr-1.5 h-4 w-4" />
            API Keys
          </Button>
          <Button variant="outline" size="icon">
            <Settings className="h-4 w-4" />
            <span className="sr-only">Settings</span>
          </Button>
        </div>
      }
    />
  );
}
