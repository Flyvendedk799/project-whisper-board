import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useServerAction, useDataMutation } from "@/lib/use-server-action";
import { inviteClient } from "@/lib/admin.functions";
import { qk } from "@/data/keys";
import { createProject, createTicketRow } from "@/data/mutations";

/**
 * First run. Three steps, because a project with no client and no tickets does
 * not show you what the app is for.
 */
type Step = 1 | 2 | 3;

export function OnboardingWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [projectId, setProjectId] = useState<string | null>(null);

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
    invalidate: [qk.projects(), qk.workspacePeople()],
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
      onSuccess: (ticket) =>
        void navigate({ to: "/app/tickets/$ticketId", params: { ticketId: ticket.id } }),
    },
  );

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
        <StepDot n={3} label="First ticket" current={step} />
      </ol>

      {step === 1 && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void project.run({
              title: String(form.get("title")),
              description: String(form.get("description")) || null,
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
          <Button type="submit" className="w-full" disabled={project.busy}>
            {project.busy ? "Creating…" : "Create it"}
            <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
          </Button>
        </form>
      )}

      {step === 2 && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void invite.run({
              projectId: projectId ?? undefined,
              email: String(form.get("email")),
              fullName: String(form.get("name")) || undefined,
            });
          }}
          className="space-y-4"
        >
          <p className="text-sm text-muted-foreground">
            They&rsquo;ll get a sign-in link and can report things straight away — with a screenshot
            and a recording, not a paragraph of guesswork.
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
            <Button type="submit" className="flex-1" disabled={invite.busy}>
              {invite.busy ? "Inviting…" : "Send the invite"}
            </Button>
          </div>
        </form>
      )}

      {step === 3 && (
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
          <Button type="submit" className="w-full" disabled={createTicket.busy || !projectId}>
            {createTicket.busy ? "Creating…" : "Finish"}
            <Check className="ml-1.5 h-4 w-4" aria-hidden="true" />
          </Button>
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
