import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Bug, Check, FolderKanban, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/components/auth-provider";

function dismissKey(workspaceId: string) {
  return `cf.gettingStarted.dismissed.${workspaceId}`;
}

function readDismissed(workspaceId: string | null): boolean {
  if (!workspaceId || typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(dismissKey(workspaceId)) === "1";
  } catch {
    return false;
  }
}

/**
 * Light post-login path: invite → project → first ticket. Shown on Home when
 * any of those are still missing — empty states alone do not explain the loop.
 */
export function GettingStartedGuide({
  hasClient,
  hasProject,
  hasTickets,
  firstProjectId,
  loading,
}: {
  hasClient: boolean;
  hasProject: boolean;
  hasTickets: boolean;
  firstProjectId?: string;
  loading?: boolean;
}) {
  const { workspaceId } = useAuth();
  const [dismissed, setDismissed] = useState(() => readDismissed(workspaceId));

  useEffect(() => {
    setDismissed(readDismissed(workspaceId));
  }, [workspaceId]);

  const steps = [
    {
      id: "invite",
      done: hasClient,
      title: "Invite a client",
      detail: "They report issues from their side.",
      href: "/app/team" as const,
      icon: UserPlus,
    },
    {
      id: "project",
      done: hasProject,
      title: hasProject ? "Open your project" : "Create a project",
      detail: "Tickets, plans and billing hang off one project.",
      href: "/app/projects" as const,
      openProjectId: hasProject ? firstProjectId : undefined,
      icon: FolderKanban,
    },
    {
      id: "ticket",
      done: hasTickets,
      title: "Report a first ticket",
      detail: "Seed the queue yourself, or let the client report.",
      href: "/app/report" as const,
      icon: Bug,
    },
  ];

  const remaining = steps.filter((step) => !step.done).length;
  if (dismissed || loading || remaining === 0) return null;

  return (
    <Card className="relative mb-8 overflow-hidden p-5 sm:p-6">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 h-8 w-8 text-muted-foreground"
        aria-label="Dismiss getting started"
        onClick={() => {
          if (workspaceId) {
            try {
              localStorage.setItem(dismissKey(workspaceId), "1");
            } catch {
              /* ignore */
            }
          }
          setDismissed(true);
        }}
      >
        <X className="h-4 w-4" />
      </Button>

      <div className="pr-8">
        <h2 className="font-display text-xl">Get your first ticket</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Invite a client, open a project, then report something. Three steps — then the rest of the
          app has something to show.
        </p>
      </div>

      <ol className="mt-5 space-y-3">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <li key={step.id} className="flex items-start gap-3">
              <span
                className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs ${
                  step.done ? "bg-success/20 text-success" : "bg-primary text-primary-foreground"
                }`}
                aria-hidden="true"
              >
                {step.done ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${step.done ? "text-muted-foreground" : ""}`}>
                  {step.title}
                </p>
                <p className="text-xs text-muted-foreground">{step.detail}</p>
              </div>
              {!step.done && step.openProjectId && (
                <Button size="sm" variant="outline" asChild>
                  <Link
                    to="/app/projects/$projectId"
                    params={{ projectId: step.openProjectId }}
                    search={{ tab: "people", paid: undefined }}
                  >
                    Open
                    <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </Button>
              )}
              {!step.done && !step.openProjectId && (
                <Button size="sm" variant="outline" asChild>
                  <Link
                    to={step.href}
                    search={
                      step.href === "/app/report"
                        ? { project: firstProjectId, url: undefined }
                        : undefined
                    }
                  >
                    <Icon className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                    Go
                  </Link>
                </Button>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
