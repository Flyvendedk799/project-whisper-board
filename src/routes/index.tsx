import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { ArrowRight, Bug, CheckCircle2, Receipt, Video } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Boared — Clients report it. You ship it. They can see it." },
      {
        name: "description",
        content:
          "The client points at a problem. The agency fixes it. The client watches it happen, and the milestone gets paid.",
      },
      {
        property: "og:title",
        content: "Boared — Clients report it. You ship it. They can see it.",
      },
      {
        property: "og:description",
        content:
          "Report with a screenshot, triage it, do the work, and invoice the milestone. One place for the agency and the client.",
      },
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
        <span className="font-display text-2xl">Boared</span>
        <div className="flex items-center gap-1 md:gap-2">
          <Button variant="ghost" asChild>
            <Link to="/login">Sign in</Link>
          </Button>
          <Button asChild>
            <Link to="/signup">Get started</Link>
          </Button>
        </div>
      </nav>

      <header className="max-w-4xl mx-auto px-4 md:px-6 pt-12 md:pt-20 pb-16 md:pb-24 text-center">
        <p className="text-xs md:text-sm text-muted-foreground uppercase tracking-widest mb-5 md:mb-6">
          Agency workspace · Client portal
        </p>
        <h1 className="font-display text-4xl md:text-7xl leading-[1.05] tracking-tight">
          They point at the problem.
          <br className="hidden md:block" /> You ship the fix.
        </h1>
        <p className="mt-5 md:mt-6 text-base md:text-lg text-muted-foreground max-w-2xl mx-auto px-2">
          A client reports it with a screenshot or a screen recording. You triage it, do the work,
          and they watch the milestone move. When it&rsquo;s done, the invoice is already there.
        </p>
        <div className="mt-8 md:mt-10 flex w-full max-w-md flex-col items-stretch justify-center gap-3 sm:mx-auto sm:max-w-none sm:flex-row sm:items-center">
          <Button size="lg" asChild className="w-full sm:w-auto sm:min-w-[12rem]">
            <Link to="/signup">
              Create your workspace <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild className="w-full sm:w-auto sm:min-w-[12rem]">
            <Link to="/login">I have an account</Link>
          </Button>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Works without AI. Turn AI on later if you want drafts and triage suggestions.
        </p>
      </header>

      <section className="border-y bg-surface">
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-16 md:py-24">
          <h2 className="font-display text-3xl md:text-5xl text-center">The loop</h2>
          <p className="text-center text-muted-foreground mt-3 max-w-xl mx-auto">
            Every screen is a step in this, or a view of where something sits in it.
          </p>
          <div className="mt-12 grid md:grid-cols-3 gap-8">
            <Step n="01" icon={<Video />} title="Report">
              The client records the screen or pastes a screenshot and says what went wrong. No AI
              required to send it.
            </Step>
            <Step n="02" icon={<Bug />} title="Work">
              Triage the ticket, track time, and plan the work. People and agents share the same
              queue. A merged pull request moves the ticket forward.
            </Step>
            <Step n="03" icon={<Receipt />} title="Get paid">
              The client sees updates and milestone progress. A finished milestone leads to the
              invoice they can approve and pay.
            </Step>
          </div>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 md:px-6 py-16 md:py-24">
        <h2 className="font-display text-3xl md:text-5xl text-center">What you can do today</h2>
        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Tile label="Tickets with capture" />
          <Tile label="Triage and SLAs" />
          <Tile label="Projects and milestones" />
          <Tile label="Quotes and invoices" />
          <Tile label="Time tracking" />
          <Tile label="Client portal" />
          <Tile label="Planner for agents" />
          <Tile label="Reports" />
        </div>
        <p className="mt-8 text-center text-sm text-muted-foreground">
          AI drafting, summaries, and triage suggestions appear only after you configure a provider
          in Settings.
        </p>
      </section>

      <section className="border-t">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-20 md:py-28 text-center">
          <h2 className="font-display text-4xl md:text-6xl">Invite a client. Get a ticket.</h2>
          <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
            Create a workspace, add a project, and send an invite. They can report from their phone.
          </p>
          <div className="mt-8">
            <Button size="lg" asChild>
              <Link to="/signup">
                Start free <ArrowRight className="h-4 w-4 ml-1.5" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-8 flex items-center justify-between text-sm text-muted-foreground">
          <span className="font-display text-lg text-foreground">Boared</span>
          <span>© {new Date().getFullYear()}</span>
        </div>
      </footer>
    </div>
  );
}

function Step({
  n,
  icon,
  title,
  children,
}: {
  n: string;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="font-display text-3xl text-muted-foreground">{n}</span>
        <div className="h-9 w-9 rounded-md bg-background border text-primary grid place-items-center [&>svg]:h-4 [&>svg]:w-4">
          {icon}
        </div>
      </div>
      <h3 className="font-display text-2xl">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}

function Tile({ label }: { label: string }) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="flex items-start gap-2 font-medium">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        {label}
      </div>
    </div>
  );
}
