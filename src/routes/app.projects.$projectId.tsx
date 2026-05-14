import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, StatusPill } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, UserPlus, Paperclip, Video } from "lucide-react";
import { toast } from "sonner";
import { TicketAttachmentsField, type DraftAttachment } from "@/components/ticket-attachments-field";
import { inviteClient } from "@/lib/admin.functions";

export const Route = createFileRoute("/app/projects/$projectId")({
  component: ProjectPage,
});

function ProjectPage() {
  const { projectId } = Route.useParams();
  const { isAdmin, user } = useAuth();
  const qc = useQueryClient();

  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("*").eq("id", projectId).single();
      if (error) throw error;
      return data;
    },
  });

  const tickets = useQuery({
    queryKey: ["tickets", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tickets")
        .select("id,title,status,priority,type,updated_at,reporter_id")
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const milestones = useQuery({
    queryKey: ["milestones", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("milestones")
        .select("*")
        .eq("project_id", projectId)
        .order("position");
      if (error) throw error;
      return data;
    },
  });

  const members = useQuery({
    queryKey: ["members", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_members")
        .select("id,user_id,role,profiles:user_id(full_name,email,avatar_url)")
        .eq("project_id", projectId);
      if (error) throw error;
      return data;
    },
  });

  if (project.isLoading) return <div className="p-10 text-muted-foreground">Loading…</div>;
  if (!project.data) return <div className="p-10">Project not found.</div>;

  const p = project.data;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["tickets", projectId] });
    qc.invalidateQueries({ queryKey: ["project", projectId] });
    qc.invalidateQueries({ queryKey: ["members", projectId] });
  };

  return (
    <>
      <PageHeader
        title={p.title}
        description={p.description ?? undefined}
        action={
          <div className="flex gap-2">
            {isAdmin && <InviteClientButton projectId={projectId} onDone={refresh} />}
            <NewTicketButton projectId={projectId} reporterId={user!.id} onCreated={refresh} />
          </div>
        }
      />

      <div className="max-w-6xl mx-auto px-8 py-8">
        <div className="flex items-center gap-3 mb-6 text-sm">
          <StatusPill>{p.status.replace("_", " ")}</StatusPill>
          <span className="text-muted-foreground">{p.progress}% complete</span>
          <div className="flex-1 max-w-xs h-1.5 bg-muted rounded overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${p.progress}%` }} />
          </div>
        </div>

        <Tabs defaultValue="tickets">
          <TabsList>
            <TabsTrigger value="tickets">Tickets ({tickets.data?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="milestones">Milestones</TabsTrigger>
            <TabsTrigger value="people">People</TabsTrigger>
          </TabsList>

          <TabsContent value="tickets" className="mt-6">
            {(tickets.data?.length ?? 0) === 0 ? (
              <Card className="p-10 text-center text-sm text-muted-foreground">No tickets yet. Create one to start the conversation.</Card>
            ) : (
              <Card className="divide-y">
                {tickets.data!.map((t) => (
                  <Link key={t.id} to="/app/tickets/$ticketId" params={{ ticketId: t.id }} className="flex items-center gap-3 p-4 hover:bg-accent/40">
                    <StatusPill tone={priorityTone(t.priority)}>{t.priority}</StatusPill>
                    <span className="text-xs text-muted-foreground uppercase tracking-wide w-16">{t.type}</span>
                    <span className="flex-1 truncate">{t.title}</span>
                    <StatusPill tone={statusTone(t.status)}>{t.status.replace("_", " ")}</StatusPill>
                  </Link>
                ))}
              </Card>
            )}
          </TabsContent>

          <TabsContent value="milestones" className="mt-6 space-y-3">
            {isAdmin && <NewMilestoneRow projectId={projectId} onCreated={() => qc.invalidateQueries({ queryKey: ["milestones", projectId] })} />}
            {(milestones.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No milestones yet.</p>
            ) : (
              <Card className="divide-y">
                {milestones.data!.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 p-4">
                    <StatusPill tone={m.status === "done" ? "success" : m.status === "in_progress" ? "info" : "default"}>{m.status.replace("_", " ")}</StatusPill>
                    <span className="flex-1">{m.title}</span>
                    {m.due_date && <span className="text-xs text-muted-foreground">due {m.due_date}</span>}
                  </div>
                ))}
              </Card>
            )}
          </TabsContent>

          <TabsContent value="people" className="mt-6">
            <Card className="divide-y">
              {(members.data ?? []).map((m: any) => (
                <div key={m.id} className="flex items-center gap-3 p-4">
                  <div className="h-8 w-8 rounded-full bg-accent grid place-items-center text-sm">
                    {(m.profiles?.full_name ?? m.profiles?.email ?? "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium">{m.profiles?.full_name ?? m.profiles?.email}</div>
                    <div className="text-xs text-muted-foreground">{m.profiles?.email}</div>
                  </div>
                  <StatusPill>{m.role}</StatusPill>
                </div>
              ))}
              {(members.data?.length ?? 0) === 0 && (
                <div className="p-6 text-sm text-muted-foreground text-center">No members yet. {isAdmin && "Invite a client above."}</div>
              )}
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

function InviteClientButton({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const invite = useServerFn(inviteClient);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await invite({ data: { email, projectId, fullName: name || undefined } });
      toast.success(`Invited ${email}`);
      setEmail("");
      setName("");
      setOpen(false);
      onDone();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to invite");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><UserPlus className="h-4 w-4 mr-1.5" />Invite client</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Invite to project</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2"><Label>Email</Label><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="space-y-2"><Label>Full name (optional)</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <p className="text-xs text-muted-foreground">They'll get an email with a sign-in link and immediate access to this project.</p>
          <DialogFooter><Button type="submit" disabled={busy}>{busy ? "Inviting…" : "Send invite"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewTicketButton({ projectId, reporterId, onCreated }: { projectId: string; reporterId: string; onCreated: () => void }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<"bug" | "feature" | "question" | "feedback" | "change_request">("bug");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "urgent">("medium");
  const [drafts, setDrafts] = useState<DraftAttachment[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase
      .from("tickets")
      .insert({ project_id: projectId, reporter_id: reporterId, title, description: description || null, type, priority })
      .select("id")
      .single();
    if (error) {
      setBusy(false);
      return toast.error(error.message);
    }
    // Upload attachments
    for (const d of drafts) {
      const path = `${projectId}/${data.id}/${crypto.randomUUID()}-${d.file.name}`;
      const { error: upErr } = await supabase.storage.from(d.bucket).upload(path, d.file, { contentType: d.file.type });
      if (upErr) {
        toast.error(`Upload failed: ${upErr.message}`);
        continue;
      }
      await supabase.from("ticket_attachments").insert({
        ticket_id: data.id,
        uploader_id: reporterId,
        storage_bucket: d.bucket,
        storage_path: path,
        file_name: d.file.name,
        mime_type: d.file.type,
        size_bytes: d.file.size,
        is_recording: d.bucket === "recordings",
      });
    }
    setBusy(false);
    setOpen(false);
    onCreated();
    toast.success("Ticket created");
    navigate({ to: "/app/tickets/$ticketId", params: { ticketId: data.id } });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4 mr-1.5" />New ticket</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Report a ticket</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2"><Label>Title</Label><Input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Summarize the bug, request, or question" /></div>
          <div className="space-y-2"><Label>Description</Label><Textarea rows={5} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What happened? What did you expect?" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>Type</Label>
              <Select value={type} onValueChange={(v: any) => setType(v)}>
                <SelectTrigger /><SelectContent>
                  <SelectItem value="bug">Bug</SelectItem>
                  <SelectItem value="feature">Feature</SelectItem>
                  <SelectItem value="question">Question</SelectItem>
                  <SelectItem value="feedback">Feedback</SelectItem>
                  <SelectItem value="change_request">Change</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Priority</Label>
              <Select value={priority} onValueChange={(v: any) => setPriority(v)}>
                <SelectTrigger /><SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-2"><Paperclip className="h-3.5 w-3.5" />Attachments & screen recording</Label>
            <TicketAttachmentsField drafts={drafts} setDrafts={setDrafts} />
          </div>
          <DialogFooter><Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create ticket"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewMilestoneRow({ projectId, onCreated }: { projectId: string; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  async function add() {
    if (!title.trim()) return;
    const { error } = await supabase.from("milestones").insert({ project_id: projectId, title });
    if (error) return toast.error(error.message);
    setTitle("");
    onCreated();
  }
  return (
    <div className="flex gap-2">
      <Input placeholder="New milestone…" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
      <Button onClick={add}><Plus className="h-4 w-4" /></Button>
    </div>
  );
}

function statusTone(s: string): "default" | "success" | "info" | "warning" {
  if (s === "done") return "success";
  if (s === "in_progress" || s === "in_review") return "info";
  if (s === "triaged") return "warning";
  return "default";
}
function priorityTone(p: string): "default" | "warning" | "destructive" | "info" {
  if (p === "urgent") return "destructive";
  if (p === "high") return "warning";
  if (p === "low") return "info";
  return "default";
}

export { Video };
