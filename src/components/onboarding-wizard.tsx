import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Check, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/components/auth-provider";
import { useServerAction, useDataMutation } from "@/lib/use-server-action";
import { inviteClient } from "@/lib/admin.functions";
import { qk } from "@/data/keys";
import { createProject, createTicketRow } from "@/data/mutations";

/**
 * First run. Three steps, because a project with no client and no tickets does
 * not show you what the app is for.
 */
type Step = 1 | 2 | 3;

function stepStorageKey(workspaceId: string) {
  return `cf.onboarding.step.${workspaceId}`;
}

function projectStorageKey(workspaceId: string) {
  return `cf.onboarding.project.${workspaceId}`;
}

function readStoredStep(workspaceId: string | null): Step {
  if (!workspaceId || typeof sessionStorage === "undefined") return 1;
  try {
    const raw = sessionStorage.getItem(stepStorageKey(workspaceId));
    const n = Number(raw);
    return n === 1 || n === 2 || n === 3 ? n : 1;
  } catch {
    return 1;
  }
}

function readStoredProjectId(workspaceId: string | null): string | null {
  if (!workspaceId || typeof sessionStorage === "undefined") return null;
  try {
    return sessionStorage.getItem(projectStorageKey(workspaceId));
  } catch {
    return null;
  }
}

function clearOnboardingStorage(workspaceId: string | null) {
  if (!workspaceId) return;
  try {
    sessionStorage.removeItem(stepStorageKey(workspaceId));
    sessionStorage.removeItem(projectStorageKey(workspaceId));
  } catch {
    /* ignore */
  }
}

