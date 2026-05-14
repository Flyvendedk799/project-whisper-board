import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Inbox, FolderKanban, Users, Sparkles, LogOut } from "lucide-react";

export const Route = createFileRoute("/app")({
  head: () => ({ meta: [{ title: "Workspace · ClientDesk" }] }),
  component: AppHome,
});

function AppHome() {
  const navigate = useNavigate();
  const { user, isAdmin, loading, signOut } = useAuth();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  if (loading || !user) return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading…</div>;

  return (
    <div className="min-h-screen">
      <header className="border-b bg-sidebar">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-xl font-display">ClientDesk</h1>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{user.email}</span>
            <span className="px-2 py-0.5 text-xs rounded bg-accent">{isAdmin ? "Admin" : "Client"}</span>
            <Button variant="ghost" size="sm" onClick={() => signOut()}><LogOut className="h-4 w-4 mr-1.5" />Sign out</Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12 space-y-10">
        <section>
          <h2 className="text-4xl font-display mb-2">Welcome{user.user_metadata?.full_name ? `, ${user.user_metadata.full_name}` : ""}.</h2>
          <p className="text-muted-foreground">Phase 1 of your platform is ready. Foundations are in place — the rest of the workspace will be built out next.</p>
        </section>

        <section className="grid md:grid-cols-2 gap-4">
          <Card className="p-6 space-y-2">
            <div className="flex items-center gap-2 text-sm text-success font-medium">✓ Done</div>
            <h3 className="font-display text-2xl">Foundation</h3>
            <ul className="text-sm text-muted-foreground space-y-1.5 list-disc list-inside">
              <li>Database with 18 tables (projects, tickets, meetings, billing, AI cache)</li>
              <li>Row-level security: clients only see their own projects</li>
              <li>Auth with email + password, magic link, and Google-ready</li>
              <li>First account auto-promoted to admin (that's you)</li>
              <li>Notion-style design system (Instrument Serif + Inter, warm cream + ink)</li>
              <li>Private storage buckets for attachments & screen recordings</li>
            </ul>
          </Card>

          <Card className="p-6 space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground font-medium">Coming next</div>
            <h3 className="font-display text-2xl">The full workspace</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-start gap-2"><FolderKanban className="h-4 w-4 mt-0.5 text-primary" /><span>Projects + kanban</span></div>
              <div className="flex items-start gap-2"><Inbox className="h-4 w-4 mt-0.5 text-primary" /><span>Tickets + screen rec</span></div>
              <div className="flex items-start gap-2"><Users className="h-4 w-4 mt-0.5 text-primary" /><span>Client portal</span></div>
              <div className="flex items-start gap-2"><Sparkles className="h-4 w-4 mt-0.5 text-primary" /><span>AI triage & summaries</span></div>
            </div>
            <p className="text-xs text-muted-foreground pt-2">Just say "continue" and I'll build the next phase: project list, ticket kanban, and the client-facing portal.</p>
          </Card>
        </section>
      </main>
    </div>
  );
}
