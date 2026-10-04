import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

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

  // Phone only: once the hero's own buttons have scrolled away, a bar at the
  // bottom keeps the one action a thumb-length away.
  const heroCta = useRef<HTMLDivElement>(null);
  const [stickyCta, setStickyCta] = useState(false);
  useEffect(() => {
    const node = heroCta.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setStickyCta(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-h-screen max-md:min-h-dvh max-md:overflow-x-clip">
      <nav className="px-4 md:px-6 py-5 flex items-center justify-between max-w-6xl mx-auto max-md:pt-[calc(1rem+var(--safe-top))] max-md:pb-3">
        <span className="font-display text-2xl">Boared</span>
        <div className="flex items-center gap-1 md:gap-2">
          <Button variant="ghost" asChild className="max-md:hidden">
            <Link to="/mcp">For agents</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/login">Sign in</Link>
          </Button>
          <Button asChild>
            <Link to="/signup">Get started</Link>
          </Button>
        </div>
      </nav>

      <header className="max-w-4xl mx-auto px-4 md:px-6 pt-12 md:pt-20 pb-16 md:pb-24 text-center max-md:pt-8 max-md:pb-12">
        <p className="text-xs md:text-sm text-muted-foreground uppercase tracking-widest mb-5 md:mb-6">
          Agency workspace · Client portal
        </p>
        <h1 className="font-display text-4xl md:text-[84px] leading-[1.02] tracking-[-0.02em] max-md:text-balance max-md:text-[40px]">
          They point at the problem.
          <br className="hidden md:block" /> You ship the fix.
        </h1>
        <p className="mt-5 md:mt-6 text-base md:text-lg text-muted-foreground max-w-2xl mx-auto px-2">
          A client reports it with a screenshot or a screen recording. You triage it, do the work,
          and they watch the milestone move. When it&rsquo;s done, the invoice is already there.
        </p>
        <div
          ref={heroCta}
          className="mt-8 md:mt-10 flex w-full max-w-md flex-col items-stretch justify-center gap-3 sm:mx-auto sm:max-w-none sm:flex-row sm:items-center"
        >
          <Button size="lg" asChild className="w-full sm:w-auto sm:min-w-[12rem]">
            <Link to="/signup">Create your workspace →</Link>
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
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-16 md:py-24 max-md:py-12">
          <h2 className="font-display text-3xl md:text-5xl text-center">The loop</h2>
          <p className="text-center text-muted-foreground mt-3 max-w-xl mx-auto">
            Every screen is a step in this, or a view of where something sits in it.
          </p>
          <div className="mt-12 grid gap-10 md:grid-cols-3 md:gap-8 max-md:mt-8 max-md:gap-6">
            <Step n="01" title="Report">
              The client records the screen or pastes a screenshot and says what went wrong. No AI
              required to send it.
            </Step>
            <Step n="02" title="Work">
              Triage the ticket, track time, and plan the work. People and agents share the same
              queue. A merged pull request moves the ticket forward.
            </Step>
            <Step n="03" title="Get paid">
              The client sees updates and milestone progress. A finished milestone leads to the
              invoice they can approve and pay.
            </Step>
          </div>
        </div>
      </section>

      <section>
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-16 md:py-20 text-center max-md:py-12">
          <h2 className="font-display text-4xl md:text-5xl">Invite a client. Get a ticket.</h2>
          <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
            Create a workspace, add a project, and send an invite. They can report from their phone.
          </p>
          <div className="mt-8">
            <Button size="lg" asChild className="max-md:w-full">
              <Link to="/signup">Start free →</Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-8 flex items-center justify-between text-sm text-muted-foreground">
          <span className="font-display text-lg text-foreground">Boared</span>
          <div className="flex items-center gap-4">
            <Link
              to="/mcp"
              className="inline-flex min-h-11 items-center underline-offset-4 hover:underline md:hidden"
            >
              For agents
            </Link>
            <span>© {new Date().getFullYear()}</span>
          </div>
        </div>
      </footer>

      <div
        aria-hidden={!stickyCta}
        className={`fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 px-4 pb-[calc(0.75rem+var(--safe-bottom))] pt-3 backdrop-blur transition-transform duration-200 md:hidden ${
          stickyCta ? "translate-y-0" : "pointer-events-none translate-y-full"
        }`}
      >
        <Button size="lg" asChild className="w-full" tabIndex={stickyCta ? 0 : -1}>
          <Link to="/signup">Get started free</Link>
        </Button>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="max-md:flex max-md:items-start max-md:gap-4 max-md:text-left">
      <div className="font-display text-[40px] leading-none text-muted-foreground/60 max-md:w-12 max-md:shrink-0">
        {n}
      </div>
      <div className="max-md:min-w-0">
        <h3 className="mt-2 font-display text-[28px] leading-tight max-md:mt-0">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
