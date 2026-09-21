import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  Bug,
  FolderKanban,
  Home,
  Inbox,
  ListFilter,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sun,
  Ticket,
  BrainCircuit,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { unreadCountQuery } from "@/data/notifications";
import { RunningTimerBar } from "@/features/time/running-timer-bar";
import { CommandPalette } from "@/components/command-palette";

export function AppShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { user, isAdmin, loading, rolesStatus, refetchRoles } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  if (loading || !user) {
    return (
      <div className="min-h-screen space-y-4 p-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  /**
   * Roles decide whether this person sees the admin workspace or the client
   * portal. If the lookup failed we genuinely do not know which — and the old
   * code's answer was to fall through to "client", quietly showing an admin the
   * wrong app. Better to say so and offer a retry.
   */
  if (rolesStatus === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div role="alert" className="max-w-sm text-center">
          <h1 className="font-display text-2xl">Couldn&rsquo;t load your account</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            We couldn&rsquo;t work out what you have access to, so we haven&rsquo;t guessed.
          </p>
          <Button className="mt-5" onClick={refetchRoles}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar md:flex">
        <SidebarInner isAdmin={isAdmin} onNavigate={() => {}} />
      </aside>

      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b bg-background/90 px-3 backdrop-blur md:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open navigation" className="h-11 w-11">
              <Menu className="h-5 w-5" aria-hidden="true" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 bg-sidebar p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SidebarInner isAdmin={isAdmin} onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
        <Link to="/app" className="font-display text-xl">
          Consflow
        </Link>
        <NotificationBell />
      </div>

      <main id="main" className="min-w-0 flex-1 pt-14 md:pt-0">
        {children}
      </main>

      <CommandPalette />
      <RunningTimerBar />
      {!isAdmin && <ReportFab />}
    </div>
  );
}

function SidebarInner({ isAdmin, onNavigate }: { isAdmin: boolean; onNavigate: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const nav = [
    { to: "/app", label: "Home", icon: Home, exact: true },
    ...(isAdmin
      ? [{ to: "/app/triage", label: "Triage", icon: ListFilter, exact: false }]
      : [{ to: "/app/tickets", label: "My tickets", icon: Ticket, exact: true }]),
    { to: "/app/projects", label: "Projects", icon: FolderKanban, exact: false },
    { to: "/app/planner", label: "AI Planner", icon: BrainCircuit, exact: false },
    { to: "/app/inbox", label: "Inbox", icon: Inbox, exact: false },
    { to: "/app/settings", label: "Settings", icon: Settings, exact: false },
  ];

  return (
    <>
      <div className="border-b px-5 py-5">
        <Link to="/app" onClick={onNavigate} className="font-display text-2xl">
          Consflow
        </Link>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {isAdmin ? "Admin workspace" : "Client portal"}
        </p>
      </div>

      <nav aria-label="Main" className="flex-1 space-y-0.5 px-2 py-3 text-sm">
        {nav.map((item) => {
          const active = item.exact
            ? location.pathname === item.to
            : location.pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2 rounded-md px-3 py-2.5 transition-colors md:py-1.5 ${
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              }`}
            >
              <item.icon className="h-4 w-4" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {!isAdmin && (
        <div className="px-3 pb-2">
          <Button asChild className="w-full" onClick={onNavigate}>
            <Link to="/app/report">
              <Bug className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Report an issue
            </Link>
          </Button>
        </div>
      )}

      <div className="space-y-2 border-t p-3">
        <div className="px-2 text-xs">
          <div className="truncate font-medium">
            {user?.user_metadata?.full_name || user?.email}
          </div>
          <div className="truncate text-muted-foreground">{user?.email}</div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 justify-start"
            onClick={() => void signOut().then(() => navigate({ to: "/login" }))}
          >
            <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
            Sign out
          </Button>
          <ThemeToggle />
        </div>
      </div>
    </>
  );
}

export function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={`Switch to ${resolved === "dark" ? "light" : "dark"} theme`}
    >
      {resolved === "dark" ? (
        <Sun className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4" aria-hidden="true" />
      )}
    </Button>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="sticky top-14 z-20 border-b bg-background/60 backdrop-blur md:top-0">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 md:flex-row md:items-end md:justify-between md:gap-4 md:px-8 md:py-6">
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl md:text-3xl">{title}</h1>
          {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {action}
          <span className="hidden md:inline-flex">
            <NotificationBell />
          </span>
        </div>
      </div>
    </div>
  );
}

function NotificationBell() {
  const { user } = useAuth();
  const { data: unread = 0 } = useQuery({ ...unreadCountQuery(), enabled: Boolean(user) });

  return (
    <Button
      variant="ghost"
      size="icon"
      asChild
      className="relative h-11 w-11 md:h-9 md:w-9"
      aria-label={unread > 0 ? `Inbox, ${unread} unread` : "Inbox"}
    >
      <Link to="/app/inbox">
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unread > 0 && (
          // A bare dot told nobody how many, and told a screen reader nothing
          // at all. The count is in the label above and visible here.
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Link>
    </Button>
  );
}

function ReportFab() {
  return (
    <Button
      asChild
      size="lg"
      className="fixed bottom-5 right-5 z-30 h-14 rounded-full px-5 shadow-lg md:hidden"
    >
      <Link to="/app/report">
        <Bug className="mr-2 h-5 w-5" aria-hidden="true" />
        Report
      </Link>
    </Button>
  );
}

export type Tone = "default" | "success" | "warning" | "info" | "destructive";

const TONE_CLASS: Record<Tone, string> = {
  default: "bg-muted text-muted-foreground",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  info: "bg-info/15 text-info",
  destructive: "bg-destructive/15 text-destructive",
};

export function StatusPill({
  children,
  tone = "default",
  className = "",
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="px-6 py-12 text-center">
      <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent">
        <Icon className="h-6 w-6 text-primary" aria-hidden />
      </div>
      <h3 className="font-display text-2xl">{title}</h3>
      {description && (
        <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

/** A labelled bar with the semantics the raw div it replaces never had. */
export function ProgressBar({
  value,
  label,
  className = "",
}: {
  value: number;
  label: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={`h-1.5 overflow-hidden rounded bg-muted ${className}`}
    >
      <div className="h-full bg-primary transition-all" style={{ width: `${clamped}%` }} />
    </div>
  );
}
