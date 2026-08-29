import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { StatusPill } from "@/components/app-shell";
import { CalendarPlus, Sparkles, Video, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { createMeeting, saveMeetingNotes } from "@/lib/meetings.functions";
import { meetingNotesToTickets } from "@/lib/ai.functions";

export function MeetingsTab({ projectId }: { projectId: string }) {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const meetings = useQuery({
    queryKey: ["meetings", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meetings")
        .select("*")
        .eq("project_id", projectId)
        .order("scheduled_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["meetings", projectId] });

  return (
    <div className="space-y-3">
      {isAdmin && <NewMeetingButton projectId={projectId} onCreated={refresh} />}
      {(meetings.data?.length ?? 0) === 0 ? (
        <Card className="p-8 text-sm text-muted-foreground text-center">No meetings yet.</Card>
      ) : (
        <div className="space-y-3">
          {meetings.data!.map((m) => (
            <MeetingCard key={m.id} meeting={m} canEdit={!!isAdmin} onChanged={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}

function NewMeetingButton({ projectId, onCreated }: { projectId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState(30);
  const [agenda, setAgenda] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const fn = useServerFn(createMeeting);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await fn({
        data: {
          projectId,
          title,
          scheduledAt: new Date(when).toISOString(),
          durationMinutes: duration,
          agenda: agenda || undefined,
          meetingUrl: meetingUrl || undefined,
        },
      });
      toast.success("Meeting scheduled");
      setOpen(false);
      setTitle("");
      setWhen("");
      setAgenda("");
      setMeetingUrl("");
      onCreated();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <CalendarPlus className="h-4 w-4 mr-1.5" />
          Schedule meeting
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New meeting</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label>Title</Label>
            <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>When</Label>
              <Input
                type="datetime-local"
                required
                value={when}
                onChange={(e) => setWhen(e.target.value)}
              />
            </div>
            <div>
              <Label>Duration (min)</Label>
              <Input
                type="number"
                min={5}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </div>
          </div>
          <div>
            <Label>Meeting link</Label>
            <Input
              type="url"
              placeholder="https://meet.google.com/…"
              value={meetingUrl}
              onChange={(e) => setMeetingUrl(e.target.value)}
            />
          </div>
          <div>
            <Label>Agenda</Label>
            <Textarea rows={3} value={agenda} onChange={(e) => setAgenda(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? "Scheduling…" : "Schedule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MeetingCard({
  meeting,
  canEdit,
  onChanged,
}: {
  meeting: any;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [notes, setNotes] = useState(meeting.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const save = useServerFn(saveMeetingNotes);
  const extract = useServerFn(meetingNotesToTickets);

  async function saveNotes(complete = false) {
    setBusy(true);
    try {
      await save({ data: { meetingId: meeting.id, notes, markCompleted: complete } });
      toast.success("Notes saved");
      onChanged();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function aiExtract() {
    setAiBusy(true);
    try {
      const r = await extract({ data: { meetingId: meeting.id } });
      toast.success(`Created ${r.count} ticket${r.count === 1 ? "" : "s"} from notes`);
      onChanged();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setAiBusy(false);
    }
  }

  const date = new Date(meeting.scheduled_at);
  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-medium">{meeting.title}</h4>
          <div className="text-xs text-muted-foreground mt-1">
            {date.toLocaleString()} · {meeting.duration_minutes} min
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill tone={meeting.status === "completed" ? "success" : "default"}>
            {meeting.status}
          </StatusPill>
          {meeting.meeting_url && (
            <Button variant="ghost" size="sm" asChild>
              <a href={meeting.meeting_url} target="_blank" rel="noreferrer">
                <Video className="h-4 w-4 mr-1" />
                Join
              </a>
            </Button>
          )}
        </div>
      </div>
      {meeting.agenda && (
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{meeting.agenda}</p>
      )}
      {canEdit && (
        <>
          <Textarea
            rows={5}
            placeholder="Meeting notes & decisions…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" onClick={() => saveNotes(false)} disabled={busy}>
              {busy ? "Saving…" : "Save notes"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => saveNotes(true)} disabled={busy}>
              Mark completed
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={aiExtract}
              disabled={aiBusy || !notes.trim()}
            >
              <Sparkles className="h-4 w-4 mr-1" />
              {aiBusy ? "Extracting…" : "Notes → tickets"}
            </Button>
          </div>
          {meeting.ai_summary && (
            <div className="text-sm text-muted-foreground border-l-2 border-primary/40 pl-3 italic">
              {meeting.ai_summary}
            </div>
          )}
        </>
      )}
      {!canEdit && meeting.notes && <p className="text-sm whitespace-pre-wrap">{meeting.notes}</p>}
    </Card>
  );
}

export { ExternalLink };
