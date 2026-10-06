import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Bug,
  Building2,
  BrainCircuit,
  Cable,
  Clock,
  FolderKanban,
  Home,
  Inbox,
  ListFilter,
  LogOut,
  Menu,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Ticket,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { PersonAvatar } from "@/components/person-avatar";
import { useOwnPerson } from "@/hooks/use-own-person";
import { useTheme } from "@/components/theme-provider";
import { NotificationBell } from "@/components/notification-bell";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { buildNavGroups, isNavActive } from "@/components/nav-groups";
import type { NavItem } from "@/components/nav-groups";
import { openCommandPalette } from "@/components/command-palette-events";
import { unreadCountQuery } from "@/data/notifications";
import { ticketCountsQuery } from "@/data/tickets";
import { cn } from "@/lib/utils";

/**
 * Phone chrome. Everything here is `md:hidden`; the desktop sidebar is untouched.
 *
 * A phone has a thumb, not a pointer, so navigation lives at the bottom edge:
 * four destinations, one primary action in the middle, and a "More" sheet for the
 * rest. The top bar is only identity, search and the inbox.
 */

const ICONS: Record<string, LucideIcon> = {
  "/app": Home,
  "/app/triage": ListFilter,
  "/app/tickets": Ticket,
  "/app/projects": FolderKanban,
  "/app/planner": BrainCircuit,
  "/app/agents": Cable,
  "/app/organizations": Building2,
  "/app/time": Clock,
  "/app/reports": BarChart3,
  "/app/team": Users,
  "/app/inbox": Inbox,
  "/app/settings": Settings,
};

/** Which destinations get a tab; everything else lives behind "More". */
const TAB_ROUTES = {
  admin: ["/app", "/app/triage", "/app/projects"],
  client: ["/app", "/app/tickets", "/app/projects"],
} as const;

function useNavData(isAdmin: boolean) {
  const { user, workspaceId } = useAuth();
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
  const all = groups.flat();
  const tabTos: readonly string[] = isAdmin ? TAB_ROUTES.admin : TAB_ROUTES.client;
  const tabs = tabTos
    .map((to) => all.find((item) => item.to === to))
    .filter((item): item is NavItem => Boolean(item));
  const more = all.filter((item) => !tabTos.includes(item.to));
  return { tabs, more, unread: unread.data ?? 0 };
}

export function MobileTopBar({
  branded,
  workspaceName,
  logoUrl,
}: {
  branded?: React.CSSProperties;
  workspaceName: string;
  logoUrl?: string | null;
}) {
  return (
    <header
      className="fixed inset-x-0 top-0 z-40 flex items-center justify-between gap-2 border-b bg-background/90 pl-4 pr-1.5 backdrop-blur md:hidden"
      style={{
        ...branded,
        height: "var(--mobile-topbar-h)",
        paddingTop: "var(--safe-top)",
      }}
    >
      <Link to="/app" className="flex min-w-0 items-center gap-2 font-display text-[22px]">
        {logoUrl ? (
          <img src={logoUrl} alt="" className="h-6 w-6 shrink-0 rounded object-contain" />
        ) : null}
        <span className="truncate">{workspaceName}</span>
      </Link>
      <div className="flex shrink-0 items-center">
        <button
          type="button"
          aria-label="Search"
          onClick={openCommandPalette}
          className="grid h-11 w-11 place-items-center rounded-full text-foreground transition-colors active:bg-muted"
        >
          <Search className="h-[18px] w-[18px]" aria-hidden="true" />
        </button>
        <NotificationBell />
      </div>
    </header>
  );
}

