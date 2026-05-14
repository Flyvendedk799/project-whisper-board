import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, StatusPill } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Wand2, ArrowLeft, Image as ImageIcon, Video, FileText } from "lucide-react";
import { toast } from "sonner";
import { TicketAttachmentsField, type DraftAttachment } from "@/components/ticket-attachments-field";
import { signedAttachmentUrl } from "@/lib/admin.functions";
import { summarizeTicket, draftReply } from "@/lib/ai.functions";

export const Route = createFileRoute("/app/tickets/$ticketId")({
  component: TicketPage,
});

const STATUSES = ["open", "triaged", "in_progress", "in_review", "done", "wont_fix"] as const;

function TicketPage() {
  const { ticketId } = Route.useParams();
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();

  const ticket = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tickets")
        .select("*,project:project_id(id,title),reporter:reporter_id(full_name,email)")
        .eq("id", ticketId)
        .single();
      if (error) throw error;
      return data as any;
    },
  });

  const comments = useQuery({
    queryKey: ["comments", ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ticket_comments")
        .select("*,author:author_id(full_name,email)")
        .eq("ticket_id", ticketId)
        .order("created_at");
      if (error) throw error;
      return data as any[];
    },
  });

  const attachments = useQuery({
    queryKey: ["attachments", ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ticket_attachments")
        .select("*")
        .eq("ticket_id", ticketId)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  // Realtime updates
  useEffect(() => {
    const ch = supabase
      .channel(`ticket:${ticketId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ticket_comments", filter: `ticket_id=eq.${ticketId}` }, () => {
        qc.invalidateQueries({ queryKey: ["comments", ticketId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets", filter: `id=eq.${ticketId}` }, () => {
        qc.invalidateQueries({ queryKey: ["ticket", ticketId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [ticketId, qc]);

  if (ticket.isLoading) return <div className="p-10 text-muted-foreground">Loading…</div>;
  if (!ticket.data) return <div className="p-10">Ticket not found.</div>;

  const t = ticket.data;
  return (
    <>
      <PageHeader
        title={t.title}
        description={
          <>Reported by {t.reporter?.full_name ?? t.reporter?.email ?? "—"} · in <Link to="/app/projects/$projectId" params={{ projectId: t.project.id }} className="underline">{t.project.title}</Link></> as any
        }
        action={
          <Button variant="ghost" asChild>
            <Link to="/app/projects/$projectId" params={{ projectId: t.project.id }}><ArrowLeft className="h-4 w-4 mr-1" />Back</Link>
          </Button>
        }
      />
      <div className="max-w-6xl mx-auto px-8 py-8 grid lg:grid-cols-[1fr_280px] gap-8">
        <div className="space-y-6 min-w-0">
          <Card className="p-5">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <StatusPill tone={priorityTone(t.priority)}>{t.priority}</StatusPill>
              <StatusPill>{t.type}</StatusPill>
              <StatusPill tone={statusTone(t.status)}>{t.status.replace("_", " ")}</StatusPill>
            </div>
            {t.description ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{t.description}</p> : <p className="text-sm text-muted-foreground">No description</p>}
          </Card>

          {(attachments.data?.length ?? 0) > 0 && (
            <Card className="p-5 space-y-3">
              <h3 className="font-medium text-sm">Attachments</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {attachments.data!.map((a) => <AttachmentTile key={a.id} att={a} />)}
              </div>
            </Card>
          )}

          {isAdmin && t.ai_summary && (
            <Card className="p-5 bg-accent/40">
              <div className="flex items-center gap-2 text-sm font-medium mb-2"><Sparkles className="h-4 w-4 text-primary" />AI summary</div>
              <p className="text-sm whitespace-pre-wrap">{t.ai_summary}</p>
            </Card>
          )}

          <div className="space-y-4">
            <h3 className="font-display text-2xl">Conversation</h3>
            {(comments.data?.length ?? 0) === 0 && <p className="text-sm text-muted-foreground">No comments yet.</p>}
            {comments.data?.map((c) => (
              <div key={c.id} className="flex gap-3">
                <div className="h-8 w-8 rounded-full bg-accent grid place-items-center text-xs shrink-0">
                  {(c.author?.full_name ?? c.author?.email ?? "?").charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <span className="font-medium text-foreground">{c.author?.full_name ?? c.author?.email}</span>
                    <span>·</span>
                    <span>{new Date(c.created_at).toLocaleString()}</span>
                    {c.is_internal && <StatusPill tone="warning">Internal</StatusPill>}
                  </div>
                  <Card className="p-3 text-sm whitespace-pre-wrap">{c.body}</Card>
                </div>
              </div>
            ))}
            <CommentBox ticketId={ticketId} authorId={user!.id} isAdmin={!!isAdmin} onSent={() => qc.invalidateQueries({ queryKey: ["comments", ticketId] })} />
          </div>
        </div>

        <aside className="space-y-4">
          {isAdmin && (
            <Card className="p-4 space-y-3">
              <h4 className="text-sm font-medium">Manage</h4>
              <div>
                <label className="text-xs text-muted-foreground">Status</label>
                <Select value={t.status} onValueChange={async (v) => {
                  await supabase.from("tickets").update({ status: v as any }).eq("id", ticketId);
                  qc.invalidateQueries({ queryKey: ["ticket", ticketId] });
                }}>
                  <SelectTrigger className="mt-1" /><SelectContent>
                    {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Priority</label>
                <Select value={t.priority} onValueChange={async (v) => {
                  await supabase.from("tickets").update({ priority: v as any }).eq("id", ticketId);
                  qc.invalidateQueries({ queryKey: ["ticket", ticketId] });
                }}>
                  <SelectTrigger className="mt-1" /><SelectContent>
                    {["low", "medium", "high", "urgent"].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <AISummaryButton ticketId={ticketId} onDone={() => qc.invalidateQueries({ queryKey: ["ticket", ticketId] })} />
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}

function CommentBox({ ticketId, authorId, isAdmin, onSent }: { ticketId: string; authorId: string; isAdmin: boolean; onSent: () => void }) {
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<DraftAttachment[]>([]);
  const draftReplyFn = useServerFn(draftReply);

  async function send() {
    if (!body.trim() && drafts.length === 0) return;
    setBusy(true);
    if (body.trim()) {
      const { error } = await supabase.from("ticket_comments").insert({ ticket_id: ticketId, author_id: authorId, body, is_internal: internal });
      if (error) { setBusy(false); return toast.error(error.message); }
    }
    for (const d of drafts) {
      const path = `${ticketId}/${crypto.randomUUID()}-${d.file.name}`;
      const { error: upErr } = await supabase.storage.from(d.bucket).upload(path, d.file, { contentType: d.file.type });
      if (upErr) { toast.error(upErr.message); continue; }
      await supabase.from("ticket_attachments").insert({
        ticket_id: ticketId, uploader_id: authorId, storage_bucket: d.bucket, storage_path: path,
        file_name: d.file.name, mime_type: d.file.type, size_bytes: d.file.size, is_recording: d.bucket === "recordings",
      });
    }
    setBody(""); setDrafts([]); setInternal(false); setBusy(false); onSent();
  }

  async function aiDraft() {
    try {
      const { reply } = await draftReplyFn({ data: { ticketId } });
      setBody((b) => (b ? b + "\n\n" : "") + reply);
    } catch (e: any) { toast.error(e.message); }
  }

  return (
    <Card className="p-4 space-y-3">
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Write a reply…" />
      <TicketAttachmentsField drafts={drafts} setDrafts={setDrafts} />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-sm">
          {isAdmin && (
            <label className="flex items-center gap-1.5 text-muted-foreground">
              <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
              Internal note
            </label>
          )}
          {isAdmin && <Button type="button" variant="ghost" size="sm" onClick={aiDraft}><Wand2 className="h-4 w-4 mr-1" />AI draft</Button>}
        </div>
        <Button onClick={send} disabled={busy}>{busy ? "Sending…" : "Send"}</Button>
      </div>
    </Card>
  );
}

function AISummaryButton({ ticketId, onDone }: { ticketId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const summarize = useServerFn(summarizeTicket);
  return (
    <Button variant="outline" className="w-full" disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        const { summary } = await summarize({ data: { ticketId } });
        await supabase.from("tickets").update({ ai_summary: summary }).eq("id", ticketId);
        toast.success("Summarized");
        onDone();
      } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
    }}>
      <Sparkles className="h-4 w-4 mr-1.5" />{busy ? "Summarizing…" : "Summarize thread"}
    </Button>
  );
}

function AttachmentTile({ att }: { att: any }) {
  const [url, setUrl] = useState<string | null>(null);
  const sign = useServerFn(signedAttachmentUrl);
  useEffect(() => {
    sign({ data: { bucket: att.storage_bucket, path: att.storage_path } }).then((r) => setUrl(r.url)).catch(() => {});
  }, [att.id]);

  const isImage = att.mime_type?.startsWith("image/");
  const isVideo = att.mime_type?.startsWith("video/") || att.is_recording;

  return (
    <a href={url ?? "#"} target="_blank" rel="noreferrer" className="block group">
      <div className="aspect-video bg-muted rounded overflow-hidden grid place-items-center">
        {url && isImage ? <img src={url} alt={att.file_name} className="w-full h-full object-cover" /> :
         url && isVideo ? <video src={url} className="w-full h-full object-cover" /> :
         <FileText className="h-8 w-8 text-muted-foreground" />}
      </div>
      <div className="text-xs mt-1 truncate group-hover:text-primary">{att.file_name}</div>
    </a>
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

export { ImageIcon, Video };
