import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bell } from "lucide-react";

export const Route = createFileRoute("/app/inbox")({
  component: Inbox,
});

function Inbox() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const notifs = useQuery({
    queryKey: ["notifs", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  async function markRead(id: string) {
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["notifs"] });
  }

  return (
    <>
      <PageHeader title="Inbox" description="Notifications and updates across your projects." />
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8 md:py-10">
        {(notifs.data?.length ?? 0) === 0 ? (
          <Card className="p-12 text-center">
            <Bell className="h-8 w-8 mx-auto text-muted-foreground" />
            <h3 className="font-display text-xl mt-3">All clear</h3>
            <p className="text-sm text-muted-foreground mt-1">You'll see ticket activity, replies, and milestones here.</p>
          </Card>
        ) : (
          <Card className="divide-y">
            {notifs.data!.map((n) => (
              <div key={n.id} className={`p-4 flex gap-3 ${n.read_at ? "opacity-60" : ""}`}>
                <div className="flex-1">
                  <div className="text-sm font-medium">{n.title}</div>
                  {n.body && <div className="text-sm text-muted-foreground mt-0.5">{n.body}</div>}
                  <div className="text-xs text-muted-foreground mt-1">{new Date(n.created_at).toLocaleString()}</div>
                </div>
                {n.link && <Button variant="ghost" size="sm" asChild><Link to={n.link as any}>Open</Link></Button>}
                {!n.read_at && <Button variant="ghost" size="sm" onClick={() => markRead(n.id)}>Mark read</Button>}
              </div>
            ))}
          </Card>
        )}
      </div>
    </>
  );
}