function TabBadge({ count, label }: { count: number; label: string }) {
  if (!count) return null;
  return (
    <span
      aria-label={label}
      className="absolute -right-2.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function MobileTabBar({
  isAdmin,
  workspaceSlot,
}: {
  isAdmin: boolean;
  /** Rendered at the top of the More sheet (the workspace switcher). */
  workspaceSlot?: React.ReactNode;
}) {
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const { tabs, more } = useNavData(isAdmin);

  // Navigating anywhere closes the sheet, whichever control triggered it.
  const pathname = location.pathname;
  useEffect(() => setMoreOpen(false), [pathname]);

  const moreActive = more.some((item) => isNavActive(item, pathname));
  const half = Math.ceil(tabs.length / 2);
  const left = tabs.slice(0, half);
  const right = tabs.slice(half);

  const tabLink = (item: NavItem) => {
    const Icon = ICONS[item.to] ?? Home;
    const active = isNavActive(
      // The centre button owns /app/report, so it must not keep Triage lit.
      { ...item, alsoActiveFor: item.alsoActiveFor?.filter((p) => p !== "/app/report") },
      pathname,
    );
    return (
      <Link
        key={item.to}
        to={item.to}
        search={item.search as never}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors active:bg-muted/60",
          active ? "text-primary" : "text-muted-foreground",
        )}
      >
        <span className="relative">
          <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.4 : 1.9} aria-hidden="true" />
          <TabBadge
            count={item.badge ?? 0}
            label={`${item.badge} ${item.label === "Inbox" ? "unread" : "waiting"}`}
          />
        </span>
        <span>{item.label === "My tickets" ? "Tickets" : item.label}</span>
      </Link>
    );
  };

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "var(--safe-bottom)" }}
      >
        <div className="mx-auto grid h-14 max-w-xl grid-cols-5">
          {left.map(tabLink)}
          <Link
            to="/app/report"
            className="relative flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-foreground"
          >
            <span className="grid h-8 w-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm transition-transform active:scale-95">
              {isAdmin ? (
                <Plus className="h-5 w-5" strokeWidth={2.4} aria-hidden="true" />
              ) : (
                <Bug className="h-5 w-5" aria-hidden="true" />
              )}
            </span>
            <span>{isAdmin ? "New" : "Report"}</span>
          </Link>
          {right.map(tabLink)}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className={cn(
              "relative flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors active:bg-muted/60",
              moreActive ? "text-primary" : "text-muted-foreground",
            )}
          >
            <span className="relative">
              <Menu className="h-[22px] w-[22px]" aria-hidden="true" />
              <MoreDot />
            </span>
            <span>More</span>
          </button>
        </div>
      </nav>

      <MoreSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        items={more}
        isAdmin={isAdmin}
        workspaceSlot={workspaceSlot}
      />
    </>
  );
}

/** Surfaces unread inbox items on the More tab, since Inbox lives inside it. */
function MoreDot() {
  const { user } = useAuth();
  const { data: unread = 0 } = useQuery({ ...unreadCountQuery(), enabled: Boolean(user) });
  if (!unread) return null;
  return (
    <span
      aria-label={`${unread} unread`}
      className="absolute -right-1 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary"
    />
  );
}

function MoreSheet({
  open,
  onOpenChange,
  items,
  isAdmin,
  workspaceSlot,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: NavItem[];
  isAdmin: boolean;
  workspaceSlot?: React.ReactNode;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { resolved, toggle } = useTheme();
  const me = useOwnPerson();
  const name = me?.full_name || user?.email || "";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="gap-0 p-0 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-14"
      >
        <SheetTitle className="sr-only">More</SheetTitle>
        <SheetDescription className="sr-only">
          Everything else in the workspace, plus your account.
        </SheetDescription>

        <div className="flex items-center gap-3 px-5 pb-3">
          <PersonAvatar person={me} size="lg" className="h-11 w-11 text-sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {isAdmin ? "Agency view" : "Client view"}
              {user?.email && name !== user.email ? ` · ${user.email}` : ""}
            </div>
          </div>
          <button
            type="button"
            onClick={toggle}
            aria-label={`Switch to ${resolved === "dark" ? "light" : "dark"} theme`}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full border bg-card transition-colors active:bg-muted"
          >
            {resolved === "dark" ? (
              <Sun className="h-[18px] w-[18px]" aria-hidden="true" />
            ) : (
              <Moon className="h-[18px] w-[18px]" aria-hidden="true" />
            )}
          </button>
        </div>

        {workspaceSlot ? <div className="border-y">{workspaceSlot}</div> : null}

        <div className="px-4 pt-3">
          <button
            type="button"
            onClick={() => {
              onOpenChange(false);
              // Let the sheet unmount first, so focus lands in the palette's input.
              setTimeout(openCommandPalette, 150);
            }}
            className="flex h-12 w-full items-center gap-3 rounded-xl border bg-card px-3.5 text-left text-[15px] text-muted-foreground transition-colors active:bg-muted"
          >
            <Search className="h-[18px] w-[18px]" aria-hidden="true" />
            Search tickets and projects
          </button>
        </div>

        <nav aria-label="More" className="grid grid-cols-2 gap-2.5 px-4 pt-3">
          {items.map((item) => {
            const Icon = ICONS[item.to] ?? Home;
            const active = isNavActive(item, location.pathname);
            return (
              <Link
                key={item.to}
                to={item.to}
                search={item.search as never}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-14 items-center gap-3 rounded-xl border px-3 text-[15px] transition-colors active:bg-muted",
                  active ? "border-primary/40 bg-accent font-medium" : "bg-card",
                )}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 leading-tight">{item.label}</span>
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
        </nav>

        <div className="px-4 pt-3">
          <button
            type="button"
            onClick={() => void signOut().then(() => navigate({ to: "/login" }))}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15px] text-muted-foreground transition-colors active:bg-muted"
          >
            <LogOut className="h-[18px] w-[18px]" aria-hidden="true" />
            Sign out
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
