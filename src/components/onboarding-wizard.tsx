import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Check, Sparkles, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { inviteClient } from "@/lib/admin.functions";
import { useNavigate } from "@tanstack/react-router";

type Step = 1 | 2 | 3;

export function OnboardingWizard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const invite = useServerFn(inviteClient);

  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);

  // Step 1
  const [projectTitle, setProjectTitle] = useState("");
  const [projectDesc, setProjectDesc] = useState("");

  // Step 2
  const [clientEmail, setClientEmail] = useState("");
  const [clientName, setClientName] = useState("");

  // Step 3
  const [ticketTitle, setTicketTitle] = useState("");
  const [ticketDesc, setTicketDesc] = useState("");

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("projects")
      .insert({ title: projectTitle, description: projectDesc || null, created_by: user.id })
      .select("id")
      .single();
    setBusy(false);
    if (error) return toast.error(error.message);
    setProjectId(data.id);
    setStep(2);
    qc.invalidateQueries({ queryKey: ["projects"] });
    qc.invalidateQueries({ queryKey: ["projects-all"] });
  }

  async function inviteAndContinue(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId) return;
    if (!clientEmail) { setStep(3); return; }
    setBusy(true);
    try {
      await invite({ data: { email: clientEmail, projectId, fullName: clientName || undefined } });
      toast.success("Invite sent");
      setStep(3);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function createTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId || !user) return;
    setBusy(true);
    const { error } = await supabase.from("tickets").insert({
      project_id: projectId,
      reporter_id: user.id,
      title: ticketTitle,
      description: ticketDesc || null,
      type: "task",
      priority: "medium",
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("All set");
    navigate({ to: "/app/projects/$projectId", params: { projectId } });
  }

  return (
    <Card className="max-w-2xl mx-auto p-6 md:p-8 mt-4">
      <div className="flex items-center gap-2 text-sm text-primary mb-2">
        <Sparkles className="h-4 w-4" />
        <span className="font-medium">Let's get you set up</span>
      </div>
      <h2 className="font-display text-2xl md:text-3xl">Three quick steps</h2>
      <p className="text-sm text-muted-foreground mt-1">Create a project, invite your client, drop in the first ticket.</p>

      <Stepper step={step} />

      {step === 1 && (
        <form onSubmit={createProject} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pt">Project title</Label>
            <Input id="pt" placeholder="Acme website redesign" value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pd">What's it about? <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea id="pd" rows={3} value={projectDesc} onChange={(e) => setProjectDesc(e.target.value)} />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !projectTitle.trim()}>
              {busy ? "Creating…" : "Create project"} <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </div>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={inviteAndContinue} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ce">Client email</Label>
            <Input id="ce" type="email" placeholder="client@company.com" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} />
            <p className="text-xs text-muted-foreground">They'll get an email invite to join their portal.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cn">Their name <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input id="cn" value={clientName} onChange={(e) => setClientName(e.target.value)} />
          </div>
          <div className="flex justify-between">
            <Button type="button" variant="ghost" onClick={() => setStep(3)}>Skip</Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Inviting…" : clientEmail ? "Send invite" : "Continue"} <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </div>
        </form>
      )}

      {step === 3 && (
        <form onSubmit={createTicket} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tt">First ticket title</Label>
            <Input id="tt" placeholder="Set up staging environment" value={ticketTitle} onChange={(e) => setTicketTitle(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="td">Details <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea id="td" rows={3} value={ticketDesc} onChange={(e) => setTicketDesc(e.target.value)} />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !ticketTitle.trim()}>
              {busy ? "Creating…" : "Finish setup"} <Check className="h-4 w-4 ml-1.5" />
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function Stepper({ step }: { step: Step }) {
  const items = [
    { n: 1, label: "Project" },
    { n: 2, label: "Invite client" },
    { n: 3, label: "First ticket" },
  ];
  return (
    <div className="flex items-center gap-2 my-6">
      {items.map((it, i) => (
        <div key={it.n} className="flex items-center gap-2 flex-1 min-w-0">
          <div className={`h-7 w-7 rounded-full grid place-items-center text-xs font-medium shrink-0 ${
            step > it.n ? "bg-primary text-primary-foreground" :
            step === it.n ? "bg-primary text-primary-foreground" :
            "bg-muted text-muted-foreground"
          }`}>
            {step > it.n ? <Check className="h-3.5 w-3.5" /> : it.n}
          </div>
          <span className={`text-xs truncate ${step === it.n ? "text-foreground font-medium" : "text-muted-foreground"}`}>{it.label}</span>
          {i < items.length - 1 && <div className={`h-px flex-1 ${step > it.n ? "bg-primary/40" : "bg-border"}`} />}
        </div>
      ))}
    </div>
  );
}
