import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, StatusPill, EmptyState, ListSkeleton } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, FolderKanban, Bug, Inbox as InboxIcon } from "lucide-react";
import { OnboardingWizard } from "@/components/onboarding-wizard";

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
        .not("status", "in", "(done,wont_fix)")
        .order("updated_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      return data;
    },
  });

  const noProjects = !projectsQ.isLoading && (projectsQ.data?.length ?? 0) === 0;
  const showOnboarding = isAdmin && noProjects;

  const greeting = greet(user?.user_metadata?.full_name || user?.email?.split("@")[0] || "there");

  return (
    <>
      <PageHeader
        title={greeting}
        description={isAdmin ? "Here's the state of your client work." : "Welcome to your client portal."}
      />
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-8 md:py-10 space-y-10 md:space-y-12">
        {showOnboarding && <OnboardingWizard />}

        {!showOnboarding && (
          <>
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display text-xl md:text-2xl">Recent projects</h2>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/app/projects">All <ArrowRight className="h-4 w-4 ml-1" /></Link>
                </Button>
              </div>
              {projectsQ.isLoading ? (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
                </div>
              ) : noProjects ? (
                <Card>
                  <EmptyState
                    icon={FolderKanban}
                    title="No projects yet"
                    description={isAdmin ? "Create your first client project to get started." : "Your provider hasn't shared a project with you yet — sit tight."}
                    action={isAdmin && <Button asChild><Link to="/app/projects">Create a project</Link></Button>}
                  />
                </Card>
              ) : (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {projectsQ.data!.map((p) => (
                    <Link key={p.id} to="/app/projects/$projectId" params={{ projectId: p.id }}>
                      <Card className="p-5 h-full hover:border-foreground/20 hover:shadow-sm transition-all">
                        <div className="flex items-center justify-between mb-2">
                          <StatusPill tone={statusTone(p.status)}>{p.status.replace("_", " ")}</StatusPill>
                          <span className="text-xs text-muted-foreground">{p.progress}%</span>
                        </div>
                        <h3 className="font-display text-xl">{p.title}</h3>
                        <div className="mt-4 h-1.5 bg-muted rounded overflow-hidden">
                          <div className="h-full bg-primary transition-all" style={{ width: `${p.progress}%` }} />
                        </div>
                      </Card>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2 className="font-display text-xl md:text-2xl mb-4">Open tickets</h2>
              {ticketsQ.isLoading ? (
                <ListSkeleton rows={4} />
              ) : (ticketsQ.data?.length ?? 0) === 0 ? (
                <Card>
                  <EmptyState
                    icon={InboxIcon}
                    title="No open tickets"
                    description={isAdmin ? "Quiet day. Tickets your clients open will appear here." : "Nothing to see — when you report something, it'll show up here."}
                    action={!isAdmin && projectsQ.data?.[0] && (
                      <Button asChild>
                        <Link to="/app/projects/$projectId" params={{ projectId: projectsQ.data[0].id }}>
                          <Bug className="h-4 w-4 mr-1.5" />Report something
                        </Link>
                      </Button>
                    )}
                  />
                </Card>
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
          </>
        )}
      </div>
    </>
  );
}

function greet(name: string) {
  const h = new Date().getHours();
  const prefix = h < 5 ? "Still up" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return `${prefix}, ${name}`;
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
