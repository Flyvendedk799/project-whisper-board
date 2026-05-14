import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, StatusPill } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, FolderKanban } from "lucide-react";

export const Route = createFileRoute("/app/")({
  component: Home,
});

function Home() {
  const { user, isAdmin } = useAuth();

  const projectsQ = useQuery({
    queryKey: ["projects", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id,title,status,progress,updated_at")
        .order("updated_at", { ascending: false })
        .limit(6);
      if (error) throw error;
      return data;
    },
  });

  const ticketsQ = useQuery({
    queryKey: ["tickets-open", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tickets")
        .select("id,title,status,priority,project_id,updated_at")
        .neq("status", "done")
        .neq("status", "closed")
        .order("updated_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      return data;
    },
  });

  return (
    <>
      <PageHeader title="Home" description={isAdmin ? "Everything across your client work." : "Your projects with us."} />
      <div className="max-w-6xl mx-auto px-8 py-10 space-y-12">
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-2xl">Recent projects</h2>
            <Button variant="ghost" size="sm" asChild><Link to="/app/projects">All projects <ArrowRight className="h-4 w-4 ml-1" /></Link></Button>
          </div>
          {projectsQ.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (projectsQ.data?.length ?? 0) === 0 ? (
            <Card className="p-10 text-center">
              <FolderKanban className="h-8 w-8 mx-auto text-muted-foreground" />
              <h3 className="font-display text-xl mt-3">No projects yet</h3>
              <p className="text-sm text-muted-foreground mt-1">{isAdmin ? "Create your first client project to get started." : "Your provider hasn't shared a project with you yet."}</p>
              {isAdmin && <Button className="mt-4" asChild><Link to="/app/projects">Create a project</Link></Button>}
            </Card>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {projectsQ.data!.map((p) => (
                <Link key={p.id} to="/app/projects/$projectId" params={{ projectId: p.id }}>
                  <Card className="p-5 hover:border-foreground/20 transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <StatusPill tone={statusTone(p.status)}>{p.status.replace("_", " ")}</StatusPill>
                      <span className="text-xs text-muted-foreground">{p.progress}%</span>
                    </div>
                    <h3 className="font-display text-xl">{p.title}</h3>
                    <div className="mt-4 h-1.5 bg-muted rounded overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${p.progress}%` }} />
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="font-display text-2xl mb-4">Open tickets</h2>
          {(ticketsQ.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No open tickets. Quiet day.</p>
          ) : (
            <Card className="divide-y">
              {ticketsQ.data!.map((t) => (
                <Link key={t.id} to="/app/tickets/$ticketId" params={{ ticketId: t.id }} className="flex items-center gap-3 p-4 hover:bg-accent/40">
                  <StatusPill tone={priorityTone(t.priority)}>{t.priority}</StatusPill>
                  <span className="flex-1 truncate">{t.title}</span>
                  <StatusPill>{t.status.replace("_", " ")}</StatusPill>
                </Link>
              ))}
            </Card>
          )}
        </section>
      </div>
    </>
  );
}

function statusTone(s: string): "default" | "success" | "warning" | "info" {
  if (s === "live" || s === "completed") return "success";
  if (s === "in_progress") return "info";
  if (s === "on_hold") return "warning";
  return "default";
}
function priorityTone(p: string): "default" | "warning" | "destructive" | "info" {
  if (p === "urgent") return "destructive";
  if (p === "high") return "warning";
  if (p === "low") return "info";
  return "default";
}
