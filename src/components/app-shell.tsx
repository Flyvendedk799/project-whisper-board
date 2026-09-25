import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  Bug,
  ChevronsUpDown,
  BarChart3,
  Building2,
  Clock,
  FolderKanban,
  Home,
  Inbox,
  ListFilter,
  LogOut,
  Menu,
  Moon,
  Plus,
  Settings,
  Sun,
  Ticket,
  Users,
  BrainCircuit,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { unreadCountQuery } from "@/data/notifications";
import { RunningTimerBar } from "@/features/time/running-timer-bar";
import { runningTimerQuery } from "@/data/time";
import { CommandPalette } from "@/components/command-palette";

function brandStyle(color: string | null | undefined): React.CSSProperties | undefined {
  const value = color?.trim() ?? "";
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return undefined;
  return { "--primary": value } as React.CSSProperties;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAdmin, loading, rolesStatus, refetchRoles, needsWorkspace, workspace } =
    useAuth();
  const branded = brandStyle(workspace?.brand_color);
  const [mobileOpen, setMobileOpen] = useState(false);
  const onCreateWorkspace = location.pathname.startsWith("/app/create-workspace");

  const timer = useQuery({
    ...runningTimerQuery(user?.id ?? ""),
    enabled: Boolean(user && isAdmin),
  });
  const timerRaised = Boolean(timer.data);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!loading && user && needsWorkspace && !onCreateWorkspace) {
      navigate({ to: "/app/create-workspace" });
    }
  }, [loading, user, needsWorkspace, onCreateWorkspace, navigate]);

  if (loading || !user) {
    return (
      <div className="min-h-screen space-y-4 p-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

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

  if (needsWorkspace || onCreateWorkspace) {
    return <div className="min-h-screen bg-background">{children}</div>;
  }

  return (
    <div className="flex min-h-screen bg-background" style={branded}>
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar md:flex">
        <SidebarInner isAdmin={isAdmin} onNavigate={() => {}} />
      </aside>

      <div
        className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b bg-background/90 px-3 backdrop-blur md:hidden"
        style={branded}
      >
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
        <Link to="/app" className="flex min-w-0 items-center gap-2 font-display text-xl">
          {workspace?.logo_url ? (
            <img src={workspace.logo_url} alt="" className="h-6 w-6 rounded object-contain" />
          ) : null}
          <span className="truncate">{workspace?.name ?? "Workspace"}</span>
        </Link>
        <NotificationBell />
      </div>

      <main id="main" className="min-w-0 flex-1 pt-14 pb-24 md:pt-0 md:pb-0">
        {children}
      </main>

      <CommandPalette />
      <RunningTimerBar />
      {!location.pathname.startsWith("/app/projects/") &&
        location.pathname !== "/app/report" &&
        (isAdmin ? <AdminReportFab raised={timerRaised} /> : <ReportFab raised={timerRaised} />)}
    </div>
  );
}

function WorkspaceSwitcher() {
  const { workspace, workspaces, setActiveWorkspace, isAdmin } = useAuth();
  const navigate = useNavigate();

  if (!workspace) return null;

  if (workspaces.length <= 1) {
    return (
      <div className="border-b px-5 py-5">
        <Link to="/app" className="flex items-center gap-2 font-display text-2xl">
          {workspace.logo_url ? (
            <img src={workspace.logo_url} alt="" className="h-8 w-8 rounded object-contain" />
          ) : null}
          <span className="truncate">{workspace.name}</span>
        </Link>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {isAdmin ? "Admin workspace" : "Client portal"}
        </p>
      </div>
    );
  }

  return (
    <div className="border-b px-3 py-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-auto w-full justify-between px-2 py-2 text-left">
            <div className="flex min-w-0 items-center gap-2">
              {workspace.logo_url ? (
                <img
                  src={workspace.logo_url}
                  alt=""
                  className="h-8 w-8 shrink-0 rounded object-contain"
                />
              ) : null}
              <div className="min-w-0">
                <div className="truncate font-display text-xl">{workspace.name}</div>
                <div className="text-xs text-muted-foreground">
                  {isAdmin ? "Admin workspace" : "Client portal"}
                </div>
              </div>
            </div>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {workspaces.map((ws) => (
            <DropdownMenuItem
              key={ws.id}
              onClick={() => {
                setActiveWorkspace(ws.id);
                void navigate({ to: "/app" });
              }}
            >
              <span className="truncate">{ws.name}</span>
              {ws.id === workspace.id ? (
                <span className="ml-auto text-xs text-muted-foreground">Active</span>
              ) : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void navigate({ to: "/app/create-workspace" })}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            New workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
    ...(isAdmin
      ? [
          { to: "/app/organizations", label: "Clients", icon: Building2, exact: false },
          { to: "/app/time", label: "Time", icon: Clock, exact: false },
          { to: "/app/reports", label: "Reports", icon: BarChart3, exact: false },
          { to: "/app/team", label: "Team", icon: Users, exact: false },
          { to: "/app/planner", label: "AI Planner", icon: BrainCircuit, exact: false },
        ]
      : []),
    { to: "/app/inbox", label: "Inbox", icon: Inbox, exact: false },
    { to: "/app/settings", label: "Settings", icon: Settings, exact: false },
  ];

  return (
    <>
      <WorkspaceSwitcher />

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

      <div className="space-y-2 px-3 pb-2">
        {isAdmin ? (
          <Button asChild className="w-full" variant="outline" onClick={onNavigate}>
            <Link to="/app/report">
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              New ticket
            </Link>
          </Button>
        ) : (
          <Button asChild className="w-full" onClick={onNavigate}>
            <Link to="/app/report">
              <Bug className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Report an issue
            </Link>
          </Button>
        )}
      </div>

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
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Link>
    </Button>
  );
}

function ReportFab({ raised = false }: { raised?: boolean }) {
  return (
    <Button
      asChild
      size="lg"
      className={`fixed right-5 z-30 h-14 rounded-full px-5 shadow-lg md:hidden ${
        raised ? "bottom-24" : "bottom-5"
      }`}
    >
      <Link to="/app/report">
        <Bug className="mr-2 h-5 w-5" aria-hidden="true" />
        Report
      </Link>
    </Button>
  );
}

function AdminReportFab({ raised = false }: { raised?: boolean }) {
  return (
    <Button
      asChild
      size="lg"
      variant="outline"
      className={`fixed right-5 z-30 h-14 rounded-full px-5 shadow-lg md:hidden ${
        raised ? "bottom-24" : "bottom-5"
      }`}
    >
      <Link to="/app/report">
        <Plus className="mr-2 h-5 w-5" aria-hidden="true" />
        New ticket
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
