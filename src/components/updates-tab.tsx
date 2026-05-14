import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { postUpdate } from "@/lib/meetings.functions";

export function UpdatesTab({ projectId }: { projectId: string }) {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const updates = useQuery({
    queryKey: ["updates", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_updates")
        .select("*,author:author_id(full_name,email)")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["updates", projectId] });

  return (
    <div className="space-y-4">
      {isAdmin && <NewUpdateForm projectId={projectId} onPosted={refresh} />}
      {(updates.data?.length ?? 0) === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">No updates posted yet.</Card>
      ) : (
        <div className="space-y-3">
          {updates.data!.map((u) => (
            <Card key={u.id} className="p-5">
              <div className="text-xs text-muted-foreground mb-1">
                {u.author?.full_name ?? u.author?.email ?? "System"} · {new Date(u.created_at).toLocaleString()}
              </div>
              {u.title && <h4 className="font-medium">{u.title}</h4>}
              {u.body && <p className="text-sm mt-2 whitespace-pre-wrap">{u.body}</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function NewUpdateForm({ projectId, onPosted }: { projectId: string; onPosted: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const post = useServerFn(postUpdate);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await post({ data: { projectId, title, body: body || undefined } });
      toast.success("Update posted");
      setTitle(""); setBody(""); onPosted();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-2">
      <Input placeholder="Update title…" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Textarea rows={3} placeholder="What's new on this project?" value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="flex justify-end"><Button type="submit" disabled={busy}>{busy ? "Posting…" : "Post update"}</Button></div>
    </form>
  );
}
