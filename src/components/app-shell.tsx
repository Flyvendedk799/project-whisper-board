import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { FolderKanban, Inbox, Settings, LogOut, Home, Sparkles, Bell, Menu, Bug } from "lucide-react";

export function AppShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { user, isAdmin, loading } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  if (loading || !user) {
    return (
      <div className="min-h-screen p-6 space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 border-r bg-sidebar flex-col">
        <SidebarInner isAdmin={!!isAdmin} user={user} onNavigate={() => {}} />
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 inset-x-0 z-40 h-14 border-b bg-background/90 backdrop-blur flex items-center justify-between px-3">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open menu" className="h-11 w-11">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-72 bg-sidebar">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SidebarInner isAdmin={!!isAdmin} user={user} onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
        <Link to="/app" className="font-display text-xl">ClientDesk</Link>
        <NotificationBell />
      </div>

      <main className="flex-1 min-w-0 pt-14 md:pt-0">{children}</main>

      {/* Floating "Report a bug" for clients */}
      {!isAdmin && <ReportBugFab />}
    </div>
  );
}

function SidebarInner({ isAdmin, user, onNavigate }: { isAdmin: boolean; user: any; onNavigate: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const nav = [
    { to: "/app", label: "Home", icon: Home, exact: true },
    { to: "/app/projects", label: "Projects", icon: FolderKanban },
    { to: "/app/inbox", label: "Inbox", icon: Inbox },
    { to: "/app/settings", label: "Settings", icon: Settings },
  ];
  return (
    <>
      <div className="px-5 py-5 border-b">
        <Link to="/app" onClick={onNavigate} className="font-display text-2xl">ClientDesk</Link>
        <p className="text-xs text-muted-foreground mt-0.5">{isAdmin ? "Admin workspace" : "Client portal"}</p>
      </div>
      <nav className="flex-1 px-2 py-3 space-y-0.5 text-sm">
        {nav.map((n) => {
          const active = n.exact ? location.pathname === n.to : location.pathname.startsWith(n.to);
          return (
            <Link
              key={n.to}
              to={n.to}
              onClick={onNavigate}
              className={`flex items-center gap-2 px-3 py-2.5 md:py-1.5 rounded-md transition-colors ${
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
    </>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: any; action?: React.ReactNode }) {
  return (
    <div className="border-b bg-background/60 backdrop-blur sticky top-14 md:top-0 z-20">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-4 md:py-6 flex flex-col md:flex-row md:items-end md:justify-between gap-3 md:gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl md:text-3xl truncate">{title}</h1>
          {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {action}
          <span className="hidden md:inline-flex"><NotificationBell /></span>
        </div>
      </div>
    </div>
  );
}

function NotificationBell() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["notif-count", user?.id],
    enabled: !!user,
    refetchInterval: 30000,
    queryFn: async () => {
      const { count } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .is("read_at", null);
      return count ?? 0;
    },
  });
  return (
    <Button variant="ghost" size="icon" asChild className="relative h-11 w-11 md:h-9 md:w-9" aria-label="Inbox">
      <Link to="/app/inbox">
        <Bell className="h-4 w-4" />
        {(data ?? 0) > 0 && (
          <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-primary" />
        )}
      </Link>
    </Button>
  );
}

function ReportBugFab() {
  return (
    <Button asChild size="lg" className="fixed bottom-5 right-5 z-30 shadow-lg rounded-full h-14 px-5 md:hidden">
      <Link to="/app/projects"><Bug className="h-5 w-5 mr-2" />Report</Link>
    </Button>
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

export function EmptyState({ icon: Icon, title, description, action }: { icon: any; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="text-center py-12 px-6">
      <div className="mx-auto h-14 w-14 rounded-2xl bg-accent grid place-items-center mb-4">
        <Icon className="h-6 w-6 text-primary" />
      </div>
      <h3 className="font-display text-2xl">{title}</h3>
      {description && <p className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
    </div>
  );
}

export { Sparkles };
