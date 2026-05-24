import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { ArrowRight, Bug, MessageSquare, Sparkles, Video, FileText, CheckCircle2, Receipt } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ClientDesk — Client portal & ticket platform" },
      { name: "description", content: "Run every client engagement in one place: tickets, screen recordings, meetings, progress, invoices, and AI." },
      { property: "og:title", content: "ClientDesk — Client portal & ticket platform" },
      { property: "og:description", content: "Tickets, screen recordings, meeting notes, milestones, invoices. One calm place for every client." },
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
      <nav className="px-4 md:px-6 py-5 flex items-center justify-between max-w-6xl mx-auto">
        <span className="font-display text-2xl">ClientDesk</span>
        <div className="flex items-center gap-1 md:gap-2">
          <Button variant="ghost" asChild><Link to="/login">Sign in</Link></Button>
          <Button asChild><Link to="/signup">Get started</Link></Button>
        </div>
      </nav>

      {/* Hero */}
      <header className="max-w-4xl mx-auto px-4 md:px-6 pt-12 md:pt-20 pb-16 md:pb-24 text-center">
        <p className="text-xs md:text-sm text-muted-foreground uppercase tracking-widest mb-5 md:mb-6">Client portal · Ticket platform</p>
        <h1 className="font-display text-4xl md:text-7xl leading-[1.05] tracking-tight">
          Run every client engagement<br className="hidden md:block" /> in one calm place.
        </h1>
        <p className="mt-5 md:mt-6 text-base md:text-lg text-muted-foreground max-w-2xl mx-auto px-2">
          Tickets with screen recordings. Meeting notes that turn into action items. Progress your clients
          can actually see. Invoices when milestones land. AI to keep the noise down.
        </p>
        <div className="mt-8 md:mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Button size="lg" asChild className="w-full sm:w-auto">
            <Link to="/signup">Create your workspace <ArrowRight className="h-4 w-4 ml-1.5" /></Link>
          </Button>
          <Button size="lg" variant="ghost" asChild className="w-full sm:w-auto"><Link to="/login">I have an account</Link></Button>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">Free to start. First admin account is yours.</p>
      </header>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-4 md:px-6 pb-20 md:pb-28">
        <div className="grid md:grid-cols-3 gap-8 md:gap-10 text-left">
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
      </section>

      {/* How it works */}
      <section className="border-y bg-surface">
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-16 md:py-24">
          <h2 className="font-display text-3xl md:text-5xl text-center">How it works</h2>
          <p className="text-center text-muted-foreground mt-3 max-w-xl mx-auto">From inbox chaos to a clean ticket trail in under a minute.</p>
          <div className="mt-12 grid md:grid-cols-3 gap-8">
            <Step n="01" icon={<Video />} title="Capture">Client records a quick screen video or pastes a screenshot — no install, no Loom account.</Step>
            <Step n="02" icon={<FileText />} title="Triage">AI suggests type and priority. You assign, edit, or split into smaller tickets.</Step>
            <Step n="03" icon={<CheckCircle2 />} title="Ship">Move it to done. Milestones tick up. Invoice when the work lands.</Step>
          </div>
        </div>
      </section>

      {/* What's inside */}
      <section className="max-w-5xl mx-auto px-4 md:px-6 py-16 md:py-24">
        <h2 className="font-display text-3xl md:text-5xl text-center">Everything you'd otherwise duct-tape together</h2>
        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Tile icon={<Bug />} label="Tickets" />
          <Tile icon={<Video />} label="Screen recordings" />
          <Tile icon={<MessageSquare />} label="Meeting notes" />
          <Tile icon={<CheckCircle2 />} label="Milestones" />
          <Tile icon={<Receipt />} label="Quotes & invoices" />
          <Tile icon={<FileText />} label="Project updates" />
          <Tile icon={<Sparkles />} label="AI assistant" />
          <Tile icon={<MessageSquare />} label="Client portal" />
        </div>
      </section>

      {/* CTA */}
      <section className="border-t">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-20 md:py-28 text-center">
          <h2 className="font-display text-4xl md:text-6xl">Get your evenings back.</h2>
          <p className="mt-4 text-muted-foreground max-w-xl mx-auto">Spin up a workspace, invite your first client, and stop pasting screenshots into email threads.</p>
          <div className="mt-8">
            <Button size="lg" asChild><Link to="/signup">Start free <ArrowRight className="h-4 w-4 ml-1.5" /></Link></Button>
          </div>
        </div>
      </section>

      <footer className="border-t">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-8 flex items-center justify-between text-sm text-muted-foreground">
          <span className="font-display text-lg text-foreground">ClientDesk</span>
          <span>© {new Date().getFullYear()}</span>
        </div>
      </footer>
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

function Step({ n, icon, title, children }: { n: string; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="font-display text-3xl text-muted-foreground">{n}</span>
        <div className="h-9 w-9 rounded-md bg-background border text-primary grid place-items-center [&>svg]:h-4 [&>svg]:w-4">{icon}</div>
      </div>
      <h3 className="font-display text-2xl">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}

function Tile({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="rounded-lg border bg-card p-5 hover:border-foreground/20 transition-colors">
      <div className="h-9 w-9 rounded-md bg-accent text-primary grid place-items-center mb-3 [&>svg]:h-4 [&>svg]:w-4">{icon}</div>
      <div className="font-medium">{label}</div>
    </div>
  );
}
