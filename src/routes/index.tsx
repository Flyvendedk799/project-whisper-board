import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { ArrowRight, Bug, MessageSquare, Sparkles } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ClientDesk — Client portal & ticket platform" },
      { name: "description", content: "Run every client engagement in one place: tickets, screen recordings, meetings, progress, invoices, and AI." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && user) navigate({ to: "/app" });
  }, [loading, user, navigate]);

  return (
    <div className="min-h-screen">
      <nav className="px-6 py-5 flex items-center justify-between max-w-6xl mx-auto">
        <span className="font-display text-2xl">ClientDesk</span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" asChild><Link to="/login">Sign in</Link></Button>
          <Button asChild><Link to="/signup">Get started</Link></Button>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 pt-20 pb-32 text-center">
        <p className="text-sm text-muted-foreground uppercase tracking-widest mb-6">Client portal · Ticket platform</p>
        <h1 className="font-display text-6xl md:text-7xl leading-[1.05] tracking-tight">
          Run every client engagement<br />in one calm place.
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
          Tickets with screen recordings. Meeting notes that turn into action items. Progress your clients
          can actually see. Invoices when milestones land. AI to keep the noise down.
        </p>
        <div className="mt-10 flex items-center justify-center gap-3">
          <Button size="lg" asChild>
            <Link to="/signup">Create your workspace <ArrowRight className="h-4 w-4 ml-1.5" /></Link>
          </Button>
          <Button size="lg" variant="ghost" asChild><Link to="/login">Sign in</Link></Button>
        </div>

        <div className="mt-24 grid md:grid-cols-3 gap-8 text-left">
          <Feature icon={<Bug />} title="Tickets that explain themselves">
            Drag-drop screenshots, paste from clipboard, or hit record — clients send proper bug reports without thinking about it.
          </Feature>
          <Feature icon={<MessageSquare />} title="One thread per thing">
            Conversations, decisions, and status changes live on the ticket. No more lost Slack messages.
          </Feature>
          <Feature icon={<Sparkles />} title="AI that does the boring parts">
            Summarize long threads, auto-triage new tickets, turn meeting notes into action items, draft replies.
          </Feature>
        </div>
      </main>
    </div>
  );
}

function Feature({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="h-9 w-9 rounded-md bg-accent text-primary grid place-items-center [&>svg]:h-4 [&>svg]:w-4">{icon}</div>
      <h3 className="font-display text-xl">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}