export function OnboardingWizard() {
  const navigate = useNavigate();
  const { workspaceId } = useAuth();
  const [step, setStep] = useState<Step>(() => readStoredStep(workspaceId));
  const [projectId, setProjectId] = useState<string | null>(() => readStoredProjectId(workspaceId));
  const [showTicketForm, setShowTicketForm] = useState(false);

  useEffect(() => {
    setStep(readStoredStep(workspaceId));
    setProjectId(readStoredProjectId(workspaceId));
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    try {
      sessionStorage.setItem(stepStorageKey(workspaceId), String(step));
      if (projectId) sessionStorage.setItem(projectStorageKey(workspaceId), projectId);
    } catch {
      /* ignore */
    }
  }, [workspaceId, step, projectId]);

  const project = useDataMutation("projects.insert", createProject, {
    success: "Project created",
    invalidate: [qk.projects()],
    onSuccess: (project) => {
      setProjectId(project.id);
      setStep(2);
    },
  });

  const invite = useServerAction(useServerFn(inviteClient), {
    label: "admin.inviteClient",
    success: "Invitation sent",
    invalidate: [qk.projects(), qk.workspacePeople(workspaceId ?? undefined)],
    onSuccess: () => setStep(3),
  });

  const createTicket = useDataMutation(
    "tickets.insert",
    (input: { title: string; description: string | null }) =>
      createTicketRow({
        project_id: projectId!,
        title: input.title,
        description: input.description,
        type: "feature",
        priority: "medium",
      }),
    {
      success: "You're set up",
      invalidate: [qk.tickets(), qk.projects()],
      onSuccess: (ticket) => {
        clearOnboardingStorage(workspaceId);
        void navigate({ to: "/app/tickets/$ticketId", params: { ticketId: ticket.id } });
      },
    },
  );

  const finishToPeople = () => {
    clearOnboardingStorage(workspaceId);
    if (projectId) {
      void navigate({
        to: "/app/projects/$projectId",
        params: { projectId },
        search: { tab: "people", paid: undefined },
      });
      return;
    }
    void navigate({ to: "/app" });
  };

  return (
    <Card className="mx-auto max-w-xl p-6 sm:p-8">
      <div className="mb-6 flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 className="font-display text-2xl">Let&rsquo;s get you started</h2>
      </div>

      <ol className="mb-6 flex items-center gap-2 text-sm" aria-label="Setup progress">
        <StepDot n={1} label="Project" current={step} />
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
        <StepDot n={2} label="Client" current={step} />
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
        <StepDot n={3} label="Share" current={step} />
      </ol>

      {step === 1 && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!workspaceId) return;
            const form = new FormData(event.currentTarget);
            void project.run({
              title: String(form.get("title")),
              description: String(form.get("description")) || null,
              workspaceId,
            });
          }}
          className="space-y-4"
        >
          <p className="text-sm text-muted-foreground">
            A project is the thing everything else hangs off — tickets, meetings, milestones and
            invoices all belong to one.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="ob-title">What are you building?</Label>
            <Input id="ob-title" name="title" required placeholder="Acme storefront" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ob-description">A line about it (optional)</Label>
            <Textarea id="ob-description" name="description" rows={2} />
          </div>
          <Button type="submit" className="w-full" disabled={project.busy || !workspaceId}>
            {project.busy ? "Creating…" : "Create it"}
            <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
          </Button>
        </form>
      )}

      {step === 2 && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!workspaceId) return;
            const form = new FormData(event.currentTarget);
            void invite.run({
              projectId: projectId ?? undefined,
              workspaceId,
              role: "client_admin",
              email: String(form.get("email")),
              fullName: String(form.get("name")) || undefined,
            });
          }}
          className="space-y-4"
        >
          <p className="text-sm text-muted-foreground">
            Invite your client lead — they&rsquo;ll get a sign-in link and can report things
            straight away, and can invite their own team later.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="ob-email">Their email</Label>
            <Input id="ob-email" name="email" type="email" required autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ob-name">Their name (optional)</Label>
            <Input id="ob-name" name="name" />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setStep(3)}>
              Skip
            </Button>
            <Button type="submit" className="flex-1" disabled={invite.busy || !workspaceId}>
              {invite.busy ? "Inviting…" : "Send the invite"}
            </Button>
          </div>
        </form>
      )}

      {step === 3 && !showTicketForm && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            You&rsquo;re ready. Share the project with your client from People, or optionally seed
            the queue with a first ticket.
          </p>
          <Button className="w-full" onClick={finishToPeople} disabled={!projectId}>
            <Users className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Share with client
          </Button>
          {projectId && (
            <Button variant="outline" className="w-full" asChild>
              <Link
                to="/app/projects/$projectId"
                params={{ projectId }}
                search={{ tab: "people", paid: undefined }}
                onClick={() => clearOnboardingStorage(workspaceId)}
              >
                Open project People
              </Link>
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => setShowTicketForm(true)}
          >
            Or create a first ticket
          </Button>
        </div>
      )}

      {step === 3 && showTicketForm && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void createTicket.run({
              title: String(form.get("title")),
              description: String(form.get("description")) || null,
            });
          }}
          className="space-y-4"
        >
          <p className="text-sm text-muted-foreground">
            Something you already know needs doing. It&rsquo;ll show up in your queue.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="ob-ticket">What needs doing?</Label>
            <Input id="ob-ticket" name="title" required placeholder="Set up staging" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ob-ticket-detail">Details (optional)</Label>
            <Textarea id="ob-ticket-detail" name="description" rows={2} />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setShowTicketForm(false)}>
              Back
            </Button>
            <Button type="submit" className="flex-1" disabled={createTicket.busy || !projectId}>
              {createTicket.busy ? "Creating…" : "Finish"}
              <Check className="ml-1.5 h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function StepDot({ n, label, current }: { n: Step; label: string; current: Step }) {
  const done = current > n;
  const active = current === n;
  return (
    <li className="flex items-center gap-2">
      <span
        aria-current={active ? "step" : undefined}
        className={`grid h-6 w-6 place-items-center rounded-full text-xs font-medium ${
          done
            ? "bg-success/20 text-success"
            : active
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
        }`}
      >
        {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : n}
      </span>
      <span className={active ? "text-sm font-medium" : "text-sm text-muted-foreground"}>
        {label}
      </span>
    </li>
  );
}
