import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bug, ChevronsUpDown, Menu, Moon, Plus, Sun } from "lucide-react";
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
import { NotificationBell } from "@/components/notification-bell";
import { unreadCountQuery } from "@/data/notifications";
import { ticketCountsQuery } from "@/data/tickets";
import { RunningTimerBar } from "@/features/time/running-timer-bar";
import { buildNavGroups, isNavActive } from "@/components/nav-groups";
import { runningTimerQuery } from "@/data/time";
import { CommandPalette } from "@/components/command-palette";
import { openCommandPalette } from "@/components/command-palette-events";
import { AssistantProvider } from "@/features/assistant/assistant-provider";
import { AssistantRoot } from "@/features/assistant/assistant-root";

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
    <AssistantProvider>
      <div className="flex min-h-screen bg-background" style={branded}>
        <aside className="sticky top-0 hidden h-screen w-[244px] shrink-0 flex-col border-r bg-sidebar md:flex">
          <SidebarInner isAdmin={isAdmin} onNavigate={() => {}} />
        </aside>

        <div
          className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b bg-background/90 px-3 backdrop-blur md:hidden"
          style={branded}
        >
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Open navigation"
                className="h-11 w-11"
              >
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
        {/* The Time screen has its own, larger timer card. */}
        {!location.pathname.startsWith("/app/time") && <RunningTimerBar />}
        {!location.pathname.startsWith("/app/projects/") &&
          location.pathname !== "/app/report" &&
          (isAdmin ? <AdminReportFab raised={timerRaised} /> : <ReportFab raised={timerRaised} />)}
        {/* Above the mobile Report button, which is raised when the timer bar is up. */}
        <AssistantRoot raised={timerRaised} />
      </div>
    </AssistantProvider>
  );
}

function WorkspaceSwitcher() {
  const { workspace, workspaces, setActiveWorkspace, isAdmin } = useAuth();
  const navigate = useNavigate();

  if (!workspace) return null;

  if (workspaces.length <= 1) {
    return (
      <div className="border-b px-5 pb-4 pt-5">
        <Link to="/app" className="flex items-center gap-2 font-display text-[28px] leading-[1.1]">
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

function SearchJumpButton({ onNavigate }: { onNavigate: () => void }) {
  const [hint, setHint] = useState("⌘K");
  useEffect(() => {
    if (typeof navigator !== "undefined" && !/mac|iphone|ipad/i.test(navigator.platform)) {
      setHint("Ctrl K");
    }
  }, []);

  return (
    <button
      type="button"
      onClick={() => {
        onNavigate();
        openCommandPalette();
      }}
      className="flex h-[34px] w-full items-center rounded-lg border bg-card px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted"
    >
      <span className="flex-1 text-left">Search or jump to…</span>
      <kbd className="rounded border px-1.5 text-[11px] font-sans">{hint}</kbd>
    </button>
  );
}

function SidebarInner({ isAdmin, onNavigate }: { isAdmin: boolean; onNavigate: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut, workspaceId } = useAuth();

  const counts = useQuery({
    ...ticketCountsQuery(user?.id ?? "", workspaceId),
    enabled: Boolean(user && workspaceId && isAdmin),
    refetchInterval: 60_000,
  });
  const unread = useQuery({
    ...unreadCountQuery(),
    enabled: Boolean(user),
    refetchInterval: 60_000,
  });

  const groups = buildNavGroups({
    isAdmin,
    needsTriage: counts.data?.needsTriage ?? 0,
    unread: unread.data ?? 0,
  });

  return (
    <>
      <WorkspaceSwitcher />

      <div className="px-3 pb-1 pt-3">
        <SearchJumpButton onNavigate={onNavigate} />
      </div>

      <nav aria-label="Main" className="flex flex-1 flex-col gap-3.5 overflow-auto px-3 py-2">
        {groups.map((group, index) => (
          <div key={index} className="flex flex-col gap-0.5">
            {group.map((item) => {
              const active = isNavActive(item, location.pathname);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  search={item.search as never}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-[34px] items-center rounded-lg px-2.5 text-sm transition-colors max-md:h-11 ${
                    active
                      ? "bg-accent font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <span className="flex-1">{item.label}</span>
                  {item.badge ? (
                    <span
                      className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground"
                      aria-label={`${item.badge} ${item.label === "Inbox" ? "unread" : "waiting"}`}
                    >
                      {item.badge > 99 ? "99+" : item.badge}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="px-3 pb-3">
        <Button
          asChild
          className="h-[38px] w-full"
          variant={isAdmin ? "outline" : "default"}
          onClick={onNavigate}
        >
          <Link to="/app/report">
            {isAdmin ? (
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            ) : (
              <Bug className="mr-1.5 h-4 w-4" aria-hidden="true" />
            )}
            {isAdmin ? "New ticket" : "Report an issue"}
          </Link>
        </Button>
      </div>

      <div className="space-y-2.5 border-t p-3">
        <div
          role="status"
          title="Your role decides which view you get"
          className="inline-flex rounded-lg bg-muted px-3 py-1 text-xs font-medium"
        >
          {isAdmin ? "Agency view" : "Client view"}
        </div>
        <div className="flex items-center gap-2.5 px-1">
          <div className="min-w-0 flex-1 text-xs">
            <div className="truncate font-medium">
              {user?.user_metadata?.full_name || user?.email}
            </div>
            <div className="truncate text-muted-foreground">{user?.email}</div>
          </div>
          <ThemeToggle />
          <button
            type="button"
            onClick={() => void signOut().then(() => navigate({ to: "/login" }))}
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
          >
            Sign out
          </button>
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

export { PageHeader } from "@/components/page-header";
export type { PageHeaderTab } from "@/components/page-header";
export {
  StatusPill,
  EmptyState,
  ListSkeleton,
  ProgressBar,
  Segmented,
} from "@/components/status-pill";
export type { Tone, SegmentedOption } from "@/components/status-pill";
