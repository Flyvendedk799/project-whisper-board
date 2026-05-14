import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { FolderKanban, Inbox, Settings, LogOut, Home, Sparkles } from "lucide-react";

export function AppShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAdmin, loading, signOut } = useAuth();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  if (loading || !user) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading…</div>;
  }

  const nav = [
    { to: "/app", label: "Home", icon: Home, exact: true },
    { to: "/app/projects", label: "Projects", icon: FolderKanban },
    { to: "/app/inbox", label: "Inbox", icon: Inbox },
    { to: "/app/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-60 shrink-0 border-r bg-sidebar flex flex-col">
        <div className="px-5 py-5 border-b">
          <Link to="/app" className="font-display text-2xl">ClientDesk</Link>
          <p className="text-xs text-muted-foreground mt-0.5">{isAdmin ? "Admin workspace" : "Client portal"}</p>
        </div>
        <nav className="flex-1 px-2 py-3 space-y-0.5 text-sm">
          {nav.map((n) => {
            const active = n.exact ? location.pathname === n.to : location.pathname.startsWith(n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors ${
                  active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                }`}
              >
                <n.icon className="h-4 w-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t space-y-2">
          <div className="px-2 text-xs">
            <div className="font-medium truncate">{user.user_metadata?.full_name || user.email}</div>
            <div className="text-muted-foreground truncate">{user.email}</div>
          </div>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => signOut().then(() => navigate({ to: "/login" }))}>
            <LogOut className="h-4 w-4 mr-2" />Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="border-b bg-background/60 backdrop-blur sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-8 py-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">{title}</h1>
          {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        </div>
        {action}
      </div>
    </div>
  );
}

export const StatusPill = ({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "success" | "warning" | "info" | "destructive" }) => {
  const tones: Record<string, string> = {
    default: "bg-muted text-muted-foreground",
    success: "bg-success/15 text-success",
    warning: "bg-warning/15 text-warning",
    info: "bg-info/15 text-info",
    destructive: "bg-destructive/15 text-destructive",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${tones[tone]}`}>{children}</span>;
};

export { Sparkles };
